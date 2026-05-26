import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable, callLogsTable, aiVoiceConfigTable, companiesTable, contactsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import OpenAI from "openai";
import twilio from "twilio";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";

// ─── Email notifications ─────────────────────────────────────────────────────

function getEmailTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

/** Fetch all data needed for an email notification and send it (if configured). */
async function sendCallNotificationIfConfigured(callSid: string, overrideRecordingUrl?: string | null): Promise<void> {
  try {
    const [log] = await db
      .select()
      .from(callLogsTable)
      .where(eq(callLogsTable.twilioCallSid, callSid));
    if (!log) return;

    // Find the phone number row by the "to" (Twilio line number)
    let phoneNumber = null;
    if (log.to) {
      const rows = await db
        .select()
        .from(phoneNumbersTable)
        .where(eq(phoneNumbersTable.number, log.to));
      phoneNumber = rows[0] ?? null;
    }

    const notificationEmail = phoneNumber?.notificationEmail;
    if (!notificationEmail) return;

    const transport = getEmailTransport();
    if (!transport) {
      logger.warn({ callSid }, "SMTP not configured — skipping call notification email");
      return;
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
    const recordingUrl = overrideRecordingUrl ?? log.recordingUrl ?? null;

    const callerDisplay = log.callerName
      ? `${log.callerName} (${log.from ?? "Unknown"})`
      : (log.from ?? "Unknown caller");

    const durationSec = log.duration ?? 0;
    const durationDisplay = durationSec > 0
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : "N/A";

    const modeLabels: Record<string, string> = {
      forward: "Forwarded", ai_voice: "AI Agent", voicemail: "Voicemail", reject: "Rejected",
    };
    const modeDisplay = modeLabels[log.answerMode ?? ""] ?? (log.answerMode ?? "Unknown");

    const calledAt = log.startedAt ?? log.createdAt ?? new Date();
    const subject = `Call Summary — ${callerDisplay} — ${calledAt.toLocaleString()}`;

    const recordingSection = recordingUrl
      ? `<p style="margin:12px 0"><strong>Recording:</strong> <a href="${recordingUrl}" style="color:#22c55e">Listen to recording</a></p>`
      : "";

    const summarySection = log.callSummary
      ? `<h3 style="color:#22c55e;margin:20px 0 8px">Call Summary</h3>
         <p style="margin:0 0 8px">${log.callSummary}</p>
         ${log.actionRequired ? `<p style="margin:0 0 4px"><strong>Action required:</strong> ${log.actionRequired}</p>` : ""}
         ${log.priority ? `<p style="margin:0 0 4px"><strong>Priority:</strong> ${log.priority}</p>` : ""}`
      : "";

    const transcriptSection = log.transcription
      ? `<h3 style="color:#22c55e;margin:20px 0 8px">Transcript</h3>
         <pre style="background:#f4f4f4;padding:12px;border-radius:4px;white-space:pre-wrap;font-size:12px;margin:0">${log.transcription}</pre>`
      : "";

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#333">
  <h2 style="color:#111;border-bottom:2px solid #22c55e;padding-bottom:8px">
    Incoming Call — ${phoneNumber?.friendlyName ?? log.to ?? "Your Line"}
  </h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:6px 0;color:#666;width:130px">Caller</td><td style="padding:6px 0;font-weight:500">${callerDisplay}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Line</td><td style="padding:6px 0">${phoneNumber?.friendlyName ?? ""} (${log.to ?? ""})</td></tr>
    <tr><td style="padding:6px 0;color:#666">Mode</td><td style="padding:6px 0">${modeDisplay}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Duration</td><td style="padding:6px 0">${durationDisplay}</td></tr>
    <tr><td style="padding:6px 0;color:#666">Time</td><td style="padding:6px 0">${calledAt.toLocaleString()}</td></tr>
    ${log.callType ? `<tr><td style="padding:6px 0;color:#666">Call type</td><td style="padding:6px 0">${log.callType}</td></tr>` : ""}
  </table>
  ${recordingSection}
  ${summarySection}
  ${transcriptSection}
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="font-size:11px;color:#999;margin:0">Sent by Vanguard.OPS</p>
</body></html>`;

    await transport.sendMail({ from, to: notificationEmail, subject, html });
    logger.info({ callSid, to: notificationEmail }, "Call notification email sent");
  } catch (err: any) {
    logger.error({ err: err?.message, callSid }, "Failed to send call notification email");
  }
}

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

/**
 * Start recording a live call and immediately persist the recording SID.
 * Fires asynchronously so it never blocks TwiML responses.
 */
function startCallRecording(callSid: string, callbackUrl: string): void {
  const client = getTwilioClient();
  logger.info({ callSid, callbackUrl }, "Requesting call recording via API");
  client.calls(callSid).recordings.create({
    recordingStatusCallback: callbackUrl,
    recordingStatusCallbackMethod: "POST",
  }).then(async (rec) => {
    logger.info({ callSid, recordingSid: rec.sid }, "Call recording started");
    // Persist SID immediately — callback may be delayed or missed
    await db.update(callLogsTable)
      .set({ recordingSid: rec.sid })
      .where(eq(callLogsTable.twilioCallSid, callSid));
  }).catch((err: any) => {
    logger.error({ callSid, err: err?.message ?? String(err), code: err?.code, status: err?.status }, "Failed to start call recording");
  });
}

const router: IRouter = Router();

// In-memory conversation store keyed by CallSid
interface ConversationState {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxDuration: number;
  startedAt: number;
  voice: string;
  voiceStyle: string;
  language: string;
  baseUrl: string;
  speechTimeout: number;
  maxTokens: number;
}
const conversations = new Map<string, ConversationState>();

// Tracks calls where the agent actually pressed 1 to accept — used to distinguish
// "agent answered and talked" from "agent declined and phone reported completed".
const acceptedScreenCalls = new Set<string>();

// TTS audio cache — buffers keyed by UUID, auto-expire after 10 minutes
const ttsCache = new Map<string, Buffer>();
function cacheTts(buffer: Buffer): string {
  const id = randomUUID();
  ttsCache.set(id, buffer);
  setTimeout(() => ttsCache.delete(id), 10 * 60 * 1000);
  return id;
}

// Content-addressable warm cache — keyed by "voice:text", never expires during the server session.
// Greeting and retry phrases are pre-loaded at startup so the first call has zero TTS latency.
const ttsWarmCache = new Map<string, Buffer>();

// Chat completions: prefer direct OPENAI_API_KEY (much lower latency than the Replit proxy).
// Fall back to the proxy if no direct key is available.
function getChatOpenAI() {
  const directKey = process.env.OPENAI_API_KEY;
  if (directKey) return new OpenAI({ apiKey: directKey });
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

function getTtsOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
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

// Best available Twilio <Say> voice — used only when no OPENAI_API_KEY is set
const TWILIO_FALLBACK_VOICE = "Google.en-US-Neural2-F";

async function generateTts(text: string, voice = "nova", voiceStyle?: string): Promise<string | null> {
  const openai = getTtsOpenAI();
  if (!openai) {
    logger.warn("OPENAI_API_KEY not set — TTS will use Twilio neural voice fallback");
    return null;
  }
  try {
    const ttsVoice = (VOICE_MAP[voice] ?? "nova") as any;
    const warmKey = `${ttsVoice}:${voiceStyle ?? ""}:${text}`;

    // Serve from warm cache if available — zero additional API call
    const warm = ttsWarmCache.get(warmKey);
    if (warm) return cacheTts(warm);

    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: ttsVoice,
      input: text,
      ...(voiceStyle ? { instructions: voiceStyle } : {}),
    } as any);
    const buffer = Buffer.from(await response.arrayBuffer());

    // Store in warm cache for instant reuse on subsequent calls
    ttsWarmCache.set(warmKey, buffer);

    return cacheTts(buffer);
  } catch (err: any) {
    logger.error({ err: err?.message, code: err?.code }, "OpenAI TTS failed — falling back to Twilio neural voice");
    return null;
  }
}

const DEFAULT_GREETING = "Hello, thank you for calling. How can I help you today?";
const DEFAULT_RETRY_EN = "I didn't catch that. Could you please repeat?";
const DEFAULT_RETRY_AR = "لم أفهم. هل يمكنك الإعادة؟";

/** Pre-generate TTS for the greeting and retry phrases so the first call has instant audio. */
export async function warmTtsCache(): Promise<void> {
  try {
    const [aiConfig] = await db.select().from(aiVoiceConfigTable);
    const voice = aiConfig?.voice ?? "nova";
    const voiceStyle = aiConfig?.voiceStyle ?? undefined;
    const greeting = aiConfig?.greeting?.trim() || DEFAULT_GREETING;
    await Promise.all([
      generateTts(greeting, voice, voiceStyle),
      generateTts(DEFAULT_RETRY_EN, voice, voiceStyle),
      generateTts(DEFAULT_RETRY_AR, voice, voiceStyle),
    ]);
    logger.info({ voice, greeting: greeting.slice(0, 60) }, "TTS warm cache ready");
  } catch (err: any) {
    logger.warn({ err: err?.message }, "TTS warm cache pre-load failed — will generate on first call");
  }
}

function playOrSay(audioId: string | null, fallbackText: string, baseUrl: string): string {
  if (audioId) {
    return `<Play>${baseUrl}/api/twilio/tts/${audioId}</Play>`;
  }
  return `<Say voice="${TWILIO_FALLBACK_VOICE}">${escapeXml(fallbackText)}</Say>`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function gatherBlock(audioId: string | null, fallbackText: string, baseUrl: string, language = "en-US", _speechTimeout = 2.5): string {
  // Play OUTSIDE <Gather> so the AI always finishes speaking before Twilio starts
  // listening. Nesting inside Gather enables barge-in, which caused the AI to be cut
  // off mid-sentence when the caller spoke or phone echo triggered detection early.
  //
  // speechTimeout="auto" uses Twilio's ML model to detect natural end-of-speech
  // rather than a fixed silence timer, preventing the caller from being cut off
  // mid-sentence during brief pauses between words.
  const audio = playOrSay(audioId, fallbackText, baseUrl);
  return `${audio}
<Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="${language}" action="${baseUrl}/api/twilio/ai-gather" method="POST">
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

  // Match inbound caller to a CRM contact by phone number (free, uses our DB).
  if (From && From !== "Anonymous") {
    setImmediate(async () => {
      try {
        const [contact] = await db.select().from(contactsTable)
          .where(eq(contactsTable.phone, From));
        if (contact) {
          const contactName = `${contact.firstName} ${contact.lastName}`.trim();
          await db.update(callLogsTable)
            .set({ contactName })
            .where(eq(callLogsTable.twilioCallSid, CallSid));
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, "CRM contact lookup failed");
      }
    });
  }

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
        } else {
          logger.info({ From }, "Twilio CNAM lookup returned no name (add-on may not be enabled)");
        }
      } catch (err: any) {
        logger.warn({ From, err: err?.message, code: err?.code }, "Twilio CNAM lookup failed");
      }
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

    const recordAttr = ` record="record-from-answer-dual-channel" recordingStatusCallback="${baseUrl}/api/twilio/recording" recordingStatusCallbackMethod="POST"`;

    const callerExperience = phoneNumber?.callerExperience ?? "ringing";
    const holdMsg = phoneNumber?.holdMessage?.trim() || null;
    const preDialSay = holdMsg ? `<Say voice="${TWILIO_FALLBACK_VOICE}">${escapeXml(holdMsg)}</Say>` : "";

    if (callerExperience === "greeting_name" && phoneNumber?.id) {
      // Record caller's name, then dial with name whisper to agent
      const encodedFrom = encodeURIComponent(From ?? "");
      const encodedFwd = encodeURIComponent(forwardTo);
      const nameRecordedUrl = `${baseUrl}/api/twilio/name-recorded?phoneNumberId=${phoneNumber.id}&amp;forwardTo=${encodedFwd}&amp;callerFrom=${encodedFrom}&amp;callScreenFallback=${callScreenFallback}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${preDialSay}
  <Say voice="${TWILIO_FALLBACK_VOICE}">Please say your name after the tone, then press pound.</Say>
  <Record maxLength="8" trim="trim-silence" finishOnKey="#" action="${nameRecordedUrl}" method="POST"/>
</Response>`;
    } else if (callScreen && phoneNumber?.id) {
      const encodedFrom = encodeURIComponent(From ?? "");
      const screenUrl = `${baseUrl}/api/twilio/screen?phoneNumberId=${phoneNumber.id}&amp;fallback=${callScreenFallback}&amp;callerFrom=${encodedFrom}`;
      // Use Dial action= so DialCallStatus is posted — lets us detect "completed" (agent answered)
      // vs "no-answer"/"busy"/"failed" (agent didn't pick up) and skip the fallback when answered.
      const fallbackUrl = `${baseUrl}/api/twilio/screen-fallback?phoneNumberId=${phoneNumber.id}&amp;mode=${callScreenFallback}`;
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${preDialSay}
  <Dial${callerIdAttr}${recordAttr} timeout="${ringCount * 5}" action="${fallbackUrl}" method="POST">
    <Number url="${screenUrl}">${forwardTo}</Number>
  </Dial>
</Response>`;
    } else {
      const noAnswerAction = phoneNumber?.forwardNoAnswerAction ?? "personal_voicemail";
      const hasNoAnswerFallback = (noAnswerAction === "voicemail" || noAnswerAction === "ai_voice") && phoneNumber?.id;
      const noAnswerActionAttr = hasNoAnswerFallback
        ? ` action="${baseUrl}/api/twilio/screen-fallback?phoneNumberId=${phoneNumber.id}&amp;mode=${noAnswerAction}" method="POST"`
        : "";
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${preDialSay}
  <Dial${callerIdAttr}${recordAttr} timeout="${ringCount * 5}"${noAnswerActionAttr}>
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
    const voiceStyle = aiConfig?.voiceStyle ?? "";
    const maxDuration = aiConfig?.maxCallDuration ?? 300;
    const speechTimeout = aiConfig?.speechTimeout ?? 1.0;
    const maxTokens = aiConfig?.maxTokens ?? 100;
    const greetingText = aiConfig?.greeting?.trim() || "Hello, thank you for calling. How can I help you today?";

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

    // Pre-seed the greeting as the first assistant message so the AI knows it
    // already introduced itself and won't repeat the greeting on the first reply.
    const greetingForHistory = aiConfig?.greeting?.trim() || DEFAULT_GREETING;

    conversations.set(CallSid, {
      systemPrompt,
      messages: [{ role: "assistant", content: greetingForHistory }],
      maxDuration,
      startedAt: Date.now(),
      voice: ttsVoice,
      voiceStyle,
      language,
      baseUrl,
      speechTimeout,
      maxTokens,
    });

    // Generate greeting + retry audio in parallel, and start recording (non-blocking)
    const retryFallback = language === "ar-SA" ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    startCallRecording(CallSid, `${baseUrl}/api/twilio/recording`);
    const [greetingAudioId, retryAudioId] = await Promise.all([
      generateTts(greetingText, ttsVoice, voiceStyle),
      generateTts(retryFallback, ttsVoice, voiceStyle),
    ]);

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

  const { baseUrl, voice, voiceStyle, language } = conv;
  const isArabic = language.startsWith("ar-");

  // Check max duration
  const elapsed = (Date.now() - conv.startedAt) / 1000;
  if (elapsed > conv.maxDuration) {
    conversations.delete(CallSid);
    const byeText = isArabic ? "لقد وصلنا إلى الحد الأقصى لمدة المكالمة. شكرا لاتصالك. مع السلامة!" : "We've reached the maximum call duration. Thank you for calling. Goodbye!";
    const audioId = await generateTts(byeText, voice, voiceStyle);
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
    const audioId = await generateTts(retryText, voice, voiceStyle);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${gatherBlock(audioId, retryText, baseUrl, language, conv.speechTimeout)}
  <Hangup/>
</Response>`);
    return;
  }

  conv.messages.push({ role: "user", content: SpeechResult });

  try {
    const openai = getChatOpenAI();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: conv.systemPrompt + "\n\nIMPORTANT: You are on a live phone call. Keep responses concise — 1-2 sentences when possible. Always finish your sentences completely. Never use markdown, bullet points, or lists — only natural spoken language. NUMBERS AND DATES ARE SACRED: reproduce every number, salary, date, and figure character-for-character exactly as written in your instructions — never round, shorten, approximate, paraphrase, or invent any numeric or date value under any circumstances.",
        },
        ...conv.messages,
      ],
      max_tokens: conv.maxTokens,
    });

    let aiText = completion.choices[0]?.message?.content ?? "";

    if (!aiText) aiText = isArabic ? "عذرًا، لم أتمكن من المعالجة. هل يمكنك المحاولة مرة أخرى؟" : "I'm sorry, I couldn't process that. Can you try again?";
    conv.messages.push({ role: "assistant", content: aiText });

    const audioId = await generateTts(aiText, voice, voiceStyle);

    // Check if AI naturally wants to end
    const endPhrases = isArabic
      ? ["مع السلامة", "وداعا", "شكرا لاتصالك", "يوم سعيد"]
      : ["goodbye", "have a great day", "take care", "thank you for calling", "bye", "take care now"];
    const wantsToEnd = endPhrases.some(p => aiText.toLowerCase().includes(p.toLowerCase())) && conv.messages.length > 12;

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
  ${gatherBlock(audioId, aiText, baseUrl, language, conv.speechTimeout)}
  <Hangup/>
