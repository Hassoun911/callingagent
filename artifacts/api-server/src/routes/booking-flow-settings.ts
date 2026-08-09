import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable } from "@workspace/db";
import { getCompanyScope } from "../lib/scope";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const START = "[CALLINGAGENT_BOOKING_FLOW_START]";
const END = "[CALLINGAGENT_BOOKING_FLOW_END]";

type BookingFlowMode = "availability_first" | "caller_preference_first";

function removeExistingBlock(prompt: string): string {
  const start = prompt.indexOf(START);
  const end = prompt.indexOf(END);
  if (start === -1 || end === -1 || end < start) return prompt.trim();
  return `${prompt.slice(0, start)}${prompt.slice(end + END.length)}`.trim();
}

function detectMode(prompt: string | null): BookingFlowMode {
  if (prompt?.includes("BOOKING_FLOW_MODE=availability_first")) return "availability_first";
  return "caller_preference_first";
}

function bookingBlock(mode: BookingFlowMode): string {
  const modeInstruction = mode === "availability_first"
    ? `AVAILABILITY-FIRST MODE: When the caller wants an appointment, ask only for any service detail needed to know the duration, then say exactly and naturally, "Let me check availability." Check the real calendar and offer the best available choices. Do not ask them to pick a date first unless they volunteer one.`
    : `CALLER-PREFERENCE-FIRST MODE: When the caller wants an appointment, ask what day or time works for them. After they answer, say only, "Let me check availability." Check the real calendar for that request and offer the closest valid choices.`;

  return `${START}
BOOKING_FLOW_MODE=${mode}
${modeInstruction}
CONVERSATION STYLE: Sound like a real receptionist, not a scheduling bot. Never read the current date, year, timezone, internal scheduling context, ISO timestamps, or calendar mechanics aloud. Do not say "I am checking the calendar for [day/date/year/time]." Say only "Let me check availability." When you have results, go straight to the useful answer: "I have Monday at 2 or 4. Which works for you?" If the caller says no, asks for another spot, another time, or a different option, do not repeat the checking explanation; simply offer the next available option(s), e.g. "Sure, I also have Tuesday at 10 or 1." Keep each booking turn short.
BOOKING SAFETY: Never claim a time is available until the real calendar check succeeds. Never book until the caller explicitly accepts the exact offered slot. "Soonest", "earliest", "ASAP", "first available", "next available", "as soon as you can", "whatever you have first", or "book me the soonest" always mean search the real calendar from the earliest valid opening and OFFER choices; they are not permission to book automatically and they do not automatically mean same-day. Only treat a request as same-day when the caller explicitly says today, this afternoon, tonight, right now, or otherwise clearly requests today. Never invent a year or reuse a year from an example. Use the live scheduling context internally. All scheduling uses the company's Eastern business clock, defaulting to America/Toronto. Never mention UTC.
${END}`;
}

async function getNumberForRequest(req: any, id: number) {
  const [number] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, id));
  if (!number) return { error: 404 as const, message: "Phone number not found" };
  const companyId = getCompanyScope(req);
  if (companyId !== null && number.companyId !== companyId) {
    return { error: 403 as const, message: "Access denied" };
  }
  return { number };
}

export async function refreshStoredBookingFlowPrompts(): Promise<void> {
  try {
    const numbers = await db.select().from(phoneNumbersTable);
    let updated = 0;
    for (const number of numbers) {
      if (!number.aiSystemPrompt?.includes(START)) continue;
      const mode = detectMode(number.aiSystemPrompt);
      const basePrompt = removeExistingBlock(number.aiSystemPrompt);
      const aiSystemPrompt = `${basePrompt}${basePrompt ? "\n\n" : ""}${bookingBlock(mode)}`;
      if (aiSystemPrompt === number.aiSystemPrompt) continue;
      await db.update(phoneNumbersTable)
        .set({ aiSystemPrompt, updatedAt: new Date() })
        .where(eq(phoneNumbersTable.id, number.id));
      updated++;
    }
    if (updated) logger.info({ updated }, "Refreshed stored booking-flow instructions");
  } catch (error: any) {
    logger.warn({ err: error?.message }, "Could not refresh stored booking-flow instructions");
  }
}

router.get("/phone-numbers/:id/booking-flow", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid phone number" }); return; }
  const result = await getNumberForRequest(req, id);
  if ("error" in result) { res.status(result.error).json({ error: result.message }); return; }
  res.json({ mode: detectMode(result.number.aiSystemPrompt), defaultMode: "caller_preference_first" });
});

router.patch("/phone-numbers/:id/booking-flow", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const mode = req.body?.mode as BookingFlowMode;
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid phone number" }); return; }
  if (!(["availability_first", "caller_preference_first"] as string[]).includes(mode)) {
    res.status(400).json({ error: "Choose a valid booking flow" });
    return;
  }

  const result = await getNumberForRequest(req, id);
  if ("error" in result) { res.status(result.error).json({ error: result.message }); return; }

  const basePrompt = removeExistingBlock(result.number.aiSystemPrompt ?? "");
  const aiSystemPrompt = `${basePrompt}${basePrompt ? "\n\n" : ""}${bookingBlock(mode)}`;
  await db.update(phoneNumbersTable)
    .set({ aiSystemPrompt, updatedAt: new Date() })
    .where(eq(phoneNumbersTable.id, id));

  res.json({ ok: true, mode });
});

export default router;
