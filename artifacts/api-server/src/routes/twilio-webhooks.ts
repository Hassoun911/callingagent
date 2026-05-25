import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable, callLogsTable, aiVoiceConfigTable, companiesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import OpenAI from "openai";
import twilio from "twilio";
import { randomUUID } from "crypto";

/** Replace template variables in an AI system prompt.
 *
 * Named variables:
 *   {{company_name}}   → company name from the linked company (or callerIdName)
 *   {{phone_number}}   → the Twilio line number (To)
 *   {{caller_number}}  → the inbound caller's number (From)
 *
 * Fuzzy matches (case-insensitive, spaces/underscores ignored):
 *   Any token whose normalised form matches the company name's normalised form → company name
 *
 * Fallback for any other {{token}}: the literal text inside the braces, so that
 * {{bcard.ca}} → "bcard.ca", {{it services}} → "it services", etc.
 */
function resolvePromptTemplate(
  prompt: string,
  vars: { companyName?: string | null; phoneNumber?: string | null; callerNumber?: string | null }
): string {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const normalizedCompany = vars.companyName ? normalize(vars.companyName) : null;

  return prompt.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const raw = key.trim();
    const k = normalize(raw);

    if (k === "companyname" || k === "company") return vars.companyName ?? raw;
    if (k === "phonenumber" || k === "phone") return vars.phoneNumber ?? raw;
    if (k === "callernumber" || k === "caller") return vars.callerNumber ?? raw;

    // If the token matches the company name (e.g. {{solutions}} when company is "solutions")
    if (normalizedCompany && k === normalizedCompany) return vars.companyName!;

    // Unknown token: use the literal text inside the braces (what the user typed)
    return raw;
  });
}

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
  return twilio(accountSid, authToken);
}

const router: IRouter = Router();

// In-memory conversation store keyed by CallSid
interface ConversationState {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxDuration: number;
  startedAt: number;
  voice: string;
  language: string;
  baseUrl: string;
}
const conversations = new Map<string, ConversationState>();

// TTS audio cache — buffers keyed by UUID, auto-expire after 10 minutes
const ttsCache = new Map<string, Buffer>();
function cacheTts(buffer: Buffer): string {
  const id = randomUUID();
  ttsCache.set(id, buffer);
  setTimeout(() => ttsCache.delete(id), 10 * 60 * 1000);
  return id;
}