</Response>`);
  } catch (err: any) {
    req.log.error({ err }, "OpenAI call failed in ai-gather");
    const errText = isArabic ? "أواجه مشكلة تقنية. يرجى المحاولة مرة أخرى لاحقًا." : "I'm having a technical issue right now. Please try calling again later.";
    const audioId = await generateTts(errText, voice, voiceStyle);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, errText, baseUrl)}
  <Hangup/>
</Response>`);
  }
});

// ─── Name recorded — caller stated their name, now dial agent with whisper ─────
router.post("/twilio/name-recorded", async (req, res): Promise<void> => {
  const { RecordingUrl, CallSid } = req.body;
  const { phoneNumberId, forwardTo, callerFrom, callScreenFallback } = req.query as Record<string, string>;
  req.log.info({ CallSid, phoneNumberId, hasRecording: !!RecordingUrl }, "Caller name recorded");

  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;

  let phoneNumber = null;
  if (phoneNumberId) {
    const rows = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, parseInt(phoneNumberId, 10)));
    phoneNumber = rows[0] ?? null;
  }

  const forwardCallerId = phoneNumber?.forwardCallerId ?? "caller";
  const lineNumber = phoneNumber?.number ?? "";
  const callerIdAttr = forwardCallerId === "line" && lineNumber ? ` callerId="${lineNumber}"` : "";
  const ringCount = phoneNumber?.ringCount ?? 4;
  const fbMode = callScreenFallback ?? phoneNumber?.callScreenFallback ?? "voicemail";
  const recordAttr = ` record="record-from-answer-dual-channel" recordingStatusCallback="${baseUrl}/api/twilio/recording" recordingStatusCallbackMethod="POST"`;

  const recordingMp3 = RecordingUrl ? RecordingUrl + ".mp3" : "";
  const encodedRecUrl = encodeURIComponent(recordingMp3);
  const nameScreenUrl = `${baseUrl}/api/twilio/name-screen?recordingUrl=${encodedRecUrl}&amp;phoneNumberId=${phoneNumberId}&amp;fallback=${fbMode}`;
  const fallbackUrl = `${baseUrl}/api/twilio/screen-fallback?phoneNumberId=${phoneNumberId}&amp;mode=${fbMode}`;
  const fwdTo = forwardTo ? decodeURIComponent(forwardTo) : (phoneNumber?.forwardTo ?? "");

  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial${callerIdAttr}${recordAttr} timeout="${ringCount * 5}">
    <Number url="${nameScreenUrl}">${escapeXml(fwdTo)}</Number>
  </Dial>
  <Redirect method="POST">${fallbackUrl}</Redirect>
