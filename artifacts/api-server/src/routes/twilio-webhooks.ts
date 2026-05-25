import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable, callLogsTable, aiVoiceConfigTable } from "@workspace/db";
import { logger } from "../lib/logger";
import OpenAI from "openai";

const router: IRouter = Router();

// In-memory conversation store keyed by CallSid
interface ConversationState {
  systemPrompt: string;
  greeting: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxDuration: number;
  startedAt: number;
}
const conversations = new Map<string, ConversationState>();

function getOpenAI() {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gatherTwiml(aiText: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(aiText)}</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/api/twilio/ai-gather" method="POST">
  </Gather>
  <Say voice="Polly.Joanna">I didn't catch that. Is there anything else I can help you with?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/api/twilio/ai-gather" method="POST">
  </Gather>
  <Hangup/>
</Response>`;
}

router.post("/twilio/voice", async (req, res): Promise<void> => {
  const { To, From, CallSid, Direction } = req.body;

  req.log.info({ To, From, CallSid }, "Incoming Twilio voice webhook");

  const [phoneNumber] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, To));

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
  <Say voice="Polly.Joanna">${escapeXml(greeting)}</Say>
  <Record maxLength="120" action="/api/twilio/recording" transcribe="true" transcribeCallback="/api/twilio/transcription" />
</Response>`;
  } else if (answerMode === "ai_voice") {
    const [aiConfig] = await db.select().from(aiVoiceConfigTable);

    const systemPrompt = phoneNumber?.aiSystemPrompt
      || aiConfig?.systemPrompt
      || "You are a helpful phone assistant. Keep your answers brief and conversational since you are speaking on a phone call.";

    const greeting = aiConfig?.greeting ?? "Hello, thank you for calling. How can I help you today?";
    const maxDuration = aiConfig?.maxCallDuration ?? 300;

    // Store conversation state for subsequent gather callbacks
    conversations.set(CallSid, {
      systemPrompt,
      greeting,
      messages: [],
      maxDuration,
      startedAt: Date.now(),
    });

    // Greet the caller and immediately start listening
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(greeting)}</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/api/twilio/ai-gather" method="POST">
  </Gather>
  <Say voice="Polly.Joanna">I didn't catch that. Is there anything else I can help you with?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/api/twilio/ai-gather" method="POST">
  </Gather>
  <Hangup/>
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

router.post("/twilio/ai-gather", async (req, res): Promise<void> => {
  const { CallSid, SpeechResult } = req.body;

  req.log.info({ CallSid, SpeechResult }, "AI gather callback");

  const conv = conversations.get(CallSid);

  if (!conv) {
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Sorry, I lost track of our conversation. Goodbye.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  // Check max duration
  const elapsed = (Date.now() - conv.startedAt) / 1000;
  if (elapsed > conv.maxDuration) {
    conversations.delete(CallSid);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">We've reached the maximum call duration. Thank you for calling. Goodbye!</Say>
  <Hangup/>
</Response>`);
    return;
  }

  if (!SpeechResult) {
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I didn't catch that. Could you please repeat?</Say>
  <Gather input="speech" timeout="5" speechTimeout="auto" action="/api/twilio/ai-gather" method="POST">
  </Gather>
  <Hangup/>
</Response>`);
    return;
  }

  conv.messages.push({ role: "user", content: SpeechResult });

  try {
    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: conv.systemPrompt + "\n\nIMPORTANT: Keep all responses to 1-3 sentences maximum. You are on a live phone call. Never use markdown, bullet points, or lists.",
        },
        ...conv.messages,
      ],
      max_tokens: 150,
    });

    const aiText = completion.choices[0]?.message?.content ?? "I'm sorry, I couldn't process that. Can you try again?";
    conv.messages.push({ role: "assistant", content: aiText });

    // Check if AI wants to end the call (simple heuristic)
    const endPhrases = ["goodbye", "have a great day", "take care", "thank you for calling", "bye"];
    const wantsToEnd = endPhrases.some(p => aiText.toLowerCase().includes(p)) && conv.messages.length > 2;

    if (wantsToEnd) {
      conversations.delete(CallSid);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${escapeXml(aiText)}</Say>
  <Hangup/>
</Response>`);
      return;
    }

    res.set("Content-Type", "text/xml");
    res.send(gatherTwiml(aiText));
  } catch (err: any) {
    req.log.error({ err }, "OpenAI call failed in ai-gather");
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">I'm having a technical issue right now. Please try calling again later.</Say>
  <Hangup/>
</Response>`);
  }
});

router.post("/twilio/status", async (req, res): Promise<void> => {
  const { CallSid, CallStatus, CallDuration } = req.body;

  req.log.info({ CallSid, CallStatus, CallDuration }, "Twilio status callback");

  // Clean up conversation state on call end
  if (["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus)) {
    conversations.delete(CallSid);
  }

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
