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
  type BookingPhoneSource,
  type BookingSlotState,
  type LiveBookingState,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";
const INTAKE_TTL_MS = 15 * 60_000;

const BOOKING_INTENT = /\b(book|booking|appointment|appt|schedule|scheduled|scheduling)\b/i;
const SERVICE_REQUEST = /\b(need|want|looking for|trying to get|come in for|get|have)\b/i;
const SOONEST = /\b(soonest|earliest|first available|next available|as soon as possible|as soon as you can|asap)\b/i;
const SCHEDULING_PREFERENCE = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tonight)\b/i;
const YES = /\b(yes|yeah|yep|yup|sure|correct|right|that's right|that is right|perfect|sounds good|go ahead|confirm|book it)\b/i;
const BOOK_NOW = /\b(book it|book that|go ahead(?: and)? book(?: it| that)?|let'?s book(?: it| that)?|confirm it|take it|lock it in)\b/i;
const TIME_SELECTION = /\b(?:i(?:'ll| will)? take|works|work for me|is good|sounds good|perfect|that one|that works|let'?s do|i want|i need|i said|again)\b/i;
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
const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4" };
const SERVICE_SYNONYMS: Record<string, string> = {
  fix: "repair", fixing: "repair", patched: "repair", patch: "repair", puncture: "repair", leaking: "leak",
};
const NAME_CONTROL_WORDS = /\b(?:book|booking|appointment|schedule|service|available|availability|morning|afternoon|evening|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|cancel|change|phone|number|email|address)\b/i;

type FactCarrier = {
  customerName: string | null;
  customerPhone: string | null;
  customerPhoneSource: BookingPhoneSource;
  notes: Record<string, string>;
  serviceAnswers: Record<string, string>;
};

type IntakeMemory = FactCarrier & {
  companyId: number;
  serviceId: number | null;
  serviceName: string | null;
  customerPhoneConfirmed: boolean;
  expiresAt: number;
};

const intakeMemory = new Map<string, IntakeMemory>();

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
  if (lower.includes(name.toLowerCase())) return 100;
  const speechWords = normalizedServiceWords(lower).filter(word => word.length > 2 && !SERVICE_STOPWORDS.has(word));
  const nameWords = normalizedServiceWords(name).filter(word => word.length > 2 && !SERVICE_STOPWORDS.has(word));
  const descriptionWords = normalizedServiceWords(description ?? "");
  let score = 0;
  for (const word of speechWords) {
    if (nameWords.includes(word)) score += word.length >= 5 ? 4 : 3;
    else if (descriptionWords.includes(word)) score += 1;
  }
  const missingNameWords = nameWords.filter(word => !speechWords.includes(word));
  score -= missingNameWords.length * 10;
  if (nameWords.length && missingNameWords.length === 0) score += 30;
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
  const words = cleaned.split(/\s+/).filter(Boolean).filter(word => !SERVICE_STOPWORDS.has(word));
  if (!words.length) return null;
  return words.slice(0, 6).join(" ");
}

function explicitServiceCandidate(speech: string, askedForService: boolean): string | null {
  const lower = speech.toLowerCase().replace(/\bappt\b/g, "appointment");
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
  if (askedForService) return cleanServicePhrase(lower);
  if (!BOOKING_INTENT.test(lower)) return null;
  return null;
}

function simpleName(speech: string): string | null {
  let candidate = speech.trim();
  if (!candidate) return null;
  const embedded = candidate.match(/\b(?:my\s+name(?:\s+is|'s)|the\s+name\s+is|name\s+is|this\s+is|it\s+is|it's|i\s+am|i'm)\s+([A-Za-z][A-Za-z' -]{0,60}?)(?=[,.!?]|\s+(?:my\s+phone|phone\s+number|callback\s+number|and\s+my)|$)/i)?.[1];
  if (embedded) candidate = embedded;
  candidate = candidate
    .replace(/^[\s,.!-]*(?:yes|yeah|yep|yup|sure|okay|ok|correct|right)[\s,.!-]+/i, "")
    .replace(/^\s*(?:my\s+name(?:\s+is|'s)|the\s+name\s+is|name\s+is|this\s+is|it\s+is|it's|i\s+am|i'm)\s+/i, "")
    .replace(/\s+(?:here|speaking)\s*[.!]?$/i, "")
    .replace(/[.!?,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!candidate || candidate.length > 60) return null;
  if (NAME_CONTROL_WORDS.test(candidate) || BOOK_NOW.test(candidate)) return null;
  if (/\d|@/.test(candidate)) return null;
  if (!/^[A-Za-z][A-Za-z' -]*$/.test(candidate)) return null;
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 5) return null;
  return candidate;
}

function spokenPhone(speech: string): string | null {
  const raw = speech.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
  return raw ? normalizedPhone(raw) : null;
}

function serviceLocation(speech: string): string | null {
  const match = speech.match(/\b(?:current\s+location|service\s+address|location|address)\s*(?:is|at)?\s+(.+?)(?=(?:[.!?]\s|$))/i);
  if (!match?.[1]) return null;
  const value = match[1].trim().replace(/[,.!?]+$/g, "");
  return /\d/.test(value) && value.length >= 6 ? value : null;
}

function vehicleDescription(speech: string): string | null {
  const match = speech.match(/\b((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z0-9-]+){1,4})(?=[,.!?]|$)/);
  return match?.[1]?.trim() ?? null;
}

function durableFactPatch(carrier: FactCarrier, speech: string): Parameters<typeof setCustomerDetails>[2] | null {
  const patch: Parameters<typeof setCustomerDetails>[2] = {};
  const notes: Record<string, string> = {};
  const serviceAnswers: Record<string, string> = {};

  if (!carrier.customerName) {
    const name = simpleName(speech);
    if (name && /\b(?:name|this is|it is|it's|i am|i'm)\b/i.test(speech)) patch.customerName = name;
  }
  const phone = spokenPhone(speech);
  if (phone && (carrier.customerPhoneSource !== "spoken" || normalizedPhone(carrier.customerPhone) !== phone)) {
    patch.customerPhone = phone;
    patch.customerPhoneSource = "spoken";
    patch.customerPhoneConfirmed = true;
  }
  if (!carrier.notes.service_location) {
    const location = serviceLocation(speech);
    if (location) notes.service_location = location;
  }
  if (!carrier.notes.vehicle) {
    const vehicle = vehicleDescription(speech);
    if (vehicle) notes.vehicle = vehicle;
  }
  if (!carrier.serviceAnswers.tire_size && /\btire\s+size\b/i.test(speech) && /\b(?:don't know|do not know|not sure|unknown)\b/i.test(speech)) {
    serviceAnswers.tire_size = "unknown";
  }
  if (!carrier.serviceAnswers.tire_size) {
    const size = speech.match(/\b\d{3}\/\d{2}\s*[Rr]\s*\d{2}\b/)?.[0];
    if (size) serviceAnswers.tire_size = size.replace(/\s+/g, "").toUpperCase();
  }
  if (!carrier.serviceAnswers.tire_count && /\b(?:tire|tires|rim|rims|mounted)\b/i.test(speech)) {
    const countMatch = speech.match(/\b(one|two|three|four|1|2|3|4)\b/i)?.[1]?.toLowerCase();
    if (countMatch) serviceAnswers.tire_count = NUMBER_WORDS[countMatch] ?? countMatch;
  }
  if (!carrier.serviceAnswers.mounted_on_rims && /\b(?:rim|rims|mounted)\b/i.test(speech)) {
    if (/\b(?:not|isn't|is not|aren't|are not)\s+(?:already\s+)?mounted\b/i.test(speech)) serviceAnswers.mounted_on_rims = "no";
    else if (/\b(?:already\s+)?mounted\s+on\s+(?:the\s+)?rims?\b/i.test(speech)) serviceAnswers.mounted_on_rims = "yes";
  }
  if (!carrier.serviceAnswers.service_urgency) {
    if (/\bregular\b/i.test(speech)) serviceAnswers.service_urgency = "regular";
    else if (/\b(?:stranded|unsafe to drive|emergency)\b/i.test(speech)) serviceAnswers.service_urgency = "emergency";
  }
  if (Object.keys(notes).length) patch.notes = notes;
  if (Object.keys(serviceAnswers).length) patch.serviceAnswers = serviceAnswers;
  return Object.keys(patch).length ? patch : null;
}

function memoryFor(callSid: string): IntakeMemory | null {
  const memory = intakeMemory.get(callSid);
  if (!memory) return null;
  if (memory.expiresAt <= Date.now()) { intakeMemory.delete(callSid); return null; }
  memory.expiresAt = Date.now() + INTAKE_TTL_MS;
  return memory;
}

function mergeMemory(callSid: string, companyId: number, patch: Partial<IntakeMemory>): IntakeMemory {
  const current = memoryFor(callSid) ?? {
    companyId,
    serviceId: null,
    serviceName: null,
    customerName: null,
    customerPhone: null,
    customerPhoneSource: null,
    customerPhoneConfirmed: false,
    notes: {},
    serviceAnswers: {},
    expiresAt: Date.now() + INTAKE_TTL_MS,
  };
  const next: IntakeMemory = {
    ...current,
    ...patch,
    notes: { ...current.notes, ...(patch.notes ?? {}) },
    serviceAnswers: { ...current.serviceAnswers, ...(patch.serviceAnswers ?? {}) },
    expiresAt: Date.now() + INTAKE_TTL_MS,
  };
  intakeMemory.set(callSid, next);
  return next;
}

function hydrateBookingState(callSid: string, companyId: number, memory: IntakeMemory): LiveBookingState {
  let state = getBookingState(callSid, companyId);
  if (memory.serviceId) {
    state = setSchedulingPreference(callSid, companyId, { serviceId: memory.serviceId, serviceName: memory.serviceName }, state.stateVersion);
  }
  state = setCustomerDetails(callSid, companyId, {
    customerName: memory.customerName,
    customerPhone: memory.customerPhone,
    customerPhoneSource: memory.customerPhoneSource,
    customerPhoneConfirmed: memory.customerPhoneConfirmed,
    notes: memory.notes,
    serviceAnswers: memory.serviceAnswers,
  }, state.stateVersion);
  intakeMemory.delete(callSid);
  return state;
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

async function ensureCallerIdSource(state: LiveBookingState, call: any): Promise<LiveBookingState> {
  const from = call.log?.fromNumber && call.log.fromNumber !== "Anonymous" ? normalizedPhone(call.log.fromNumber) : "";
  if (!from) return state;
  if (!state.customerPhone) {
    return setCustomerDetails(state.callSid, state.companyId, { customerPhone: from, customerPhoneSource: "caller_id", customerPhoneConfirmed: false }, state.stateVersion);
  }
  if (normalizedPhone(state.customerPhone) === from && state.customerPhoneSource === null) {
    return setCustomerDetails(state.callSid, state.companyId, { customerPhoneSource: "caller_id", customerPhoneConfirmed: false }, state.stateVersion);
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
    let memory = memoryFor(callSid);
    const askedForService = state?.lastAction === "ASK_SERVICE";
    const activateScheduling = BOOKING_INTENT.test(speech) || SOONEST.test(speech) || SCHEDULING_PREFERENCE.test(speech) || askedForService;
    const serviceSignal = BOOKING_INTENT.test(speech) || SERVICE_REQUEST.test(speech) || askedForService;

    if (!state?.serviceId && !memory?.serviceId && serviceSignal) {
      const services = await loadServices(call.companyId);
      const ranked = services.map(service => ({ service, score: serviceScore(speech, service.name, service.description) })).sort((a, b) => b.score - a.score);
      const matched = ranked[0]?.score >= 10 ? ranked[0].service : null;
      const candidate = explicitServiceCandidate(speech, askedForService);

      if (matched) {
        if (activateScheduling) {
          state = state ?? getBookingState(callSid, call.companyId);
          state = setSchedulingPreference(callSid, state.companyId, { serviceId: matched.id, serviceName: matched.name }, state.stateVersion);
        } else {
          memory = mergeMemory(callSid, call.companyId, { serviceId: matched.id, serviceName: matched.name });
        }
        logger.info({ callSid, companyId: call.companyId, serviceId: matched.id, serviceName: matched.name, activated: activateScheduling }, "Captured durable service intent");
      } else if (candidate && services.length && (askedForService || BOOKING_INTENT.test(speech))) {
        state = state ?? getBookingState(callSid, call.companyId);
        state = setBookingAction(callSid, state.companyId, "ESCALATE_TO_HUMAN", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, `I don't see ${candidate} as an approved bookable service on this schedule. I'll have someone from the team help with that request.`));
        return;
      }
    }

    if (!state) {
      memory = memoryFor(callSid);
      if (memory) {
        const factPatch = durableFactPatch(memory, speech);
        if (factPatch) {
          memory = mergeMemory(callSid, call.companyId, {
            customerName: factPatch.customerName ?? memory.customerName,
            customerPhone: factPatch.customerPhone ?? memory.customerPhone,
            customerPhoneSource: factPatch.customerPhoneSource ?? memory.customerPhoneSource,
            customerPhoneConfirmed: factPatch.customerPhoneConfirmed ?? memory.customerPhoneConfirmed,
            notes: factPatch.notes,
            serviceAnswers: factPatch.serviceAnswers,
          });
          logger.info({ callSid, customerName: memory.customerName, phoneSource: memory.customerPhoneSource, notes: memory.notes, serviceAnswers: memory.serviceAnswers }, "Stored receptionist intake facts before scheduling activation");
        }
        if (activateScheduling && memory.serviceId) {
          state = hydrateBookingState(callSid, call.companyId, memory);
          logger.info({ callSid, companyId: state.companyId, serviceId: state.serviceId, customerName: state.customerName }, "Hydrated central booking state from receptionist intake memory");
        }
      }
    }

    if (!state) { next(); return; }
    state = await ensureCallerIdSource(state, call);
    const factPatch = durableFactPatch(state, speech);
    if (factPatch) state = setCustomerDetails(callSid, state.companyId, factPatch, state.stateVersion);

    if (state.lastAction === "CONFIRM_BOOKING" && state.customerPhone && !state.customerPhoneConfirmed && YES.test(speech)) {
      state = setCustomerDetails(callSid, state.companyId, { customerPhoneConfirmed: true }, state.stateVersion);
      next();
      return;
    }

    if (state.lastAction === "ASK_NAME") {
      if (!state.customerName) {
        const name = simpleName(speech);
        if (!name) {
          res.type("text/xml").send(gatherResponse(req, "Sorry, I didn't catch the name. Please say the name you'd like on the appointment."));
          return;
        }
        state = setCustomerDetails(callSid, state.companyId, { customerName: name }, state.stateVersion);
      }
      if (!state.customerPhone) {
        state = setBookingAction(state.callSid, state.companyId, "ASK_PHONE_CONFIRMATION", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "Thanks. What's the best phone number for the confirmation?"));
        return;
      }
      next();
      return;
    }

    if (state.offeredSlots.length && !state.selectedSlot) {
      const chosen = selectOfferedSlot(speech, state);
      if (chosen) {
        state = holdBookingSlot(callSid, state.companyId, chosen, undefined, state.stateVersion);
        state = setBookingAction(callSid, state.companyId, "HOLD_SLOT", state.stateVersion);
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
        next();
        return;
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
      next();
      return;
    }

    next();
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking context guard failed; continuing to existing booking flow");
    next();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [callSid, memory] of intakeMemory) if (memory.expiresAt <= now) intakeMemory.delete(callSid);
}, 60_000).unref();

export default router;