</Response>`);
});

// ─── Name screen whisper — plays caller's name recording to agent before bridge
router.post("/twilio/name-screen", (req, res): void => {
  const { recordingUrl, fallback } = req.query as Record<string, string>;
  const parentCallSid: string = req.body.ParentCallSid ?? "";
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;

  const decodedRecUrl = recordingUrl ? decodeURIComponent(recordingUrl) : "";
  const fallbackLabel = fallback === "ai_voice" ? "AI agent" : "voicemail";
  const acceptUrl = parentCallSid
    ? `${baseUrl}/api/twilio/screen-accept?parentCallSid=${encodeURIComponent(parentCallSid)}`
    : `${baseUrl}/api/twilio/screen-accept`;

  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${acceptUrl}" method="POST" timeout="15">
    <Say voice="${TWILIO_FALLBACK_VOICE}">Incoming call. The caller says their name is</Say>
    ${decodedRecUrl ? `<Play>${decodedRecUrl}</Play>` : `<Say voice="${TWILIO_FALLBACK_VOICE}">unknown.</Say>`}
    <Say voice="${TWILIO_FALLBACK_VOICE}">Press 1 to answer, or hang up to send to ${fallbackLabel}.</Say>
  </Gather>
  <Hangup/>
</Response>`);
});

// ─── Call screen whisper (plays to YOU when you answer a forwarded call) ──────
router.post("/twilio/screen", async (req, res): Promise<void> => {
  // callerFrom is passed as a query param from the voice webhook (the real inbound caller).
  // req.body.From here is the Twilio-to-forwardTo outbound leg number, NOT the caller.
  // req.body.ParentCallSid is the inbound caller's CallSid — we pass it to screen-accept
  // so it can key on the same CallSid that screen-fallback will check.
  const { phoneNumberId, fallback, callerFrom } = req.query as Record<string, string>;
  const parentCallSid: string = req.body.ParentCallSid ?? "";
  const From = callerFrom ? decodeURIComponent(callerFrom) : null;
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;

  const fallbackLabel = fallback === "ai_voice" ? "AI agent" : "voicemail";
  req.log.info({ phoneNumberId, fallback, callerFrom: From }, "Call screen whisper");

  // Look up the line name and caller identity in parallel
  let lineName = "your business";
  let callerLabel = "an unknown caller";

  try {
    const [numRow, contactRow] = await Promise.all([
      phoneNumberId
        ? db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, parseInt(phoneNumberId, 10))).then(r => r[0] ?? null)
        : Promise.resolve(null),
      From && From !== "Anonymous"
        ? db.select().from(contactsTable).where(eq(contactsTable.phone, From)).then(r => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    // Line name: callerIdName → company name → fallback
    if (numRow?.callerIdName) {
      lineName = numRow.callerIdName;
    } else if (numRow?.companyId) {
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, numRow.companyId));
      if (co?.name) lineName = co.name;
    }

    // Caller identity: CRM contact name → formatted number → anonymous
    if (contactRow) {
      callerLabel = `${contactRow.firstName} ${contactRow.lastName}`.trim() || callerLabel;
    } else if (From && From !== "Anonymous") {
      // Format for natural speech: +12267586681 → 226-758-6681
      const digits = From.replace(/\D/g, "");
      const local = digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
      callerLabel = local.length === 10
        ? `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`
        : From;
    }
  } catch (err: any) {
    req.log.warn({ err: err?.message }, "Screen whisper lookup failed — using defaults");
  }

  const acceptUrl = parentCallSid
    ? `${baseUrl}/api/twilio/screen-accept?parentCallSid=${encodeURIComponent(parentCallSid)}`
    : `${baseUrl}/api/twilio/screen-accept`;

  res.set("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${acceptUrl}" method="POST" timeout="3">
    <Say voice="${TWILIO_FALLBACK_VOICE}">Incoming call for ${escapeXml(lineName)} from ${escapeXml(callerLabel)}. Press 1 to answer, or hang up to send to ${fallbackLabel}.</Say>
  </Gather>
  <Hangup/>
</Response>`);
});

// ─── Screen accept — pressed key after whisper ───────────────────────────────
router.post("/twilio/screen-accept", (req, res): void => {
  const { Digits } = req.body;
  // parentCallSid is threaded from the whisper URL — it's the inbound caller's CallSid,
  // which matches what screen-fallback will check. req.body.CallSid is the outbound leg
  // (agent's phone) and is a different ID, so we must NOT use that one.
  const { parentCallSid } = req.query as Record<string, string>;
  res.set("Content-Type", "text/xml");
  if (Digits === "1") {
    if (parentCallSid) acceptedScreenCalls.add(parentCallSid);
    // Empty response = bridge the two call legs
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response/>`);
  } else {
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

// ─── Screen fallback — caller lands here if screen rejected ──────────────────
router.post("/twilio/screen-fallback", async (req, res): Promise<void> => {
  const { CallSid, To, From, DialCallStatus } = req.body;
  const { phoneNumberId, mode } = req.query as Record<string, string>;
  req.log.info({ CallSid, phoneNumberId, mode, DialCallStatus }, "Call screen fallback");

  // Only skip the fallback if the agent genuinely accepted (pressed 1) AND talked.
  // DialCallStatus "completed" alone isn't enough — declining on a mobile phone also
  // produces "completed" because the device answers briefly to signal the reject.
  const wasAccepted = acceptedScreenCalls.has(CallSid);
  acceptedScreenCalls.delete(CallSid); // cleanup regardless
  if (wasAccepted && DialCallStatus === "completed") {
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
    return;
  }

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
    const voiceStyle2 = aiConfig?.voiceStyle ?? "";
    const maxDuration = aiConfig?.maxCallDuration ?? 300;
    const speechTimeout = aiConfig?.speechTimeout ?? 1.0;
    const maxTokens = aiConfig?.maxTokens ?? 250;
    const greetingText = aiConfig?.greeting?.trim() || "Hello, thank you for calling. How can I help you today?";

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
      messages: [{ role: "assistant", content: greetingText }],
      maxDuration,
      startedAt: Date.now(),
      voice: ttsVoice,
      voiceStyle: voiceStyle2,
      language,
      baseUrl,
      speechTimeout,
      maxTokens,
    });

    // Generate greeting + retry audio in parallel, and start recording (non-blocking)
    const retryFallback = language.startsWith("ar-") ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    startCallRecording(CallSid, `${baseUrl}/api/twilio/recording`);
    const [greetingAudioId, retryAudioId] = await Promise.all([
      generateTts(greetingText, ttsVoice, voiceStyle2),
      generateTts(retryFallback, ttsVoice, voiceStyle2),
    ]);

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
    const openai = getChatOpenAI();
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
  const { CallSid, CallStatus, CallDuration, RecordingUrl, RecordingSid } = req.body;
  req.log.info({ CallSid, CallStatus, CallDuration }, "Twilio status callback");

  const isTerminal = ["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus);

  if (CallSid) {
    const updateData: Record<string, any> = {
      status: CallStatus,
      duration: CallDuration ? parseInt(CallDuration, 10) : null,
    };

    // Capture recording fields if Twilio includes them in the status callback
    if (RecordingUrl) updateData.recordingUrl = `${RecordingUrl}.mp3`;
    if (RecordingSid) updateData.recordingSid = RecordingSid;

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

      // If we still don't have a recording URL, poll Twilio to catch recordings
      // that finish processing after the status callback fires.
      if (!RecordingUrl) {
        const pollForRecording = async () => {
          const delays = [5000, 20000, 60000];
          const client = getTwilioClient();

          // Check if startCallRecording() already stored a preferred SID.
          // If so, poll that specific recording rather than grabbing whichever
          // recording Twilio returns first (which might be the short Dial whisper).
          const [currentRow] = await db
            .select({ recordingSid: callLogsTable.recordingSid, recordingUrl: callLogsTable.recordingUrl })
            .from(callLogsTable)
            .where(eq(callLogsTable.twilioCallSid, CallSid));

          const preferredSid = currentRow?.recordingSid ?? null;

          for (const delay of delays) {
            await new Promise(r => setTimeout(r, delay));
            try {
              if (preferredSid) {
                // Fetch the specific recording we started via API
                const rec = await client.recordings(preferredSid).fetch();
                if (rec && rec.status === "completed") {
                  const url = `https://api.twilio.com/2010-04-01/Accounts/${rec.accountSid}/Recordings/${rec.sid}.mp3`;
                  logger.info({ CallSid, recordingSid: rec.sid }, "Preferred recording ready via polling");
                  await db.update(callLogsTable)
                    .set({ recordingUrl: url })
                    .where(eq(callLogsTable.twilioCallSid, CallSid));
                  await sendCallNotificationIfConfigured(CallSid, url);
                  return;
                }
              } else {
                // No preferred SID — take the longest available recording for this call
                const recs = await client.recordings.list({ callSid: CallSid, limit: 10 });
                if (recs.length > 0) {
                  // Prefer the longest recording (actual conversation vs short whisper)
                  const rec = recs.sort((a, b) => (Number(b.duration) || 0) - (Number(a.duration) || 0))[0];
                  const url = `https://api.twilio.com/2010-04-01/Accounts/${rec.accountSid}/Recordings/${rec.sid}.mp3`;
                  logger.info({ CallSid, recordingSid: rec.sid, duration: rec.duration }, "Recording found via polling");
                  await db.update(callLogsTable)
                    .set({ recordingSid: rec.sid, recordingUrl: url })
                    .where(eq(callLogsTable.twilioCallSid, CallSid));
                  await sendCallNotificationIfConfigured(CallSid, url);
                  return;
                }
              }
            } catch (err: any) {
              logger.warn({ CallSid, err: err?.message }, "Recording poll attempt failed");
            }
          }
          logger.info({ CallSid }, "No recording found after polling (call may not have been recorded)");
          // Send notification even without a recording so the summary/transcript still arrives
          await sendCallNotificationIfConfigured(CallSid, null);
        };
        setImmediate(() => { pollForRecording().catch(() => {}); });
      } else {
        // RecordingUrl already present in the status callback — send notification after DB update
        setImmediate(() => {
          sendCallNotificationIfConfigured(CallSid, `${RecordingUrl}.mp3`).catch(() => {});
        });
      }
    }

    await db.update(callLogsTable)
      .set(updateData)
      .where(eq(callLogsTable.twilioCallSid, CallSid));
  }

  res.sendStatus(200);
});

