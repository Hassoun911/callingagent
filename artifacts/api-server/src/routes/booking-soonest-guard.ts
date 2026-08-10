import { Router, type IRouter } from "express";
import { peekBookingState, setSchedulingPreference } from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const SOONEST = /\b(soonest|earliest|first available|next available|as soon as possible|as soon as you can|asap|whatever you have first|book me the soonest)\b/i;

router.use("/twilio/ai-gather", (req: any, _res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech || !SOONEST.test(speech)) {
    next();
    return;
  }

  try {
    const state = peekBookingState(callSid);
    if (!state) {
      next();
      return;
    }

    setSchedulingPreference(callSid, state.companyId, {
      requestedDay: "soonest",
      requestedDaypart: null,
      requestedTime: null,
    }, state.stateVersion);
    logger.info({ callSid, companyId: state.companyId }, "Caller requested earliest real availability");
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Could not apply soonest scheduling preference");
  }

  next();
});

export default router;