function getOpenAI() {
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

// Map AI Settings voice name to OpenAI TTS voice
const VOICE_MAP: Record<string, string> = {
  alloy: "alloy",
  echo: "echo",
  fable: "fable",
  onyx: "onyx",
  nova: "nova",
  shimmer: "shimmer",
  coral: "coral",
  ash: "ash",
  sage: "sage",
  ballad: "ballad",
  verse: "verse",
};

async function generateTts(text: string, voice = "nova"): Promise<string | null> {
  try {
    const openai = getOpenAI();
    const ttsVoice = (VOICE_MAP[voice] ?? "nova") as any;
    const response = await openai.audio.speech.create({
      model: "tts-1-hd",
      voice: ttsVoice,
      input: text,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return cacheTts(buffer);
  } catch (err) {
    logger.error({ err }, "OpenAI TTS failed");
    return null;
  }
}

function playOrSay(audioId: string | null, fallbackText: string, baseUrl: string): string {
  if (audioId) {
    return `<Play>${baseUrl}/api/twilio/tts/${audioId}</Play>`;
  }
  return `<Say voice="Polly.Joanna-Neural">${escapeXml(fallbackText)}</Say>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gatherBlock(audioId: string | null, fallbackText: string, baseUrl: string, language = "en-US"): string {
  const audio = playOrSay(audioId, fallbackText, baseUrl);
  return `${audio}
  <Gather input="speech" timeout="5" speechTimeout="1" speechModel="experimental_conversations" language="${language}" action="${baseUrl}/api/twilio/ai-gather" method="POST">
  </Gather>`;
}

// ─── Serve TTS audio ────────────────────────────────────────────────────────
router.get("/twilio/tts/:id", (req, res): void => {
  const buffer = ttsCache.get(req.params.id);
  if (!buffer) { res.status(404).end(); return; }
  res.set("Content-Type", "audio/mpeg");
  res.set("Cache-Control", "no-store");
  res.send(buffer);
});

// ─── Inbound call ────────────────────────────────────────────────────────────
router.post("/twilio/voice", async (req, res): Promise<void> => {
  const { To, From, CallSid, Direction, CallerName } = req.body;
  req.log.info({ To, From, CallSid }, "Incoming Twilio voice webhook");

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;

  const [phoneNumber] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, To));

  // Use Twilio's free CallerName field (broadcast by many carriers).
  // If not available, attempt an async Lookup after responding so we don't block TwiML.
  const inboundCallerName: string | null =
    CallerName && CallerName !== "Anonymous" ? CallerName : null;

  await db.insert(callLogsTable).values({
    phoneNumberId: phoneNumber?.id ?? null,
    twilioCallSid: CallSid,
    direction: Direction === "outbound-api" ? "outbound" : "inbound",
    status: "in-progress",
    fromNumber: From,
    toNumber: To,
    callerIdName: inboundCallerName,
    answerMode: phoneNumber?.answerMode ?? "forward",
  }).onConflictDoNothing();

  // If no free CNAM, kick off a Twilio Lookup in the background (non-blocking).
  if (!inboundCallerName && From && From !== "Anonymous") {
    setImmediate(async () => {
      try {
        const client = getTwilioClient();
        const result = await (client.lookups.v2.phoneNumbers(From) as any)
          .fetch({ fields: "caller_name" });
        const name: string | null = result?.callerName?.callerName ?? null;
        if (name) {
          await db.update(callLogsTable)
            .set({ callerIdName: name })
            .where(eq(callLogsTable.twilioCallSid, CallSid));
        }
      } catch (_) { /* lookup failed — leave callerIdName null */ }
    });
  }

  const answerMode = phoneNumber?.answerMode ?? "forward";
  const ringCount = phoneNumber?.ringCount ?? 4;
  const forwardTo = phoneNumber?.forwardTo;

  let twiml = "";

  if (answerMode === "forward" && forwardTo) {
    const forwardCallerId = phoneNumber?.forwardCallerId ?? "caller";
    // When "line" is selected, explicitly set callerId to the Twilio number.
    // When "caller" is selected, omit callerId — Twilio cannot use an unverified
    // inbound number as an outbound callerId, so we let Twilio use its account default.
    const callerIdAttr = forwardCallerId === "line" ? ` callerId="${To}"` : "";
    const callScreen = phoneNumber?.callScreen ?? false;
    const callScreenFallback = phoneNumber?.callScreenFallback ?? "voicemail";

    if (callScreen && phoneNumber?.id) {
      const screenUrl = `${baseUrl}/api/twilio/screen?phoneNumberId=${phoneNumber.id}&amp;fallback=${callScreenFallback}`;
      const fallbackUrl = `${baseUrl}/api/twilio/screen-fallback?phoneNumberId=${phoneNumber.id}&amp;mode=${callScreenFallback}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${callerIdAttr} timeout="${ringCount * 5}">
    <Number url="${screenUrl}">${forwardTo}</Number>
  </Dial>
  <Redirect method="POST">${fallbackUrl}</Redirect>
</Response>`;
    } else {
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${callerIdAttr} timeout="${ringCount * 5}">
    <Number>${forwardTo}</Number>
  </Dial>
</Response>`;
    }

  } else if (answerMode === "voicemail") {
    const greeting = phoneNumber?.voicemailGreeting ?? "Please leave a message after the tone.";
    const audioId = await generateTts(greeting);
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, greeting, baseUrl)}
  <Record maxLength="120" action="${baseUrl}/api/twilio/recording" transcribe="true" transcribeCallback="${baseUrl}/api/twilio/transcription" />
</Response>`;

  } else if (answerMode === "ai_voice") {
    const [aiConfig] = await db.select().from(aiVoiceConfigTable);
    const language = aiConfig?.language ?? "en-US";
    const ttsVoice = aiConfig?.voice ?? "nova";
    const maxDuration = aiConfig?.maxCallDuration ?? 300;
    const greetingText = aiConfig?.greeting ?? "Hello, thank you for calling. How can I help you today?";

    // Resolve company name for template substitution
    let companyName: string | null = null;
    if (phoneNumber?.companyId) {
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, phoneNumber.companyId));
      companyName = co?.name ?? null;
    }
    companyName = companyName ?? phoneNumber?.callerIdName ?? null;

    // Build base prompt, adding a language directive if not English
    const rawPrompt = phoneNumber?.aiSystemPrompt || aiConfig?.systemPrompt
      || "You are a professional phone agent. Speak naturally and conversationally. Keep responses to 1-3 sentences. Ask one question at a time.";
    const basePrompt = resolvePromptTemplate(rawPrompt, { companyName, phoneNumber: To, callerNumber: From });
    const langDirective = language.startsWith("ar-")
      ? "\n\nIMPORTANT: You MUST respond entirely in Arabic (العربية). Do not use any English."
      : "";
    const systemPrompt = basePrompt + langDirective;

    conversations.set(CallSid, {
      systemPrompt,
      messages: [],
      maxDuration,
      startedAt: Date.now(),
      voice: ttsVoice,
      language,
      baseUrl,
    });

    // Generate greeting audio with OpenAI TTS
    const greetingAudioId = await generateTts(greetingText, ttsVoice);

    // Start recording the call (non-blocking)
    setTimeout(() => {
      try {
        const client = getTwilioClient();
        client.calls(CallSid).recordings.create({
          recordingStatusCallback: `${baseUrl}/api/twilio/recording`,
          recordingStatusCallbackMethod: "POST",
        }).catch((err: any) => logger.error({ err }, "Failed to start call recording"));
      } catch (err) {
        logger.error({ err }, "Failed to init call recording");
      }
    }, 1500);

    const retryFallback = language === "ar-SA" ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    const retryAudioId = await generateTts(retryFallback, ttsVoice);

    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherBlock(greetingAudioId, greetingText, baseUrl, language)}
  ${gatherBlock(retryAudioId, retryFallback, baseUrl, language)}
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
  <Say voice="Polly.Joanna-Neural">Thank you for calling. We are unable to take your call right now.</Say>
</Response>`;
  }

  res.set("Content-Type", "text/xml");
  res.send(twiml);
});

