import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db, phoneNumbersTable, phoneRecRulesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();
export const PHONE_REC_UNKNOWN_CALLER = "__unknown_callers__";

type PhoneRecPayload = Record<string, any>;
let storageReady: Promise<void> | null = null;

function normalizePhone(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (value === PHONE_REC_UNKNOWN_CALLER) return value;
  const digits = value.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * Render deploys do not run drizzle-kit push on every build. Keep this bridge
 * self-contained by creating only its own additive table/index when first used.
 */
async function ensurePhoneRecStorage(): Promise<void> {
  if (!storageReady) {
    storageReady = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS phone_rec_rules (
          id SERIAL PRIMARY KEY,
          line_number TEXT NOT NULL,
          caller_number TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.execute(sql`
        CREATE UNIQUE INDEX IF NOT EXISTS phone_rec_rules_line_caller_unique
        ON phone_rec_rules (line_number, caller_number)
      `);
    })().catch((error) => {
      storageReady = null;
      throw error;
    });
  }
  await storageReady;
}

function integrationAuthorized(req: any): boolean {
  const expected = process.env.PHONE_REC_INTEGRATION_KEY?.trim();
  const supplied = String(req.get("x-phone-rec-key") ?? "").trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireIntegrationKey(req: any, res: any, next: any): void {
  if (!process.env.PHONE_REC_INTEGRATION_KEY?.trim()) {
    res.status(503).json({ error: "PHONE_REC_INTEGRATION_KEY is not configured on CallingAgent" });
    return;
  }
  if (!integrationAuthorized(req)) {
    res.status(401).json({ error: "Invalid Phone Rec integration key" });
    return;
  }
  next();
}

function parsePayload(raw: string): PhoneRecPayload | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Resolve an exact caller rule first, then the Phone Rec fallback rule. */
export async function findPhoneRecRule(lineNumberRaw: string, callerNumberRaw: string): Promise<{ payload: PhoneRecPayload; source: "exact" | "unknown" } | null> {
  await ensurePhoneRecStorage();
  const lineNumber = normalizePhone(lineNumberRaw);
  const callerNumber = normalizePhone(callerNumberRaw);
  if (!lineNumber) return null;

  if (callerNumber) {
    const [exact] = await db.select().from(phoneRecRulesTable).where(and(
      eq(phoneRecRulesTable.lineNumber, lineNumber),
      eq(phoneRecRulesTable.callerNumber, callerNumber),
    )).limit(1);
    const payload = exact ? parsePayload(exact.payload) : null;
    if (payload) return { payload, source: "exact" };
  }

  const [fallback] = await db.select().from(phoneRecRulesTable).where(and(
    eq(phoneRecRulesTable.lineNumber, lineNumber),
    eq(phoneRecRulesTable.callerNumber, PHONE_REC_UNKNOWN_CALLER),
  )).limit(1);
  const payload = fallback ? parsePayload(fallback.payload) : null;
  return payload ? { payload, source: "unknown" } : null;
}

/**
 * Merge the Phone Rec rule with CallingAgent's existing AI prompt.
 * CallingAgent remains responsible for the live call, speech, booking tools and recording.
 */
export function buildPhoneRecSystemPrompt(payload: PhoneRecPayload, fallbackPrompt: string): string {
  const business = payload?.business && typeof payload.business === "object" ? payload.business : {};
  const collect = Array.isArray(payload?.collect) ? payload.collect.map(String) : [];
  const lines: string[] = [
    fallbackPrompt,
    "PHONE REC CALLER RULE: Follow the caller-specific instructions below for this call.",
    "Identify yourself clearly as an AI assistant. Never claim to be the human owner of the phone.",
  ];

  const script = String(payload?.script ?? "").trim();
  const instructions = String(payload?.instructions ?? "").trim();
  if (script) lines.push(`Opening script / approved wording: ${script}`);
  if (instructions) lines.push(`Conversation instructions: ${instructions}`);

  if (payload?.allow_business_questions !== false) {
    const name = String(business?.name ?? "").trim();
    const description = String(business?.description ?? "").trim();
    const services = String(business?.services ?? "").trim();
    const faq = String(business?.faq ?? "").trim();
    if (name) lines.push(`Business name: ${name}`);
    if (description) lines.push(`Approved business description: ${description}`);
    if (services) lines.push(`Approved services: ${services}`);
    if (faq) lines.push(`Approved FAQs / answers: ${faq}`);
  } else {
    lines.push("Do not discuss business details or services on this call.");
  }

  if (payload?.allow_offers !== false) {
    const offers = String(business?.offers ?? "").trim();
    if (offers) lines.push(`Approved offers / promotions: ${offers}`);
  } else {
    lines.push("Do not discuss offers, promotions, pricing promises, or discounts.");
  }

  if (payload?.allow_booking === false) {
    lines.push("Do not book, reschedule, or cancel appointments. Offer to take a message instead.");
  } else {
    const booking = String(business?.booking_instructions ?? "").trim();
    const availability = String(business?.availability ?? "").trim();
    if (booking) lines.push(`Booking instructions: ${booking}`);
    if (availability) lines.push(`Appointment availability rules: ${availability}`);
  }

  if (collect.length) lines.push(`Information to collect when natural and relevant: ${collect.join(", ")}.`);
  if (payload?.escalate_urgent !== false) lines.push("If the caller says the matter is urgent, acknowledge that clearly and mark/escalate it in the call summary.");
  lines.push("Do not negotiate contracts, accept binding offers, promise prices, or make commitments beyond the approved information and enabled actions.");

  return lines.filter(Boolean).join("\n\n");
}

router.get("/phone-rec/status", requireIntegrationKey, async (_req, res): Promise<void> => {
  try {
    await ensurePhoneRecStorage();
    const lines = await db.select({ number: phoneNumbersTable.number, friendlyName: phoneNumbersTable.friendlyName, isActive: phoneNumbersTable.isActive })
      .from(phoneNumbersTable);
    res.json({
      ok: true,
      service: "CallingAgent Phone Rec bridge",
      lines: lines.filter((item) => item.isActive).map((item) => ({ ...item, number: normalizePhone(item.number) })),
    });
  } catch (error: any) {
    logger.error({ err: error?.message }, "Phone Rec bridge status failed");
    res.status(500).json({ error: "Phone Rec bridge storage is unavailable" });
  }
});

router.post("/phone-rec/rules", requireIntegrationKey, async (req, res): Promise<void> => {
  try {
    await ensurePhoneRecStorage();
    const lineNumber = normalizePhone(req.body?.lineNumber);
    const callerNumber = req.body?.callerNumber === PHONE_REC_UNKNOWN_CALLER
      ? PHONE_REC_UNKNOWN_CALLER
      : normalizePhone(req.body?.callerNumber);
    const payload = req.body?.payload;

    if (!lineNumber || !callerNumber || !payload || typeof payload !== "object") {
      res.status(400).json({ error: "lineNumber, callerNumber and payload are required" });
      return;
    }

    const allLines = await db.select().from(phoneNumbersTable);
    const matching = allLines.find((item) => normalizePhone(item.number) === lineNumber && item.isActive);
    if (!matching) {
      res.status(404).json({ error: `Active CallingAgent line ${lineNumber} was not found` });
      return;
    }

    await db.insert(phoneRecRulesTable).values({
      lineNumber,
      callerNumber,
      payload: JSON.stringify(payload),
    }).onConflictDoUpdate({
      target: [phoneRecRulesTable.lineNumber, phoneRecRulesTable.callerNumber],
      set: { payload: JSON.stringify(payload), updatedAt: new Date() },
    });

    logger.info({ lineNumber, callerNumber, mode: payload?.mode }, "Phone Rec AI rule synchronized");
    res.json({ ok: true, lineNumber, callerNumber });
  } catch (error: any) {
    logger.error({ err: error?.message }, "Phone Rec rule synchronization failed");
    res.status(500).json({ error: "Could not synchronize the Phone Rec rule" });
  }
});

router.delete("/phone-rec/rules", requireIntegrationKey, async (req, res): Promise<void> => {
  try {
    await ensurePhoneRecStorage();
    const lineNumber = normalizePhone(req.body?.lineNumber);
    const callerNumber = req.body?.callerNumber === PHONE_REC_UNKNOWN_CALLER
      ? PHONE_REC_UNKNOWN_CALLER
      : normalizePhone(req.body?.callerNumber);
    if (!lineNumber || !callerNumber) {
      res.status(400).json({ error: "lineNumber and callerNumber are required" });
      return;
    }
    await db.delete(phoneRecRulesTable).where(and(
      eq(phoneRecRulesTable.lineNumber, lineNumber),
      eq(phoneRecRulesTable.callerNumber, callerNumber),
    ));
    res.json({ ok: true });
  } catch (error: any) {
    logger.error({ err: error?.message }, "Phone Rec rule deletion failed");
    res.status(500).json({ error: "Could not remove the Phone Rec rule" });
  }
});

export default router;
