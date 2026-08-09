import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function baseUrl(req: any): string {
  return process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;
}

/**
 * Booking calls must never manufacture a fake "hold" by waiting for a silent
 * Gather timeout. Availability checks are now handled inside the booking flow
 * before the next spoken response. Keep this middleware as a pass-through so
 * existing route registration remains stable.
 */
router.use("/twilio/ai-gather", (_req: any, _res: any, next: any) => {
  next();
});

/**
 * Backward-compatible continuation endpoint for any already-issued TwiML from
 * an older deployment. New calls do not use this endpoint. If an old call lands
 * here during a rolling deploy, immediately return control to the normal AI
 * gather route without adding a 10-second hold cycle.
 */
router.post("/twilio/ai-continue", async (req: any, res): Promise<void> => {
  const callSid = String(req.query.callSid ?? req.body?.CallSid ?? "");
  if (!callSid) {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>I'm sorry, I couldn't continue that request. What day works best for you?</Say></Response>`);
    return;
  }

  try {
    const target = `${baseUrl(req)}/api/twilio/ai-gather`;
    const form = new URLSearchParams({
      CallSid: callSid,
      SpeechResult: "Continue the appointment conversation now. Do not say hold on, give me a minute, one moment, let me check, or ask the caller to wait. If real availability is already known, offer it immediately. Otherwise ask exactly one specific question needed to continue.",
    });

    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "x-callingagent-ai-continuation": "1",
      },
      body: form.toString(),
    });

    const twiml = await response.text();
    if (!response.ok || !twiml.includes("<Response")) {
      throw new Error(`AI continuation returned ${response.status}`);
    }

    logger.info({ callSid }, "Legacy AI continuation completed without hold timeout");
    res.type("text/xml").send(twiml);
  } catch (error: any) {
    logger.error({ callSid, err: error?.message }, "Legacy AI continuation failed");
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST">
    <Say voice="Google.en-US-Neural2-F">What day works best for you?</Say>
  </Gather>
</Response>`);
  }
});

export default router;