// ─── AI speech gather callback ───────────────────────────────────────────────
router.post("/twilio/ai-gather", async (req, res): Promise<void> => {
  const { CallSid, SpeechResult } = req.body;
  req.log.info({ CallSid, SpeechResult }, "AI gather callback");

  const conv = conversations.get(CallSid);

  if (!conv) {
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Sorry, I lost track of our conversation. Goodbye.</Say>
  <Hangup/>
</Response>`);
    return;
  }

  const { baseUrl, voice, language } = conv;
  const isArabic = language.startsWith("ar-");

  // Check max duration
  const elapsed = (Date.now() - conv.startedAt) / 1000;
  if (elapsed > conv.maxDuration) {
    conversations.delete(CallSid);
    const byeText = isArabic ? "لقد وصلنا إلى الحد الأقصى لمدة المكالمة. شكرا لاتصالك. مع السلامة!" : "We've reached the maximum call duration. Thank you for calling. Goodbye!";
    const audioId = await generateTts(byeText, voice);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, byeText, baseUrl)}
  <Hangup/>
</Response>`);
    return;
  }

  if (!SpeechResult) {
    const retryText = isArabic ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    const audioId = await generateTts(retryText, voice);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherBlock(audioId, retryText, baseUrl, language)}
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
          content: conv.systemPrompt + "\n\nIMPORTANT: Keep all responses to 1-3 short sentences. You are on a live phone call. Never use markdown, bullet points, or lists — only natural spoken language. Vary your phrasing — do not start every response the same way.",
        },
        ...conv.messages,
      ],
      max_tokens: 180,
    });

    const aiText = completion.choices[0]?.message?.content ?? (isArabic ? "عذرًا، لم أتمكن من المعالجة. هل يمكنك المحاولة مرة أخرى؟" : "I'm sorry, I couldn't process that. Can you try again?");
    conv.messages.push({ role: "assistant", content: aiText });

    // Generate TTS audio
    const audioId = await generateTts(aiText, voice);

    // Check if AI naturally wants to end
    const endPhrases = isArabic
      ? ["مع السلامة", "وداعا", "شكرا لاتصالك", "يوم سعيد"]
      : ["goodbye", "have a great day", "take care", "thank you for calling", "bye", "take care now"];
    const wantsToEnd = endPhrases.some(p => aiText.toLowerCase().includes(p.toLowerCase())) && conv.messages.length > 4;

    if (wantsToEnd) {
      conversations.delete(CallSid);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, aiText, baseUrl)}
  <Hangup/>
