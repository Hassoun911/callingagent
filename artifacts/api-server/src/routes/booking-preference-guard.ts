import { Router, type IRouter } from "express";
import {
  holdBookingSlot,
  peekBookingState,
  setBookingAction,
  setSchedulingPreference,
  type BookingDaypart,
  type LiveBookingState,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";

const BOOK_NOW = /\b(book it|book that|go ahead(?: and)? book(?: it| that)?|let'?s book(?: it| that)?|confirm it|take it|lock it in)\b/i;
const TIME_QUESTION = /\b(do you have|have you got|anything (?:at|around|for)|something (?:at|around|near)|is .* available|what about|how about|can you do|could you do|do you have anything)\b/i;
const TIME_SELECTION = /\b(?:i(?:'ll| will)? take|works|work for me|is good|sounds good|perfect|please|let'?s do|that one|that works|i want|i need|i said|again)\b/i;
const TIME_CORRECTION = /\b(?:i said|i want|i need|again|around|about|near|prefer|preferably)\b/i;

const DAY_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:monday|mon)\b/i, "Monday"],
  [/\b(?:tuesday|tues|tue)\b/i, "Tuesday"],
  [/\b(?:wednesday|weds|wed|wensday|wednsday|when'?s\s*day)\b/i, "Wednesday"],
  [/\b(?:thursday|thurs|thur|thu)\b/i, "Thursday"],
  [/\b(?:friday|fri)\b/i, "Friday"],
  [/\b(?:saturday|sat)\b/i, "Saturday"],
  [/\b(?:sunday|sun)\b/i, "Sunday"],
];

const SPOKEN_HOURS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
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

function requestedDay(speech: string): string | null {
  if (/\btoday\b/i.test(speech)) return "today";
  if (/\btomorrow\b/i.test(speech)) return "tomorrow";
  for (const [pattern, canonical] of DAY_ALIASES) {
    if (pattern.test(speech)) return canonical;
  }
  return null;
}

function explicitDaypart(speech: string): BookingDaypart | undefined {
  if (/\bmorning\b/i.test(speech)) return "morning";
  if (/\bafternoon\b/i.test(speech)) return "afternoon";
  if (/\b(evening|tonight|night)\b/i.test(speech)) return "evening";
  return undefined;
}

function inferPeriod(hour: number, state: LiveBookingState, speech: string): "AM" | "PM" {
  if (/\bmorning\b/i.test(speech) || state.requestedDaypart === "morning") return "AM";
  if (/\b(afternoon|evening|tonight|night)\b/i.test(speech) || state.requestedDaypart === "afternoon" || state.requestedDaypart === "evening") return "PM";
  if (hour >= 1 && hour <= 6) return "PM";
  if (hour === 12) return "PM";
  return "AM";
}

function formatTime(hour: number, minute: number, period: "AM" | "PM"): string {
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function parsedTime(speech: string, state: LiveBookingState): { hour: number; minute: number; period: "AM" | "PM"; normalized: string } | null {
  const explicit = speech.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (explicit) {
    const rawHour = explicit[1];
    const hour = /^\d+$/.test(rawHour) ? Number(rawHour) : SPOKEN_HOURS[rawHour.toLowerCase()];
    const minute = explicit[2] ? Number(explicit[2]) : 0;
    if (!hour || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    const period: "AM" | "PM" = explicit[3].toLowerCase().startsWith("p") ? "PM" : "AM";
    return { hour, minute, period, normalized: formatTime(hour, minute, period) };
  }

  const digitMatch = speech.match(/\b(?:at|around|about|near|for)?\s*(\d{1,2})(?::(\d{2}))?\b/i);
  let hour: number | null = null;
  let minute = 0;
  if (digitMatch) {
    hour = Number(digitMatch[1]);
    minute = digitMatch[2] ? Number(digitMatch[2]) : 0;
  } else {
    const wordMatch = speech.match(/\b(?:at|around|about|near|for)?\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
    if (wordMatch) hour = SPOKEN_HOURS[wordMatch[1].toLowerCase()] ?? null;
  }

  if (hour == null || hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const wordCount = speech.trim().split(/\s+/).length;
  const bookingTimeContext = TIME_QUESTION.test(speech)
    || TIME_SELECTION.test(speech)
    || TIME_CORRECTION.test(speech)
    || /\b(?:at|around|about|near)\b/i.test(speech)
    || wordCount <= 3
    || (state.offeredSlots.length > 0 && wordCount <= 6);
  if (!bookingTimeContext) return null;
  const period = inferPeriod(hour, state, speech);
  return { hour, minute, period, normalized: formatTime(hour, minute, period) };
}

function offeredSlotAtTime(state: LiveBookingState, normalizedTime: string) {
  const canonical = normalizedTime.replace(/^0/, "").toUpperCase();
  return state.offeredSlots.find(slot => slot.label.toUpperCase().includes(canonical)) ?? null;
}

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech) {
    next();
    return;
  }

  let state = peekBookingState(callSid);
  if (!state) {
    next();
    return;
  }

  try {
    if (BOOK_NOW.test(speech) && state.selectedSlot) {
      if (!state.customerName) {
        state = setBookingAction(callSid, state.companyId, "ASK_NAME", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "Absolutely. What's the name for the appointment?"));
        return;
      }
      if (!state.customerPhone) {
        state = setBookingAction(callSid, state.companyId, "ASK_PHONE_CONFIRMATION", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "Absolutely. What's the best phone number for the confirmation?"));
        return;
      }
      next();
      return;
    }

    const newDay = requestedDay(speech);
    const time = parsedTime(speech, state);
    const part = explicitDaypart(speech);
    const dayChanged = !!newDay && newDay !== state.requestedDay;

    if (dayChanged) {
      const patch: Parameters<typeof setSchedulingPreference>[2] = { requestedDay: newDay };
      if (part !== undefined) patch.requestedDaypart = part;
      if (time) {
        patch.requestedTime = time.normalized;
        if (part === undefined) patch.requestedDaypart = time.period === "AM" ? "morning" : "afternoon";
      }
      state = setSchedulingPreference(callSid, state.companyId, patch, state.stateVersion);

      if (part === undefined && !time) {
        state = setBookingAction(callSid, state.companyId, "ASK_DAYPART", state.stateVersion);
        logger.info({ callSid, requestedDay: state.requestedDay }, "Day selected without daypart; collecting preference before availability search");
        res.type("text/xml").send(gatherResponse(req, `Sure. Do you prefer morning, afternoon, or evening on ${newDay}?`));
        return;
      }

      logger.info({ callSid, requestedDay: state.requestedDay, requestedTime: state.requestedTime, daypart: state.requestedDaypart }, "Caller changed booking day; invalidated stale offers immediately");
      next();
      return;
    }

    if (time) {
      if (state.offeredSlots.length && (TIME_SELECTION.test(speech) || TIME_CORRECTION.test(speech))) {
        const offered = offeredSlotAtTime(state, time.normalized);
        if (offered) {
          state = holdBookingSlot(callSid, state.companyId, offered, undefined, state.stateVersion);
          state = setBookingAction(callSid, state.companyId, "HOLD_SLOT", state.stateVersion);
          req.body.SpeechResult = "yes";
          logger.info({ callSid, selected: offered.iso, label: offered.label }, "Accepted exact offered slot before time-preference mutation");
          next();
          return;
        }
      }

      if (TIME_QUESTION.test(speech) || TIME_CORRECTION.test(speech) || (state.offeredSlots.length > 0 && /\b(?:at|around|about|near)\b/i.test(speech))) {
        const patch: Parameters<typeof setSchedulingPreference>[2] = {
          requestedTime: time.normalized,
          ...(part !== undefined ? { requestedDaypart: part } : { requestedDaypart: time.period === "AM" ? "morning" : "afternoon" }),
        };
        state = setSchedulingPreference(callSid, state.companyId, patch, state.stateVersion);
        logger.info({ callSid, requestedDay: state.requestedDay, requestedTime: time.normalized }, "Caller corrected or requested a specific time; forcing fresh availability check");
        next();
        return;
      }

      if (TIME_SELECTION.test(speech) || speech.trim().split(/\s+/).length <= 2) {
        req.body.SpeechResult = `${speech} ${time.normalized}`;
      }
    }

    next();
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking preference interrupt guard failed; continuing to orchestrator");
    next();
  }
});

export default router;
