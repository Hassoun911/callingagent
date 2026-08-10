import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import { bookingRequirementsForCompanyName, missingRequiredBookingDetail, type MissingBookingDetail } from "../lib/booking-requirements";
import { peekBookingState, setBookingAction, setCustomerDetails, type LiveBookingState } from "../lib/booking-state-manager";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";
const NUMBER_WORDS: Record<string, string> = { one: "1", two: "2", three: "3", four: "4" };

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

function naturalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

function normalizePostalCode(speech: string): string | null {
  const compact = speech.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = compact.match(/[ABCEGHJKLMNPRSTVXY]\d[ABCEGHJKLMNPRSTVWXYZ]\d[ABCEGHJKLMNPRSTVWXYZ]\d/);
  if (!match) return null;
  return `${match[0].slice(0, 3)} ${match[0].slice(3)}`;
}

function vehicleFromSpeech(speech: string): string | null {
  return speech.match(/\b((?:19|20)\d{2}\s+[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z0-9-]+){1,4})(?=[,.!?]|$)/)?.[1]?.trim() ?? null;
}

function captureMissingDetail(state: LiveBookingState, missing: MissingBookingDetail, speech: string): LiveBookingState {
  const notes: Record<string, string> = {};
  const serviceAnswers: Record<string, string> = {};

  if (missing.key === "service_location") {
    const cleaned = speech.replace(/^\s*(?:the\s+)?(?:service\s+)?(?:address|location)\s*(?:is|at)?\s*/i, "").trim().replace(/[.!?]+$/g, "");
    if (/\d/.test(cleaned) && cleaned.length >= 6) notes.service_location = cleaned;
  } else if (missing.key === "postal_code") {
    const postal = normalizePostalCode(speech);
    if (postal) notes.postal_code = postal;
  } else if (missing.key === "vehicle") {
    const vehicle = vehicleFromSpeech(speech);
    if (vehicle) notes.vehicle = vehicle;
  } else if (missing.key === "tire_count") {
    const raw = speech.match(/\b(one|two|three|four|1|2|3|4)\b/i)?.[1]?.toLowerCase();
    if (raw) serviceAnswers.tire_count = NUMBER_WORDS[raw] ?? raw;
  } else if (missing.key === "mounted_on_rims") {
    if (/\b(no|nope|not|isn't|aren't|without)\b/i.test(speech)) serviceAnswers.mounted_on_rims = "no";
    else if (/\b(yes|yeah|yep|yup|already|mounted|correct|right)\b/i.test(speech)) serviceAnswers.mounted_on_rims = "yes";
  }

  if (!Object.keys(notes).length && !Object.keys(serviceAnswers).length) return state;
  return setCustomerDetails(state.callSid, state.companyId, {
    ...(Object.keys(notes).length ? { notes } : {}),
    ...(Object.keys(serviceAnswers).length ? { serviceAnswers } : {}),
  }, state.stateVersion);
}

function completeSummary(state: LiveBookingState): string {
  const address = state.notes.service_location
    ? `${state.notes.service_location}${state.notes.postal_code ? `, ${state.notes.postal_code}` : ""}`
    : null;
  const parts = [
    `${state.customerName} for ${state.serviceName || "the appointment"}`,
    state.notes.vehicle || null,
    state.serviceAnswers.tire_count
      ? `${state.serviceAnswers.tire_count} tire${state.serviceAnswers.tire_count === "1" ? "" : "s"}${state.serviceAnswers.mounted_on_rims === "yes" ? ", already mounted on rims" : state.serviceAnswers.mounted_on_rims === "no" ? ", not mounted on rims" : ""}`
      : null,
    address ? `service at ${address}` : null,
    state.selectedSlot?.label || null,
    state.customerPhone
      ? `${state.customerPhoneSource === "spoken" ? "callback number" : state.customerPhoneSource === "caller_id" ? "the number you're calling from" : "contact number"} ${naturalPhone(state.customerPhone)}`
      : null,
  ].filter(Boolean);
  return `Perfect. I have ${parts.join(", ")}. Is all of that correct?`;
}

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid) { next(); return; }

  try {
    let state = peekBookingState(callSid);
    if (!state || !state.selectedSlot || !state.customerName || !state.customerPhone) {
      next();
      return;
    }

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, state.companyId));
    const requirements = bookingRequirementsForCompanyName(company?.name);

    // If the previous deterministic turn asked for a required company detail,
    // normalize the reply directly into state before deciding what remains.
    const previouslyMissing = missingRequiredBookingDetail(state, requirements);
    if (speech && state.lastAction === "ASK_SERVICE_DETAIL" && previouslyMissing) {
      const updated = captureMissingDetail(state, previouslyMissing, speech);
      if (updated.stateVersion !== state.stateVersion) {
        state = updated;
        logger.info({ callSid, companyId: state.companyId, capturedDetail: previouslyMissing.key }, "Captured required booking detail");
      }
    }

    const missing = missingRequiredBookingDetail(state, requirements);
    if (missing) {
      state = setBookingAction(callSid, state.companyId, "ASK_SERVICE_DETAIL", state.stateVersion);
      logger.info({ callSid, companyId: state.companyId, missingDetail: missing.key }, "Blocking final booking confirmation until company-required detail is collected");
      res.type("text/xml").send(gatherResponse(req, missing.prompt));
      return;
    }

    // Own the transition into final confirmation so the caller hears one complete
    // summary of the durable state rather than separate or repeated questions.
    if (state.lastAction !== "CONFIRM_BOOKING" && !state.confirmed) {
      state = setBookingAction(callSid, state.companyId, "CONFIRM_BOOKING", state.stateVersion);
      logger.info({ callSid, companyId: state.companyId, stateVersion: state.stateVersion }, "Presenting complete booking summary for one final confirmation");
      res.type("text/xml").send(gatherResponse(req, completeSummary(state)));
      return;
    }

    next();
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking integrity guard failed; validator remains final authority");
    next();
  }
});

export default router;
