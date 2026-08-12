import { Router, type IRouter } from "express";
import {
  peekBookingState,
  setAvailabilityResult,
  setBookingAction,
  type BookingSlotState,
} from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";

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

function canonicalTime(value: string): string {
  return value.toUpperCase().replace(/^0/, "").replace(/\s+/g, " ").trim();
}

function slotTime(slot: BookingSlotState): string | null {
  const match = slot.label.match(/\b(\d{1,2}:\d{2}\s*[AP]M)\b/i);
  return match ? canonicalTime(match[1].replace(/\s*([AP]M)$/i, " $1")) : null;
}

function exactSlot(slots: BookingSlotState[], requestedTime: string): BookingSlotState | null {
  const target = canonicalTime(requestedTime);
  return slots.find(slot => slotTime(slot) === target) ?? null;
}

function alternativeTimes(slots: BookingSlotState[], requestedTime: string): string[] {
  const target = canonicalTime(requestedTime);
  return Array.from(new Set(slots.map(slotTime).filter((value): value is string => Boolean(value) && value !== target))).slice(0, 3);
}

function naturalAlternatives(times: string[]): string {
  if (times.length === 1) return times[0];
  if (times.length === 2) return `${times[0]} or ${times[1]}`;
  return `${times[0]}, ${times[1]}, or ${times[2]}`;
}

router.use("/twilio/booking-availability-result", (req: any, res: any, next: any) => {
  const originalSend = res.send.bind(res);

  res.send = ((body: any) => {
    try {
      const callSid = String(req.query?.callSid ?? req.body?.CallSid ?? "");
      let state = callSid ? peekBookingState(callSid) : null;
      if (!state?.requestedTime) return originalSend(body);

      const dayText = state.requestedDay && state.requestedDay !== "soonest" ? ` on ${state.requestedDay}` : "";

      if (state.lastAction === "OFFER_SLOTS" && state.offeredSlots.length) {
        const exact = exactSlot(state.offeredSlots, state.requestedTime);
        if (exact) {
          // Narrow the active offer to the exact requested time. This makes a
          // simple caller response such as "yes" select that exact slot instead
          // of leaving several nearby alternatives active.
          state = setAvailabilityResult(callSid, state.companyId, [exact], state.stateVersion);
          state = setBookingAction(callSid, state.companyId, "OFFER_SLOTS", state.stateVersion);
          logger.info({ callSid, requestedTime: state.requestedTime, exactSlot: exact.iso }, "Exact requested appointment time is available; prioritizing it exclusively");
          return originalSend(gatherResponse(req, `Yes. I have ${state.requestedTime}${dayText} available. Does that work?`));
        }

        const alternatives = alternativeTimes(state.offeredSlots, state.requestedTime);
        const alternativeText = alternatives.length
          ? ` The closest times I have are ${naturalAlternatives(alternatives)}.`
          : "";
        logger.info({ callSid, requestedTime: state.requestedTime, alternatives }, "Exact requested appointment time unavailable; explaining before alternatives");
        return originalSend(gatherResponse(req, `I don't have ${state.requestedTime}${dayText} available.${alternativeText} Would one of those work?`));
      }

      if (state.lastAction === "NO_AVAILABILITY") {
        logger.info({ callSid, requestedTime: state.requestedTime }, "No availability for exact requested appointment time");
        return originalSend(gatherResponse(req, `I don't have ${state.requestedTime}${dayText} available. Would you like me to check a different time or another day?`));
      }
    } catch (error: any) {
      logger.warn({ err: error?.message }, "Exact-time response guard failed; keeping orchestrator response");
    }

    return originalSend(body);
  }) as typeof res.send;

  next();
});

export default router;
