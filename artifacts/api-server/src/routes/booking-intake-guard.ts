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
  setCustomerDetails,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";
const GENERIC_BOOKING = /\b(book|booking|appointment|schedule|availability|available|opening|slot)\b/i;
const RESCHEDULE_OR_CANCEL = /\b(reschedule|cancel|change my appointment|move my appointment)\b/i;
const WEEKDAY = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const GENERIC_SERVICE_WORDS = new Set([
  "service", "services", "appointment", "booking", "book", "schedule", "scheduling",
  "available", "availability", "opening", "slot", "change", "visit",
]);

function baseUrl(req: any): string {
  return process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;
}

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gatherResponse(req: any, text: string): string {
  const action = `${baseUrl(req)}/api/twilio/ai-gather`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(text)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${action}" method="POST"></Gather>\n  <Say voice="${FALLBACK_VOICE}">Are you still there?</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${action}" method="POST"></Gather>\n</Response>`;
}

function normalizedPhone(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

async function resolveCall(req: any, callSid: string) {
  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, callSid));
  if (log?.phoneNumberId) {
    const [phone] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, log.phoneNumberId));
    if (phone?.companyId) return { log, phone, companyId: phone.companyId };
  }

  const destination = normalizedPhone(req.body?.To || req.body?.Called || log?.toNumber);
  if (!destination) return null;
  const phones = await db.select().from(phoneNumbersTable);
  const phone = phones.find(row => normalizedPhone(row.number) === destination);
  if (!phone?.companyId) return null;
  return { log: log ?? null, phone, companyId: phone.companyId };
}

function serviceIsExplicit(speech: string, services: Array<{ name: string; description?: string | null }>): boolean {
  const lower = speech.toLowerCase();
  for (const service of services) {
    if (lower.includes(service.name.toLowerCase())) return true;
    const nameWords = service.name.toLowerCase().split(/[^a-z0-9]+/)
      .filter(word => word.length >= 4 && !GENERIC_SERVICE_WORDS.has(word));
    if (nameWords.some(word => new RegExp(`\\b${word}\\b`, "i").test(lower))) return true;
  }
  return false;
}

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  let speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech || RESCHEDULE_OR_CANCEL.test(speech)) {
    next();
    return;
  }

  // In normal receptionist language, "next Friday" means the upcoming Friday
  // unless today itself is Friday. Normalize the phrase before the state-driven
  // date resolver sees it so it does not skip an extra week.
  speech = speech.replace(new RegExp(`\\bnext\\s+(${WEEKDAY})\\b`, "ig"), "$1");
  req.body.SpeechResult = speech;

  if (peekBookingState(callSid) || !GENERIC_BOOKING.test(speech)) {
    next();
    return;
  }

  try {
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

    if (services.length <= 1 || serviceIsExplicit(speech, services)) {
      next();
      return;
    }

    const state = getBookingState(callSid, call.companyId);
    if (call.log?.fromNumber && call.log.fromNumber !== "Anonymous") {
      setCustomerDetails(callSid, call.companyId, { customerPhone: call.log.fromNumber });
    }

    logger.info({ callSid, companyId: call.companyId, serviceCount: services.length }, "Generic booking intent needs service before calendar lookup");
    res.type("text/xml").send(gatherResponse(req, "Absolutely. What would you like the appointment for?"));
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking intake guard failed; continuing to orchestrator");
    next();
  }
});

export default router;
