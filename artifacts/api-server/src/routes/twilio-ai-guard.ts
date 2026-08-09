import { Router, type IRouter } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const BOOKING_INTENT = /\b(book|booking|appointment|schedule|scheduled|scheduling|availability|available|slot|time|reschedule|tire service|service visit)\b/i;

function baseUrl(req: any): string {
  return process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;
}

/**
 * Safety layer for live AI booking calls.
 *
 * The main AI route ends every speech turn with a Gather followed by Hangup.
 * Normally the Gather posts the caller's next sentence before Hangup is reached.
 * But if the AI says "hold on while I check availability", the caller correctly
 * stays silent, Gather times out, and Twilio reaches Hangup. This middleware
 * replaces that booking-turn Hangup with one automatic continuation turn.
 *
 * We deliberately only arm this for booking/availability-related caller speech,
 * and only once. The internal continuation request carries a header so its own
 * response keeps the normal Gather/Hangup fallback and cannot loop forever.
 */
router.use("/twilio/ai-gather", (req: any, res: any, next: any) => {
  const speech = String(req.body?.SpeechResult ?? "");
  const callSid = String(req.body?.CallSid ?? "");
  const internalContinuation = req.get("x-callingagent-ai-continuation") === "1";

  if (internalContinuation || !callSid || !BOOKING_INTENT.test(speech)) {
    next();
    return;
  }

  const originalSend = res.send.bind(res);
  res.send = (body: any) => {
    if (typeof body === "string" && body.includes("<Gather") && body.includes("<Hangup/>")) {
      const continueUrl = `${baseUrl(req)}/api/twilio/ai-continue?callSid=${encodeURIComponent(callSid)}`;
      const guarded = body.replace(
        /\s*<Hangup\s*\/>\s*<\/Response>\s*$/i,
        `\n  <Redirect method="POST">${continueUrl.replace(/&/g, "&amp;")}</Redirect>\n</Response>`,
      );

      if (guarded !== body) {
        logger.info({ callSid, speech: speech.slice(0, 100) }, "Armed AI booking continuation guard");
        return originalSend(guarded);
      }
    }
    return originalSend(body);
  };

  next();
});

/**
 * Called by Twilio only when a booking-related Gather timed out with no caller
 * speech. We feed one synthetic continuation turn into the existing AI session.
 * The existing /twilio/ai-gather handler still owns the conversation, booking
 * tools, database writes, notifications, and voice response.
 */
router.post("/twilio/ai-continue", async (req: any, res): Promise<void> => {
  const callSid = String(req.query.callSid ?? req.body?.CallSid ?? "");
  if (!callSid) {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>I'm sorry, I couldn't continue the request. Please tell me the appointment time again.</Say><Hangup/></Response>`);
    return;
  }

  try {
    const target = `${baseUrl(req)}/api/twilio/ai-gather`;
    const form = new URLSearchParams({
      CallSid: callSid,
      SpeechResult: "Continue the booking or availability action you just told the caller you were checking. Do not tell the caller to hold or wait. Perform the available booking action now if you have enough information; otherwise ask exactly one specific question needed to continue.",
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

    logger.info({ callSid }, "AI booking call automatically continued after silent hold");
    res.type("text/xml").send(twiml);
  } catch (error: any) {
    logger.error({ callSid, err: error?.message }, "AI booking continuation failed");
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST">
    <Say voice="Google.en-US-Neural2-F">I'm still here. I had trouble checking that automatically. Please repeat the date and time you want, and I'll continue.</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-F">Please call us back when you're ready. Thank you.</Say>
  <Hangup/>
</Response>`);
  }
});

export default router;