</Response>`);
      return;
    }

    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherBlock(audioId, aiText, baseUrl, language)}
  <Hangup/>
</Response>`);
  } catch (err: any) {
    req.log.error({ err }, "OpenAI call failed in ai-gather");
    const errText = isArabic ? "أواجه مشكلة تقنية. يرجى المحاولة مرة أخرى لاحقًا." : "I'm having a technical issue right now. Please try calling again later.";
    const audioId = await generateTts(errText, voice);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, errText, baseUrl)}
  <Hangup/>
</Response>`);
  }
});

// ─── Call screen whisper (plays to YOU when you answer a forwarded call) ──────
router.post("/twilio/screen", (req, res): void => {
  const { phoneNumberId, fallback } = req.query as Record<string, string>;
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;

  const fallbackLabel = fallback === "ai_voice" ? "AI agent" : "voicemail";
  req.log.info({ phoneNumberId, fallback }, "Call screen whisper");

  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${baseUrl}/api/twilio/screen-accept" method="POST" timeout="8">
    <Say voice="Polly.Joanna-Neural">Incoming business call. Press 1 to answer, or hang up to send to ${fallbackLabel}.</Say>
  </Gather>
  <Hangup/>
</Response>`);
});

// ─── Screen accept — pressed key after whisper ───────────────────────────────
router.post("/twilio/screen-accept", (req, res): void => {
  const { Digits } = req.body;
  res.set("Content-Type", "text/xml");
  if (Digits === "1") {
    // Empty response = bridge the two call legs
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  } else {
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

// ─── Screen fallback — caller lands here if screen rejected ──────────────────
router.post("/twilio/screen-fallback", async (req, res): Promise<void> => {
  const { CallSid, To, From } = req.body;
  const { phoneNumberId, mode } = req.query as Record<string, string>;
  req.log.info({ CallSid, phoneNumberId, mode }, "Call screen fallback");

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;

  let phoneNumber = null;
  if (phoneNumberId) {
    const rows = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, parseInt(phoneNumberId, 10)));
    phoneNumber = rows[0] ?? null;
  }

  if (mode === "ai_voice") {
    const [aiConfig] = await db.select().from(aiVoiceConfigTable);
    const language = aiConfig?.language ?? "en-US";
    const ttsVoice = aiConfig?.voice ?? "nova";
    const maxDuration = aiConfig?.maxCallDuration ?? 300;
    const greetingText = aiConfig?.greeting ?? "Hello, thank you for calling. How can I help you today?";

    // Resolve company name for template substitution
    let companyName2: string | null = null;
    if (phoneNumber?.companyId) {
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, phoneNumber.companyId));
      companyName2 = co?.name ?? null;
    }
    companyName2 = companyName2 ?? phoneNumber?.callerIdName ?? null;

    const rawPrompt2 = phoneNumber?.aiSystemPrompt || aiConfig?.systemPrompt
      || "You are a professional phone agent. Speak naturally and conversationally. Keep responses to 1-3 sentences. Ask one question at a time.";
    const basePrompt = resolvePromptTemplate(rawPrompt2, { companyName: companyName2, phoneNumber: To, callerNumber: From });
    const langDirective = language.startsWith("ar-")
      ? "\n\nIMPORTANT: You MUST respond entirely in Arabic (العربية). Do not use any English."
      : "";

    conversations.set(CallSid, {
      systemPrompt: basePrompt + langDirective,
      messages: [],
      maxDuration,
      startedAt: Date.now(),
      voice: ttsVoice,
      language,
      baseUrl,
    });

    const greetingAudioId = await generateTts(greetingText, ttsVoice);
    const retryFallback = language.startsWith("ar-") ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    const retryAudioId = await generateTts(retryFallback, ttsVoice);

    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherBlock(greetingAudioId, greetingText, baseUrl, language)}
  ${gatherBlock(retryAudioId, retryFallback, baseUrl, language)}
  <Hangup/>
</Response>`);
  } else {
    // Voicemail
    const greeting = phoneNumber?.voicemailGreeting ?? "Please leave a message after the tone.";
    const audioId = await generateTts(greeting);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, greeting, baseUrl)}
  <Record maxLength="120" action="${baseUrl}/api/twilio/recording" transcribe="true" transcribeCallback="${baseUrl}/api/twilio/transcription" />
</Response>`);
  }
});

