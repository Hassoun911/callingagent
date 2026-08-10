import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import { bookingRequirementsForCompanyName, missingRequiredBookingDetail } from "../lib/booking-requirements";
import { peekBookingState, setBookingAction, type LiveBookingState } from "../lib/booking-state-manager";
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

function naturalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

function completeSummary(state: LiveBookingState): string {
  const parts = [
    `${state.customerName} for ${state.serviceName || "the appointment"}`,
    state.notes.vehicle || null,
    state.serviceAnswers.tire_count
      ? `${state.serviceAnswers.tire_count} tire${state.serviceAnswers.tire_count === "1" ? "" : "s"}${state.serviceAnswers.mounted_on_rims === "yes" ? ", already mounted on rims" : state.serviceAnswers.mounted_on_rims === "no" ? ", not mounted on rims" : ""}`
      : null,
    state.notes.service_location ? `service at ${state.notes.service_location}` : null,
    state.selectedSlot?.label || null,
    state.customerPhone
      ? `${state.customerPhoneSource === "spoken" ? "callback number" : state.customerPhoneSource === "caller_id" ? "the number you're calling from" : "contact number"} ${naturalPhone(state.customerPhone)}`
      : null,
  ].filter(Boolean);
  return `Perfect. I have ${parts.join(", ")}. Is all of that correct?`;
}

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  if (!callSid) { next(); return; }

  try {
    let state = peekBookingState(callSid);
    if (!state || !state.selectedSlot || !state.customerName || !state.customerPhone) {
      next();
      return;
    }

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, state.companyId));
    const requirements = bookingRequirementsForCompanyName(company?.name);
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
