import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  bookingServicesTable,
  callLogsTable,
  phoneNumbersTable,
} from "@workspace/db";
import {
  getBookingState,
  peekBookingState,
  setSchedulingPreference,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const BOOKING_INTENT = /\b(book|booking|appointment|appt|schedule|scheduled|scheduling)\b/i;
const TIRE_CHANGE_INTENT = /\b(?:change|changing|changed|replace|replacing|replacement|install|installing|swap|swapping)\b[\s\S]{0,30}\b(?:tire|tires)\b|\b(?:tire|tires)\b[\s\S]{0,30}\b(?:change|changing|changed|replace|replacing|replacement|install|installing|swap|swapping)\b/i;
const SPARE = /\bspare\b/i;

function normalizedPhone(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return value.trim();
}

async function resolveCall(req: any, callSid: string) {
  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, callSid));
  if (log?.phoneNumberId) {
    const [phone] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, log.phoneNumberId));
    if (phone?.companyId) return { log, phone, companyId: phone.companyId };
  }

  const destination = normalizedPhone(req.body?.To || req.body?.Called || req.body?.DialCallTo || log?.toNumber);
  if (!destination) return null;
  const phones = await db.select().from(phoneNumbersTable);
  const phone = phones.find(row => normalizedPhone(row.number) === destination);
  if (!phone?.companyId) return null;
  return { log: log ?? null, phone, companyId: phone.companyId };
}

function chooseTireService(
  speech: string,
  services: Array<{ id: number; name: string; description?: string | null }>,
) {
  const wantsSpare = SPARE.test(speech);
  const scored = services
    .map(service => {
      const text = `${service.name} ${service.description ?? ""}`.toLowerCase();
      let score = 0;
      if (/\btire\b/.test(text)) score += 20;
      if (/\b(change|replacement|replace|install|swap)\b/.test(text)) score += 20;
      if (/\bservice\b/.test(text)) score += 8;
      if (/\bspare\b/.test(text)) score += wantsSpare ? 40 : -15;
      if (/\brepair|patch|puncture|leak\b/.test(text)) score -= 12;
      return { service, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.service ?? null;
}

router.use("/twilio/ai-gather", async (req: any, _res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech || !BOOKING_INTENT.test(speech) || !TIRE_CHANGE_INTENT.test(speech)) {
    next();
    return;
  }

  try {
    const existing = peekBookingState(callSid);
    if (existing?.serviceId) {
      next();
      return;
    }

    const call = await resolveCall(req, callSid);
    if (!call) {
      next();
      return;
    }

    const services = await db.select({
      id: bookingServicesTable.id,
      name: bookingServicesTable.name,
      description: bookingServicesTable.description,
    }).from(bookingServicesTable)
      .where(and(eq(bookingServicesTable.companyId, call.companyId), eq(bookingServicesTable.active, true)));

    const matched = chooseTireService(speech, services);
    if (!matched) {
      next();
      return;
    }

    let state = existing ?? getBookingState(callSid, call.companyId);
    state = setSchedulingPreference(
      callSid,
      call.companyId,
      { serviceId: matched.id, serviceName: matched.name },
      state.stateVersion,
    );

    logger.info(
      { callSid, companyId: call.companyId, serviceId: matched.id, serviceName: matched.name, speech: speech.slice(0, 120) },
      "Resolved natural tire-change phrase to configured booking service",
    );
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Tire service alias guard failed; continuing existing booking flow");
  }

  next();
});

export default router;
