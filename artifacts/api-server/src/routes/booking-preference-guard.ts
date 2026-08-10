import { Router, type IRouter } from "express";
import {
  peekBookingState,
  setBookingAction,
  setSchedulingPreference,
  type BookingDaypart,
  type LiveBookingState,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";

const BOOK_NOW = /\b(book it|book that|go ahead(?: and)? book(?: it| that)?|let'?s book(?: it| that)?|confirm it|take it)\b/i;
const TIME_QUESTION = /\b(do you have|have you got|anything (?:at|around|for)|is .* available|what about|how about|can you do|could you do)\b/i;
const TIME_SELECTION = /\b(?:i(?:'ll| will)? take|works|work for me|is good|sounds good|perfect|please|let'?s do)\b/i;

const DAY_ALIASES: Array<[RegExp, string]> = [
  [/\b(?:monday|mon)\b/i, "Monday"],
  [/\b(?:tuesday|tues|tue)\b/i, "Tuesday"],
  [/\b(?:wednesday|weds|wed)\b/i, "Wednesday"],
  [/\b(?:thursday|thurs|thur|thu)\b/i, "Thursday"],
  [/\b(?:friday|fri)\b/i, "Friday"],
  [/\b(?:saturday|sat)\b/i, "Saturday"],
  [/\b(?:sunday|sun)\b/i, "Sunday"],
];

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

function bareTime(speech: string): { hour: number; minute: number } | null {
  // Explicit AM/PM is already handled by the orchestrator. This specifically
  // catches normal receptionist language such as "do you have 4?".
  if (/\b\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)\b/i.test(speech)) return null;
  const match = speech.match(/\b(?:at|around|about|near|for)?\s*(\d{1,2})(?::(\d{2}))?\b/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;

  // Do not treat unrelated bare numbers as times unless the utterance clearly
  // refers to availability/selection or is a very short booking reply.
  const bookingTimeContext = TIME_QUESTION.test(speech) || TIME_SELECTION.test(speech) || speech.trim().split(/\s+/).length <= 3;
  return bookingTimeContext ? { hour, minute } : null;
}

function inferPeriod(hour: number, state: LiveBookingState, speech: string): "AM" | "PM" {
  if (/\bmorning\b/i.test(speech) || state.requestedDaypart === "morning") return "AM";
  if (/\b(afternoon|evening|tonight|night)\b/i.test(speech) || state.requestedDaypart === "afternoon" || state.requestedDaypart === "evening") return "PM";
  // In appointment conversation, 1–6 without a period is overwhelmingly an
  // afternoon request. 7–11 defaults to morning; 12 defaults to noon.
  if (hour >= 1 && hour <= 6) return "PM";
  if (hour === 12) return "PM";
  return "AM";
}

function formatTime(hour: number, minute: number, period: "AM" | "PM"): string {
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
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
    // "Book it" is a control instruction, never a customer name or ordinary
    // filler. If required details are missing, ask for exactly the next one.
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
      if (!state.customerPhoneConfirmed) {
        state = setBookingAction(callSid, state.companyId, "ASK_PHONE_CONFIRMATION", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "Absolutely. Should I use the number you're calling from for the confirmation?"));
        return;
      }

      // Treat the caller's explicit "book it" as confirmation of the currently
      // held slot even if the prior action marker was not CONFIRM_BOOKING.
      state = setBookingAction(callSid, state.companyId, "CONFIRM_BOOKING", state.stateVersion);
      req.body.SpeechResult = "yes confirm book it";
      logger.info({ callSid, selected: state.selectedSlot.iso }, "Promoted explicit book-it instruction to final booking confirmation");
      next();
      return;
    }

    const newDay = requestedDay(speech);
    const time = bareTime(speech);
    const part = explicitDaypart(speech);
    const dayChanged = !!newDay && newDay !== state.requestedDay;

    // New day requests always beat old offered slots. This prevents Monday
    // choices from being replayed after "do you have Wednesday?".
    if (dayChanged) {
      const patch: Parameters<typeof setSchedulingPreference>[2] = { requestedDay: newDay };
      if (part !== undefined) patch.requestedDaypart = part;
      if (time) {
        const period = inferPeriod(time.hour, state, speech);
        patch.requestedTime = formatTime(time.hour, time.minute, period);
        if (part === undefined) patch.requestedDaypart = period === "AM" ? "morning" : "afternoon";
      }
      state = setSchedulingPreference(callSid, state.companyId, patch, state.stateVersion);
      logger.info({ callSid, requestedDay: state.requestedDay, requestedTime: state.requestedTime }, "Caller changed booking day; invalidated stale offers immediately");
      next();
      return;
    }

    if (time) {
      const period = inferPeriod(time.hour, state, speech);
      const normalizedTime = formatTime(time.hour, time.minute, period);

      // "Do you have 4?" is an availability request, not permission to claim 4
      // is open. Invalidate the old offer set and make the calendar check 4 PM.
      if (TIME_QUESTION.test(speech)) {
        const patch: Parameters<typeof setSchedulingPreference>[2] = {
          requestedTime: normalizedTime,
          ...(part !== undefined ? { requestedDaypart: part } : { requestedDaypart: period === "AM" ? "morning" : "afternoon" }),
        };
        state = setSchedulingPreference(callSid, state.companyId, patch, state.stateVersion);
        logger.info({ callSid, requestedDay: state.requestedDay, requestedTime: normalizedTime }, "Caller asked about a specific bare time; forcing fresh availability check");
        next();
        return;
      }

      // A short choice such as "4 works" should be understandable by the
      // existing slot selector, which expects an explicit AM/PM value.
      if (TIME_SELECTION.test(speech) || speech.trim().split(/\s+/).length <= 2) {
        req.body.SpeechResult = `${speech} ${normalizedTime}`;
      }
    }

    next();
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking preference interrupt guard failed; continuing to orchestrator");
    next();
  }
});

export default router;
