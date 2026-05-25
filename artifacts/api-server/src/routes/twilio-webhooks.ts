import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable, callLogsTable, aiVoiceConfigTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/twilio/voice", async (req, res): Promise<void> => {
  const { To, From, CallSid, Direction } = req.body;

  req.log.info({ To, From, CallSid }, "Incoming Twilio voice webhook");

  // Look up the phone number config
  const [phoneNumber] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, To));

  // Log the call
  await db.insert(callLogsTable).values({
    phoneNumberId: phoneNumber?.id ?? null,
    twilioCallSid: CallSid,
    direction: Direction === "outbound-api" ? "outbound" : "inbound",
    status: "in-progress",
    fromNumber: From,
    toNumber: To,
    callerIdName: phoneNumber?.callerIdName ?? null,
    answerMode: phoneNumber?.answerMode ?? "forward",
  }).onConflictDoNothing();

  const answerMode = phoneNumber?.answerMode ?? "forward";
  const ringCount = phoneNumber?.ringCount ?? 4;
  const forwardTo = phoneNumber?.forwardTo;

  let twiml = "";

  if (answerMode === "forward" && forwardTo) {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${To}" timeout="${ringCount * 5}">
    <Number>${forwardTo}</Number>
  </Dial>
</Response>`;
  } else if (answerMode === "voicemail") {
    const greeting = phoneNumber?.voicemailGreeting ?? "Please leave a message after the tone.";
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${greeting}</Say>
  <Record maxLength="120" action="/api/twilio/recording" transcribe="true" transcribeCallback="/api/twilio/transcription" />
</Response>`;
  } else if (answerMode === "ai_voice") {
    // Get global AI config
    const [aiConfig] = await db.select().from(aiVoiceConfigTable);
    const greeting = phoneNumber?.aiSystemPrompt
      ? "Hello, I'm an AI assistant. How can I help you today?"
      : (aiConfig?.greeting ?? "Hello, thank you for calling. How can I help you today?");

    // For AI voice, use TwiML to say greeting and record
    // Full real-time AI integration would require a streaming endpoint
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${greeting}</Say>
  <Record maxLength="${aiConfig?.maxCallDuration ?? 300}" transcribe="true" />
</Response>`;
  } else if (answerMode === "reject") {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Reject />
</Response>`;
  } else {
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Thank you for calling. We are unable to take your call right now.</Say>
</Response>`;
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml);
});

router.post("/twilio/status", async (req, res): Promise<void> => {
  const { CallSid, CallStatus, CallDuration } = req.body;

  req.log.info({ CallSid, CallStatus, CallDuration }, "Twilio status callback");

  if (CallSid) {
    await db.update(callLogsTable)
      .set({
        status: CallStatus,
        duration: CallDuration ? parseInt(CallDuration, 10) : null,
      })
      .where(eq(callLogsTable.twilioCallSid, CallSid));
  }

  res.sendStatus(200);
});

router.post("/twilio/recording", async (req, res): Promise<void> => {
  const { CallSid, RecordingUrl, RecordingSid, TranscriptionText } = req.body;

  req.log.info({ CallSid, RecordingSid }, "Twilio recording callback");

  if (CallSid) {
    const updateData: any = {
      status: "completed",
    };
    if (RecordingUrl) updateData.recordingUrl = `${RecordingUrl}.mp3`;
    if (RecordingSid) updateData.recordingSid = RecordingSid;
    if (TranscriptionText) updateData.transcription = TranscriptionText;

    await db.update(callLogsTable)
      .set(updateData)
      .where(eq(callLogsTable.twilioCallSid, CallSid));
  }

  res.sendStatus(200);
});

export default router;