// ─── Recording callback ──────────────────────────────────────────────────────
router.post("/twilio/recording", async (req, res): Promise<void> => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration, TranscriptionText } = req.body;
  req.log.info({ CallSid, RecordingSid, RecordingDuration }, "Twilio recording callback");

  if (CallSid && (RecordingUrl || RecordingSid || TranscriptionText)) {
    // If we already have a preferred recording SID (set by startCallRecording()),
    // don't let a secondary recording (e.g. the short Dial whisper) overwrite it.
    const [existing] = await db
      .select({ recordingSid: callLogsTable.recordingSid, recordingUrl: callLogsTable.recordingUrl })
      .from(callLogsTable)
      .where(eq(callLogsTable.twilioCallSid, CallSid));

    const preferredSid = existing?.recordingSid ?? null;
    const isPreferredCallback = !preferredSid || preferredSid === RecordingSid;

    if (!isPreferredCallback) {
      req.log.info(
        { CallSid, incomingSid: RecordingSid, preferredSid },
        "Ignoring recording callback for secondary recording (Dial whisper); preferred SID already set"
      );
      res.sendStatus(200);
      return;
    }

    const updateData: any = {};
    if (RecordingUrl) updateData.recordingUrl = `${RecordingUrl}.mp3`;
    if (RecordingSid) updateData.recordingSid = RecordingSid;
    if (TranscriptionText) updateData.transcription = TranscriptionText;
    if (Object.keys(updateData).length === 0) { res.sendStatus(200); return; }

    await db.update(callLogsTable)
      .set(updateData)
      .where(eq(callLogsTable.twilioCallSid, CallSid));
  }

  res.sendStatus(200);
});

export default router;
