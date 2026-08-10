import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import { bookingRequirementsForCompanyName, missingRequiredBookingDetail } from "../lib/booking-requirements";
import { peekBookingState, setBookingAction } from "../lib/booking-state-manager";
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
    if (!missing) {
      next();
      return;
    }

    state = setBookingAction(callSid, state.companyId, "ASK_SERVICE_DETAIL", state.stateVersion);
    logger.info({ callSid, companyId: state.companyId, missingDetail: missing.key }, "Blocking final booking confirmation until company-required detail is collected");
    res.type("text/xml").send(gatherResponse(req, missing.prompt));
  } catch (error: any) {
    logger.warn({ callSid, err: error?.message }, "Booking integrity guard failed; validator remains final authority");
    next();
  }
});

export default router;