// ─── Call status callback ────────────────────────────────────────────────────
async function extractCallSummary(conv: ConversationState): Promise<{
  callerName: string | null;
  callerEmail: string | null;
  callType: string | null;
  callSummary: string | null;
  actionRequired: string | null;
  priority: string | null;
}> {
  if (conv.messages.length === 0) {
    return { callerName: null, callerEmail: null, callType: null, callSummary: null, actionRequired: null, priority: null };
  }
  try {
    const openai = getOpenAI();
    const transcript = conv.messages.map(m => `${m.role === "user" ? "Caller" : "AI"}: ${m.content}`).join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Extract call data from this transcript as JSON only. Use null for missing info.
Return exactly: {"callerName": "...", "callerEmail": "...", "callType": "General Inquiry|Customer Support|New Customer|Appointment Request|Billing|Sales|Emergency|Other", "callSummary": "2-3 sentences", "actionRequired": "...", "priority": "Low|Medium|High"}`,
        },
        { role: "user", content: `Transcript:\n\n${transcript}` },
      ],
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      callerName: parsed.callerName ?? null,
      callerEmail: parsed.callerEmail ?? null,
      callType: parsed.callType ?? null,
      callSummary: parsed.callSummary ?? null,
      actionRequired: parsed.actionRequired ?? null,
      priority: parsed.priority ?? null,
    };
  } catch (err) {
    logger.error({ err }, "Failed to extract call summary");
    return { callerName: null, callerEmail: null, callType: null, callSummary: null, actionRequired: null, priority: null };
  }
}

router.post("/twilio/status", async (req, res): Promise<void> => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  req.log.info({ CallSid, CallStatus, CallDuration }, "Twilio status callback");

  const isTerminal = ["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus);

  if (CallSid) {
    const updateData: Record<string, any> = {
      status: CallStatus,
      duration: CallDuration ? parseInt(CallDuration, 10) : null,
    };

    if (isTerminal) {
      const conv = conversations.get(CallSid);
      if (conv && conv.messages.length > 0) {
        const summary = await extractCallSummary(conv);
        Object.assign(updateData, summary);
        updateData.transcription = conv.messages
          .map(m => `${m.role === "user" ? "Caller" : "AI"}: ${m.content}`)
          .join("\n\n");
      }
      conversations.delete(CallSid);
    }

    await db.update(callLogsTable)
      .set(updateData)
      .where(eq(callLogsTable.twilioCallSid, CallSid));
  }

  res.sendStatus(200);
});

// ─── Recording callback ──────────────────────────────────────────────────────
router.post("/twilio/recording", async (req, res): Promise<void> => {
  const { CallSid, RecordingUrl, RecordingSid, TranscriptionText } = req.body;
  req.log.info({ CallSid, RecordingSid }, "Twilio recording callback");

  if (CallSid) {
    const updateData: any = { status: "completed" };
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
