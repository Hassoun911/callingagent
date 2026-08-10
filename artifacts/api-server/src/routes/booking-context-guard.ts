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
  holdBookingSlot,
  peekBookingState,
  setBookingAction,
  setCustomerDetails,
  setSchedulingPreference,
  type BookingSlotState,
  type LiveBookingState,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";

const BOOKING_INTENT = /\b(book|booking|appointment|appt|schedule|scheduled|scheduling)\b/i;
const YES = /\b(yes|yeah|yep|yup|sure|correct|right|that's right|that is right|perfect|sounds good|go ahead|confirm|book it)\b/i;
const BOOK_NOW = /\b(book it|book that|go ahead(?: and)? book(?: it| that)?|let'?s book(?: it| that)?|confirm it|take it|lock it in)\b/i;
const TIME_SELECTION = /\b(?:i(?:'ll| will)? take|works|work for me|is good|sounds good|perfect|that one|that works|let'?s do)\b/i;
const SERVICE_STOPWORDS = new Set([
  "i", "im", "i'm", "me", "my", "we", "a", "an", "the", "to", "for", "please", "need", "want", "would", "like",
  "book", "booking", "appointment", "appointments", "appt", "schedule", "scheduled", "scheduling", "service", "services",
  "today", "tomorrow", "morning", "afternoon", "evening", "night", "available", "availability", "opening", "slot",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "this", "next",
  "at", "around", "about", "am", "pm", "if", "you", "have", "something",
  "hi", "hello", "hey", "nancy", "trying", "try", "just", "looking", "hoping", "get", "getting", "can", "could",
]);
const SPOKEN_HOURS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const SERVICE_SYNONYMS: Record<string, string> = {
  fix: "repair",
  fixing: "repair",
  patched: "repair",
  patch: "repair",
  puncture: "repair",
  leaking: "leak",
};

function baseUrl(req: any): string {
  return process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function gatherResponse(req: any, text: string): string {
  const action = `${baseUrl(req)}/api/twilio/ai-gather`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(text)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${action}" method="POST"></Gather>\n  <Say voice="${FALLBACK_VOICE}">Are you still there?</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${action}" method="POST"></Gather>\n</Response>`;
}

function normalizedPhone(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return value.trim();
}

function naturalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `${local.slice(0, 3).split("").join(" ")}, ${local.slice(3, 6).split("").join(" ")}, ${local.slice(6).split("").join(" ")}`;
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

async function loadServices(companyId: number) {
  return db.select().from(bookingServicesTable)
    .where(and(eq(bookingServicesTable.companyId, companyId), eq(bookingServicesTable.active, true)));
}

function normalizedServiceWords(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map(word => SERVICE_SYNONYMS[word] ?? word);
}

function serviceScore(speech: string, name: string, description?: string | null): number {
  const lower = speech.toLowerCase();
  if (lower.includes(name.toLowerCase())) return 50;
  const source = normalizedServiceWords(`${name} ${description ?? ""}`);
  const words = normalizedServiceWords(lower).filter(word => word.length > 2 && !SERVICE_STOPWORDS.has(word));
  let score = 0;
  for (const word of words) {
    if (source.includes(word)) score += word.length >= 5 ? 3 : 2;
  }
  return score;
}

function cleanServicePhrase(value: string): string | null {
  const cleaned = value
    .toLowerCase()
    .replace(/\b(?:please|thanks|thank you)\b/g, " ")
    .replace(/\b(?:on|this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*$/i, " ")
    .replace(/\b(?:today|tomorrow|morning|afternoon|evening|tonight)\b.*$/i, " ")
    .replace(/\b(?:at|around|about)\s+\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b.*$/i, " ")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b.*$/i, " ")
    .replace(/[^a-z0-9' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const words = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter(word => !SERVICE_STOPWORDS.has(word));
  if (!words.length) return null;
  return words.slice(0, 6).join(" ");
}

function explicitServiceCandidate(speech: string, askedForService: boolean): string | null {
  const lower = speech.toLowerCase().replace(/\bappt\b/g, "appointment");

  // Prefer the noun phrase that follows normal booking language. This keeps
  // greetings/filler out of the service: "Hi Nancy, I'm trying to book an
  // appointment for oil change" -> "oil change".
  const patterns = [
    /\b(?:appointment|booking)\s+(?:for|to get|to have)\s+(.+)$/i,
    /\b(?:book|schedule)\s+(?:me\s+)?(?:an?\s+)?(.+)$/i,
    /\b(?:need|want|looking for|trying to get)\s+(?:an?\s+)?(.+?)(?:\s+appointment)?$/i,
  ];
  for (const pattern of patterns) {
    const match = lower.match(pattern);
    const candidate = match?.[1] ? cleanServicePhrase(match[1]) : null;
    if (candidate) return candidate;
  }

  // If Nancy explicitly asked for the service, a short direct reply such as
  // "oil change" or "tire repair" is itself the service phrase.
  if (askedForService) return cleanServicePhrase(lower);
  if (!BOOKING_INTENT.test(lower)) return null;
  return null;
}

function simpleName(speech: string): string | null {
  const explicit = speech.match(/\b(?:my name is|name is|this is)\s+([A-Za-z][A-Za-z' -]{1,60})/i)?.[1]?.trim();
  if (explicit) return explicit;
  const trimmed = speech.trim();
  if (/^[A-Za-z][A-Za-z' -]{1,60}$/.test(trimmed) && !YES.test(trimmed) && !BOOK_NOW.test(trimmed)) return trimmed;
  return null;
}

function parseTimeText(speech: string, state: LiveBookingState): string | null {
  const match = speech.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!match) return null;
  const hour = /^\d+$/.test(match[1]) ? Number(match[1]) : SPOKEN_HOURS[match[1].toLowerCase()];
  if (!hour || hour < 1 || hour > 12) return null;
  const minute = match[2] ? Number(match[2]) : 0;
  let period = match[3]?.toLowerCase().startsWith("p") ? "PM" : match[3] ? "AM" : null;
  if (!period) {
    if (state.requestedDaypart === "morning") period = "AM";
    else if (state.requestedDaypart === "afternoon" || state.requestedDaypart === "evening") period = "PM";
    else period = hour >= 1 && hour <= 6 || hour === 12 ? "PM" : "AM";
  }
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function selectOfferedSlot(speech: string, state: LiveBookingState): BookingSlotState | null {
  const visible = state.offeredSlots.slice(0, 3);
  if (!visible.length) return null;
  if (visible.length === 1 && YES.test(speech)) return visible[0];
  if (/\b(first|one|1)\b/i.test(speech) && !/\b(?:a\.?m\.?|p\.?m\.?)\b/i.test(speech)) return visible[0] ?? null;
  if (/\b(second|two|2)\b/i.test(speech) && !/\b(?:a\.?m\.?|p\.?m\.?)\b/i.test(speech)) return visible[1] ?? null;
  if (/\b(third|three|3)\b/i.test(speech) && !/\b(?:a\.?m\.?|p\.?m\.?)\b/i.test(speech)) return visible[2] ?? null;
  const time = parseTimeText(speech, state);
  if (!time || !TIME_SELECTION.test(speech)) return null;
  return visible.find(slot => slot.label.toUpperCase().includes(time.toUpperCase())) ?? null;
}

function knownPhone(state: LiveBookingState): boolean {
  return !!state.customerPhone && (state.customerPhoneSource === "caller_id" || state.customerPhoneSource === "existing_contact");
}

function finalSummary(state: LiveBookingState): string {
  const service = state.serviceName || "appointment";
  const slot = state.selectedSlot?.label || "the selected time";
  const phone = state.customerPhone ? naturalPhone(state.customerPhone) : "the saved number";
  const phoneLead = state.customerPhoneSource === "caller_id" ? "the number you're calling from" : "your saved number";
  return `Perfect. I have ${state.customerName} for ${service}, ${slot}, and I'll use ${phoneLead}, ${phone}, for the confirmation. Is all of that correct?`;
}

async function ensureCallerIdSource(state: LiveBookingState, call: any): Promise<LiveBookingState> {
  const from = call.log?.fromNumber && call.log.fromNumber !== "Anonymous" ? normalizedPhone(call.log.fromNumber) : "";
  if (!from) return state;
  if (!state.customerPhone) {
    return setCustomerDetails(state.callSid, state.companyId, {
      customerPhone: from,
      customerPhoneSource: "caller_id",
      customerPhoneConfirmed: false,
    }, state.stateVersion);
  }
  if (normalizedPhone(state.customerPhone) === from && state.customerPhoneSource === null) {
    return setCustomerDetails(state.callSid, state.companyId, {
      customerPhoneSource: "caller_id",
      customerPhoneConfirmed: false,
    }, state.stateVersion);
  }
  return state;
}

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech) { next(); return; }

  try {
    const call = await resolveCall(req, callSid);
    if (!call) { next(); return; }

    let state = peekBookingState(callSid);
    if (state) state = await ensureCallerIdSource(state, call);

    const askedForService = state?.lastAction === "ASK_SERVICE";
    if (!state?.serviceId && (BOOKING_INTENT.test(speech) || askedForService)) {
      const services = await loadServices(call.companyId);
      const ranked = services
        .map(service => ({ service, score: serviceScore(speech, service.name, service.description) }))
        .sort((a, b) => b.score - a.score);
      const matched = ranked[0]?.score >= 4 ? ranked[0].service : null;
      const candidate = explicitServiceCandidate(speech, askedForService);

      if (matched) {
        state = state ?? getBookingState(callSid, call.companyId);
        state = await ensureCallerIdSource(state, call);
        state = setSchedulingPreference(callSid, state.companyId, {
          serviceId: matched.id,
          serviceName: matched.name,
        }, state.stateVersion);
        logger.info({ callSid, companyId: state.companyId, serviceId: matched.id, serviceName: matched.name }, "Captured and persisted service intent before booking intake");
      } else if (candidate && services.length) {
        state = state ?? getBookingState(callSid, call.companyId);
        state = await ensureCallerIdSource(state, call);
        state = setBookingAction(callSid, state.companyId, "ESCALATE_TO_HUMAN", state.stateVersion);
        logger.info({ callSid, companyId: state.companyId, requestedService: candidate }, "Explicit service is not an approved bookable service");
        res.type("text/xml").send(gatherResponse(req, `I don't see ${candidate} as an approved bookable service on this schedule. I'll have someone from the team help with that request.`));
        return;
      }
    }

    state = peekBookingState(callSid);
    if (!state) { next(); return; }
    state = await ensureCallerIdSource(state, call);

    if (state.lastAction === "CONFIRM_BOOKING" && knownPhone(state) && !state.customerPhoneConfirmed && YES.test(speech)) {
      state = setCustomerDetails(callSid, state.companyId, { customerPhoneConfirmed: true }, state.stateVersion);
      logger.info({ callSid, phoneSource: state.customerPhoneSource }, "Confirmed known phone as part of final booking confirmation");
      next();
      return;
    }

    if (state.offeredSlots.length && !state.selectedSlot) {
      const chosen = selectOfferedSlot(speech, state);
      if (chosen) {
        state = holdBookingSlot(callSid, state.companyId, chosen, undefined, state.stateVersion);
        state = setBookingAction(callSid, state.companyId, "HOLD_SLOT", state.stateVersion);
        logger.info({ callSid, selected: chosen.iso, label: chosen.label }, "Context guard held accepted offered slot");

        if (!state.customerName) {
          state = setBookingAction(callSid, state.companyId, "ASK_NAME", state.stateVersion);
          res.type("text/xml").send(gatherResponse(req, "Great. What's the name for the appointment?"));
          return;
        }
        if (!state.customerPhone) {
          state = setBookingAction(callSid, state.companyId, "ASK_PHONE_CONFIRMATION", state.stateVersion);
          res.type("text/xml").send(gatherResponse(req, "What's the best phone number for the confirmation?"));
          return;
        }
        if (knownPhone(state) && !state.customerPhoneConfirmed) {
          state = setBookingAction(callSid, state.companyId, "CONFIRM_BOOKING", state.stateVersion);
          res.type("text/xml").send(gatherResponse(req, finalSummary(state)));
          return;
        }
        next();
        return;
      }
    }

    if (state.selectedSlot && state.lastAction === "ASK_NAME") {
      const name = simpleName(speech);
      if (name) {
        state = setCustomerDetails(callSid, state.companyId, { customerName: name }, state.stateVersion);
        if (!state.customerPhone) {
          state = setBookingAction(callSid, state.companyId, "ASK_PHONE_CONFIRMATION", state.stateVersion);
          res.type("text/xml").send(gatherResponse(req, "Thanks. What's the best phone number for the confirmation?"));
          return;
        }
        if (knownPhone(state) && !state.customerPhoneConfirmed) {
          state = setBookingAction(callSid, state.companyId, "CONFIRM_BOOKING", state.stateVersion);
          res.type("text/xml").send(gatherResponse(req, finalSummary(state)));
          return;
        }
      }
    }

    if (state.selectedSlot && BOOK_NOW.test(speech)) {
      if (!state.customerName) {
        state = setBookingAction(callSid, state.companyId, "ASK_NAME", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "Absolutely. What's the name for the appointment?"));
        return;
      }
      if (!state.customerPhone) {
        state = setBookingAction(callSid, state.companyId, "ASK_PHONE_CONFIRMATION", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "What's the best phone number for the confirmation?"));
        return;
      }
      if (knownPhone(state) && !state.customerPhoneConfirmed) {
        state = setBookingAction(callSid, state.companyId, "CONFIRM_BOOKING", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, finalSummary(state)));
        return;
      }
    }

    next();
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking context guard failed; continuing to existing booking flow");
    next();
  }
});

export default router;
