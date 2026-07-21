import { Router, type IRouter } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, phoneNumbersTable, callLogsTable, aiVoiceConfigTable, companiesTable, contactsTable, smsMessagesTable, extensionsTable, appointmentsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import OpenAI from "openai";
import twilio from "twilio";
import { randomUUID } from "crypto";
import nodemailer from "nodemailer";
import { sendBookingNotifications, sendRescheduleNotifications, sendCancellationNotifications } from "../lib/notifications";

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
    if (log.toNumber) {
      const rows = await db
        .select()
        .from(phoneNumbersTable)
        .where(eq(phoneNumbersTable.number, log.toNumber));
      phoneNumber = rows[0] ?? null;
    }

    const notificationEmail = phoneNumber?.notificationEmail;
    if (!notificationEmail) {
      logger.info({ callSid, toNumber: log.toNumber }, "No notification email configured — skipping call email");
      return;
    }

    const transport = getEmailTransport();
    if (!transport) {
      logger.warn({ callSid }, "SMTP not configured — skipping call notification email");
      return;
    }

    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";

    // Build a proxied recording URL through our own endpoint so the email
    // recipient can click and play instantly — no Twilio credentials required.
    const publicDomain = process.env.APP_URL
      ? process.env.APP_URL.replace(/\/$/, "")
      : process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`
        : process.env.REPLIT_DEV_DOMAIN
          ? `https://${process.env.REPLIT_DEV_DOMAIN}`
          : null;
    const hasRecording = !!(overrideRecordingUrl ?? log.recordingUrl ?? log.recordingSid);
    const recordingUrl = hasRecording && publicDomain
      ? `${publicDomain}/api/call-logs/${log.id}/recording`
      : null;

    const callerLabel = log.contactName ?? log.callerIdName ?? log.callerName ?? null;
    const callerDisplay = callerLabel
      ? `${callerLabel} (${log.fromNumber ?? "Unknown"})`
      : (log.fromNumber ?? "Unknown caller");

    const durationSec = log.duration ?? 0;
    const durationDisplay = durationSec > 0
      ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
      : "N/A";

    const modeLabels: Record<string, string> = {
      forward: "Forwarded", ai_voice: "AI Agent", voicemail: "Voicemail", reject: "Rejected",
    };
    const modeDisplay = modeLabels[log.answerMode ?? ""] ?? (log.answerMode ?? "Unknown");

    const calledAt = log.createdAt ?? new Date();
    const subject = `Call Summary — ${callerDisplay} — ${calledAt.toLocaleString()}`;

    const priorityColor: Record<string, string> = {
      high: "#ef4444", medium: "#f59e0b", low: "#22c55e",
    };
    const priorityBadge = log.priority
      ? `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;background:${priorityColor[log.priority] ?? "#6b7280"}22;color:${priorityColor[log.priority] ?? "#6b7280"};border:1px solid ${priorityColor[log.priority] ?? "#6b7280"}44">${log.priority}</span>`
      : "";

    const recordingBtn = recordingUrl
      ? `<div style="margin:28px 0;text-align:center">
           <a href="${recordingUrl}" style="display:inline-block;padding:12px 32px;background:#22c55e;color:#fff;font-family:sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;letter-spacing:.3px">
             &#9654;&nbsp; Listen to Recording
           </a>
         </div>`
      : "";

    const summaryBlock = log.callSummary
      ? `<div style="background:#f8f9fa;border-left:3px solid #22c55e;border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 16px">
           <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#22c55e">AI Summary</p>
           <p style="margin:0;font-size:14px;line-height:1.6;color:#1a1a1a">${log.callSummary}</p>
           ${log.actionRequired ? `<p style="margin:10px 0 0;font-size:13px;color:#374151"><strong style="color:#1a1a1a">Action:</strong> ${log.actionRequired}</p>` : ""}
         </div>`
      : "";

    const transcriptBlock = log.transcription
      ? `<div style="margin-top:16px">
           <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#6b7280">Transcript</p>
           <div style="background:#f1f5f9;border-radius:6px;padding:14px 16px;font-size:12px;line-height:1.7;color:#374151;white-space:pre-wrap;font-family:ui-monospace,monospace">${log.transcription}</div>
         </div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

      <!-- Header -->
      <tr><td style="background:#0f172a;border-radius:10px 10px 0 0;padding:24px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#22c55e">CallingAgent</p>
              <h1 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#f8fafc;letter-spacing:-.3px">Incoming Call</h1>
              <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">${phoneNumber?.friendlyName ?? log.toNumber ?? "Your Line"}</p>
            </td>
            <td align="right" valign="top">
              <span style="display:inline-block;padding:4px 12px;background:#22c55e22;border:1px solid #22c55e55;border-radius:20px;font-size:11px;font-weight:700;color:#22c55e;letter-spacing:.5px;text-transform:uppercase">Completed</span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Stats bar -->
      <tr><td style="background:#1e293b;padding:0 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:16px 0;border-right:1px solid #334155;text-align:center;width:33%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">Duration</p>
              <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#f1f5f9;letter-spacing:-.5px">${durationDisplay}</p>
            </td>
            <td style="padding:16px 0;border-right:1px solid #334155;text-align:center;width:33%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">Mode</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:700;color:#f1f5f9">${modeDisplay}</p>
            </td>
            <td style="padding:16px 0;text-align:center;width:33%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">Time</p>
              <p style="margin:4px 0 0;font-size:13px;font-weight:600;color:#f1f5f9">${calledAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#64748b">${calledAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#ffffff;padding:28px 32px;border-radius:0 0 10px 10px">

        <!-- Caller info -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px">
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;width:120px">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Caller</p>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a">${callerDisplay}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Line</p>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <p style="margin:0;font-size:14px;color:#374151">${phoneNumber?.friendlyName ? `${phoneNumber.friendlyName} &nbsp;<span style="color:#94a3b8;font-size:12px">${log.toNumber ?? ""}</span>` : (log.toNumber ?? "")}</p>
            </td>
          </tr>
          ${log.callType ? `<tr>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Type</p>
            </td>
            <td style="padding:10px 0;border-bottom:1px solid #f1f5f9">
              <p style="margin:0;font-size:14px;color:#374151">${log.callType}</p>
            </td>
          </tr>` : ""}
          ${log.priority ? `<tr>
            <td style="padding:10px 0">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Priority</p>
            </td>
            <td style="padding:10px 0">${priorityBadge}</td>
          </tr>` : ""}
        </table>

        ${recordingBtn}
        ${summaryBlock}
        ${transcriptBlock}

        <!-- Footer -->
        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f1f5f9;display:flex;align-items:center">
          <p style="margin:0;font-size:11px;color:#94a3b8">Sent by <strong style="color:#64748b">CallingAgent</strong></p>
        </div>

      </td></tr>
    </table>
  </td></tr>
</table>
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
  voiceEngine: string;
  elevenLabsVoiceId: string | null;
  language: string;
  baseUrl: string;
  speechTimeout: number;
  maxTokens: number;
  companyId: number | null;
  phoneNumberId: number | null;
  fromNumber: string | null;
  companyName: string | null;
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

export async function synthesizeElevenLabs(text: string, voiceId: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS error ${resp.status}: ${errText}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

export interface TtsEngineOpts {
  engine?: string | null;
  elevenLabsVoiceId?: string | null;
}

async function generateTts(text: string, voice = "nova", voiceStyle?: string, engineOpts?: TtsEngineOpts): Promise<string | null> {
  if (engineOpts?.engine === "elevenlabs" && engineOpts.elevenLabsVoiceId) {
    try {
      const warmKey = `el:${engineOpts.elevenLabsVoiceId}:${text}`;
      const warm = ttsWarmCache.get(warmKey);
      if (warm) return cacheTts(warm);

      const buffer = await synthesizeElevenLabs(text, engineOpts.elevenLabsVoiceId);
      ttsWarmCache.set(warmKey, buffer);
      return cacheTts(buffer);
    } catch (err: any) {
      logger.warn({ err: err?.message }, "ElevenLabs TTS failed — falling back to OpenAI voice");
    }
  }

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
  try {

  const baseUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;

  // Twilio sends E.164 without spaces (e.g. "+12262865860") but the DB may store
  // formatted numbers with spaces (e.g. "+1 226 286 5860"). Strip spaces on both sides.
  const toNormalized = To.replace(/\s/g, "");
  const [phoneNumber] = await db.select().from(phoneNumbersTable)
    .where(sql`REPLACE(${phoneNumbersTable.number}, ' ', '') = ${toNormalized}`);

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

  if (answerMode === "ivr") {
    let companyName: string | null = null;
    let extensions: typeof extensionsTable.$inferSelect[] = [];
    if (phoneNumber?.companyId) {
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, phoneNumber.companyId));
      companyName = co?.name ?? null;
      extensions = await db.select().from(extensionsTable)
        .where(eq(extensionsTable.companyId, phoneNumber.companyId));
      extensions = extensions.filter(e => e.enabled);
    }
    const greeting = companyName ? `Thank you for calling ${companyName}.` : "Thank you for calling.";
    const extLines = extensions.sort((a, b) => a.digit.localeCompare(b.digit))
      .map(e => `Press ${e.digit} for ${e.name}.`).join(" ");
    const menuText = extLines ? `${greeting} ${extLines} Press 0 to leave a voicemail.` : `${greeting} Please leave a message after the tone.`;
    const gatherUrl = `${baseUrl}/api/twilio/ivr-gather?phoneNumberId=${phoneNumber?.id ?? ""}`;
    if (extensions.length === 0) {
      const vmGreeting = phoneNumber?.voicemailGreeting ?? "Please leave a message after the tone.";
      const audioId = await generateTts(vmGreeting);
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, vmGreeting, baseUrl)}
  <Record maxLength="120" action="${baseUrl}/api/twilio/recording" transcribe="true" transcribeCallback="${baseUrl}/api/twilio/transcription" />
</Response>`;
    } else {
      const menuAudioId = await generateTts(menuText);
      const repeatAudioId = await generateTts(`I didn't get that. ${menuText}`);
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(menuAudioId, menuText, baseUrl)}
  <Gather numDigits="1" action="${gatherUrl}" method="POST" timeout="10">
  </Gather>
  ${playOrSay(repeatAudioId, `I didn't get that. ${menuText}`, baseUrl)}
  <Gather numDigits="1" action="${gatherUrl}" method="POST" timeout="10">
  </Gather>
  <Hangup/>
</Response>`;
    }

  } else if (answerMode === "forward" && !forwardTo) {
    // Forward mode configured but no destination set — fall back to voicemail
    const greeting = phoneNumber?.voicemailGreeting ?? "Thank you for calling. Please leave a message after the tone and we'll get back to you.";
    const audioId = await generateTts(greeting);
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, greeting, baseUrl)}
  <Record maxLength="120" action="${baseUrl}/api/twilio/recording" transcribe="true" transcribeCallback="${baseUrl}/api/twilio/transcription" />
</Response>`;

  } else if (answerMode === "forward" && forwardTo) {
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
    // Per-number settings take priority over global defaults
    const language = phoneNumber?.aiLanguage || aiConfig?.language || "en-US";
    const ttsVoice = phoneNumber?.aiVoice || aiConfig?.voice || "nova";
    const voiceStyle = phoneNumber?.aiSpeakingStyle || aiConfig?.voiceStyle || "";
    const voiceEngine = phoneNumber?.aiVoiceEngine || aiConfig?.aiVoiceEngine || "openai";
    const elevenLabsVoiceId = phoneNumber?.aiElevenLabsVoiceId || aiConfig?.elevenLabsVoiceId || null;
    const engineOpts: TtsEngineOpts = { engine: voiceEngine, elevenLabsVoiceId };
    const maxDuration = aiConfig?.maxCallDuration ?? 300;
    const speechTimeout = aiConfig?.speechTimeout ?? 1.0;
    const maxTokens = aiConfig?.maxTokens ?? 100;
    const greetingText = phoneNumber?.aiGreeting?.trim() || aiConfig?.greeting?.trim() || "Hello, thank you for calling. How can I help you today?";

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
      voiceEngine,
      elevenLabsVoiceId,
      language,
      baseUrl,
      speechTimeout,
      maxTokens,
      companyId: phoneNumber?.companyId ?? null,
      phoneNumberId: phoneNumber?.id ?? null,
      fromNumber: phoneNumber?.number ?? null,
      companyName: companyName ?? null,
    });

    // Generate greeting + retry audio in parallel BEFORE responding
    // (startCallRecording is deferred until after res.send — calling the Twilio
    // recordings API before TwiML is returned causes Twilio to fire "no-answer"
    // and terminate the call prematurely on the first cold-start when TTS is slow)
    const retryFallback = language === "ar-SA" ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    const [greetingAudioId, retryAudioId] = await Promise.all([
      generateTts(greetingText, ttsVoice, voiceStyle, engineOpts),
      generateTts(retryFallback, ttsVoice, voiceStyle, engineOpts),
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

  // Start recording AFTER TwiML is sent — calling the Twilio recordings API
  // before the response is returned terminates the call prematurely on cold starts.
  if (answerMode === "ai_voice") {
    setImmediate(() => {
      startCallRecording(CallSid, `${baseUrl}/api/twilio/recording`);
    });
  }

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack }, "Unhandled error in /twilio/voice — returning safe TwiML");
    if (!res.headersSent) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${TWILIO_FALLBACK_VOICE}">Thank you for calling. We are unable to take your call right now. Please try again later.</Say>
</Response>`);
    }
  }
});

// ─── IVR digit gather callback ───────────────────────────────────────────────
router.post("/twilio/ivr-gather", async (req, res): Promise<void> => {
  const { Digits, To, From } = req.body;
  const phoneNumberId = parseInt(req.query.phoneNumberId as string, 10);
  res.set("Content-Type", "text/xml");
  try {
    const baseUrl = process.env.APP_URL
      ? process.env.APP_URL.replace(/\/$/, "")
      : process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : `${req.protocol}://${req.get("host")}`;

    if (!phoneNumberId || isNaN(phoneNumberId)) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }
    const [phoneNumber] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, phoneNumberId));
    if (!phoneNumber?.companyId) {
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }

    // Digit 0 → voicemail
    if (Digits === "0") {
      const greeting = phoneNumber.voicemailGreeting ?? "Please leave a message after the tone.";
      const audioId = await generateTts(greeting);
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, greeting, baseUrl)}
  <Record maxLength="120" action="${baseUrl}/api/twilio/recording" transcribe="true" transcribeCallback="${baseUrl}/api/twilio/transcription" />
</Response>`);
      return;
    }

    const extensions = await db.select().from(extensionsTable)
      .where(eq(extensionsTable.companyId, phoneNumber.companyId));
    const ext = extensions.find(e => e.digit === Digits && e.enabled);

    if (!ext) {
      const audioId = await generateTts("That extension was not found. Please try again.");
      // Re-serve the IVR menu
      const gatherUrl = `${baseUrl}/api/twilio/ivr-gather?phoneNumberId=${phoneNumberId}`;
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, "That extension was not found. Please try again.", baseUrl)}
  <Gather numDigits="1" action="${gatherUrl}" method="POST" timeout="10">
  </Gather>
  <Hangup/>
</Response>`);
      return;
    }

    const connectMsg = `Connecting you to ${ext.name}. Please hold.`;
    const audioId = await generateTts(connectMsg);
    const recordAttr = ` record="record-from-answer-dual-channel" recordingStatusCallback="${baseUrl}/api/twilio/recording" recordingStatusCallbackMethod="POST"`;
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, connectMsg, baseUrl)}
  <Dial${recordAttr} callerId="${To ?? ""}">
    <Number>${escapeXml(ext.forwardTo)}</Number>
  </Dial>
</Response>`);
  } catch (err: any) {
    req.log.error({ err: err?.message }, "IVR gather error");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

// ─── AI speech gather callback ───────────────────────────────────────────────
router.post("/twilio/ai-gather", async (req, res): Promise<void> => {
  const { CallSid, SpeechResult } = req.body;
  req.log.info({ CallSid, SpeechResult }, "AI gather callback");
  try {

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

  const { baseUrl, voice, voiceStyle, voiceEngine, elevenLabsVoiceId, language } = conv;
  const isArabic = language.startsWith("ar-");
  const engineOpts: TtsEngineOpts = { engine: voiceEngine, elevenLabsVoiceId };

  // Check max duration
  const elapsed = (Date.now() - conv.startedAt) / 1000;
  if (elapsed > conv.maxDuration) {
    conversations.delete(CallSid);
    const byeText = isArabic ? "لقد وصلنا إلى الحد الأقصى لمدة المكالمة. شكرا لاتصالك. مع السلامة!" : "We've reached the maximum call duration. Thank you for calling. Goodbye!";
    const audioId = await generateTts(byeText, voice, voiceStyle, engineOpts);
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
    const audioId = await generateTts(retryText, voice, voiceStyle, engineOpts);
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

    // Helper: get company notification context
    async function getCompanyNotifContext() {
      if (!conv.companyId) return { companyName: conv.companyName ?? "the business", companyAdminEmail: null as string | null, companyAdminWhatsapp: null as string | null };
      const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, conv.companyId));
      return {
        companyName: co?.name ?? conv.companyName ?? "the business",
        companyAdminEmail: co?.adminNotificationEmail ?? co?.email ?? null,
        companyAdminWhatsapp: co?.adminWhatsapp ?? null,
      };
    }

    const callerPhone = conv.fromNumber ?? "unknown";

    const aiTools: OpenAI.Chat.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "book_appointment",
          description: "Book a new appointment for the caller. Use when the caller wants to schedule a meeting, consultation, service visit, or callback.",
          parameters: {
            type: "object",
            required: ["customerName", "customerPhone", "startTime", "title"],
            properties: {
              customerName: { type: "string", description: "Full name of the caller" },
              customerPhone: { type: "string", description: "Phone number — use the caller's number if not explicitly given" },
              customerEmail: { type: "string", description: "Email address if the caller provides it" },
              title: { type: "string", description: "Type or purpose (e.g. 'Consultation', 'Tire Service', 'Follow-up')" },
              startTime: { type: "string", description: "ISO 8601 datetime (e.g. 2025-07-14T10:00:00Z)" },
              endTime: { type: "string", description: "ISO 8601 end datetime (optional)" },
              notes: { type: "string", description: "Any additional details or requests" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "find_appointments",
          description: "Look up existing appointments for the caller. Use before rescheduling or cancelling to find what appointments exist.",
          parameters: {
            type: "object",
            required: [],
            properties: {
              customerPhone: { type: "string", description: "Phone number to search by — defaults to the caller's number" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "reschedule_appointment",
          description: "Reschedule an existing appointment to a new date/time. Use find_appointments first to get the appointment ID.",
          parameters: {
            type: "object",
            required: ["appointmentId", "newStartTime"],
            properties: {
              appointmentId: { type: "number", description: "ID of the appointment to reschedule" },
              newStartTime: { type: "string", description: "New ISO 8601 start datetime" },
              newEndTime: { type: "string", description: "New ISO 8601 end datetime (optional)" },
              notes: { type: "string", description: "Updated notes (optional)" },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "cancel_appointment",
          description: "Cancel an existing appointment. Use find_appointments first to get the appointment ID.",
          parameters: {
            type: "object",
            required: ["appointmentId"],
            properties: {
              appointmentId: { type: "number", description: "ID of the appointment to cancel" },
            },
          },
        },
      },
    ];

    const systemContent = conv.systemPrompt + "\n\nIMPORTANT: You are on a live phone call. Keep responses concise — 1-2 sentences when possible. Always finish your sentences completely. Never use markdown, bullet points, or lists — only natural spoken language. NUMBERS AND DATES ARE SACRED: reproduce every number, salary, date, and figure character-for-character exactly as written in your instructions — never round, shorten, approximate, paraphrase, or invent any numeric or date value under any circumstances.\n\nYou can book, reschedule, and cancel appointments. When a caller wants to book: collect their name, preferred date/time, and purpose, then call book_appointment. When they want to reschedule or cancel: first call find_appointments to see their existing appointments, then call reschedule_appointment or cancel_appointment. Always confirm the action verbally after completing it.";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemContent },
        ...conv.messages,
      ],
      max_tokens: conv.maxTokens,
      tools: aiTools,
      tool_choice: "auto",
    });

    const choice = completion.choices[0];
    let aiText = choice?.message?.content ?? "";

    // Handle tool calls
    if (choice?.message?.tool_calls?.length) {
      const toolCall = choice.message.tool_calls[0];
      const toolName = toolCall.function.name;

      try {
        const args = JSON.parse(toolCall.function.arguments);

        if (toolName === "book_appointment") {
          const [appointment] = await db.insert(appointmentsTable).values({
            companyId: conv.companyId,
            phoneNumberId: conv.phoneNumberId,
            customerName: args.customerName,
            customerPhone: args.customerPhone ?? callerPhone,
            customerEmail: args.customerEmail ?? null,
            title: args.title ?? "Appointment",
            notes: args.notes ?? null,
            startTime: new Date(args.startTime),
            endTime: args.endTime ? new Date(args.endTime) : null,
            status: "scheduled",
          }).returning();

          if (appointment) {
            const ctx = await getCompanyNotifContext();
            sendBookingNotifications({
              ...ctx,
              customerName: appointment.customerName,
              customerPhone: appointment.customerPhone,
              customerEmail: appointment.customerEmail,
              title: appointment.title,
              notes: appointment.notes,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              twilioFromNumber: conv.fromNumber,
            }).catch(err => logger.warn({ err: err?.message }, "Booking notification failed"));
          }

          const dateStr = new Date(args.startTime).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
          const timeStr = new Date(args.startTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
          aiText = isArabic
            ? `تم حجز موعدك بنجاح في ${dateStr} الساعة ${timeStr}. سنرسل لك تأكيدًا. هل هناك أي شيء آخر يمكنني مساعدتك به؟`
            : `Your appointment has been booked for ${dateStr} at ${timeStr}. You'll receive a confirmation by SMS${args.customerEmail ? " and email" : ""}. Is there anything else I can help you with?`;

        } else if (toolName === "find_appointments") {
          const searchPhone = args.customerPhone ?? callerPhone;
          const found = await db.select().from(appointmentsTable)
            .where(and(
              eq(appointmentsTable.customerPhone, searchPhone),
              ...(conv.companyId ? [eq(appointmentsTable.companyId, conv.companyId)] : []),
            ))
            .orderBy(desc(appointmentsTable.startTime))
            .limit(5);

          const upcoming = found.filter(a => a.startTime > new Date() && a.status !== "cancelled");

          if (upcoming.length === 0) {
            aiText = isArabic
              ? "لم أجد أي مواعيد قادمة مرتبطة برقمك. هل تريد حجز موعد جديد؟"
              : "I don't see any upcoming appointments for your number. Would you like to book a new one?";
          } else {
            // Return appointment data as tool result and let AI respond naturally
            // Push as assistant tool_call + tool result so the AI can form its own reply
            const apptList = upcoming.map(a => {
              const d = a.startTime.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
              const t = a.startTime.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
              return `ID ${a.id}: ${a.title} on ${d} at ${t} (${a.status})`;
            }).join("; ");
            // Feed the result back to AI for a natural response
            const followUp = await openai.chat.completions.create({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemContent },
                ...conv.messages,
                { role: "assistant", content: null, tool_calls: choice.message.tool_calls } as any,
                { role: "tool", tool_call_id: toolCall.id, content: JSON.stringify({ appointments: upcoming.map(a => ({ id: a.id, title: a.title, startTime: a.startTime.toISOString(), status: a.status })) }) } as any,
              ],
              max_tokens: conv.maxTokens,
              tools: aiTools,
              tool_choice: "auto",
            });
            aiText = followUp.choices[0]?.message?.content ?? `I found your appointment: ${apptList}. Would you like to reschedule or cancel it?`;
          }

        } else if (toolName === "reschedule_appointment") {
          const apptId = Number(args.appointmentId);
          const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, apptId));
          if (!existing) {
            aiText = isArabic ? "لم أجد هذا الموعد." : "I couldn't find that appointment. Please try again.";
          } else {
            const oldStartTime = existing.startTime;
            const newStart = new Date(args.newStartTime);
            const [updated] = await db.update(appointmentsTable).set({
              startTime: newStart,
              endTime: args.newEndTime ? new Date(args.newEndTime) : existing.endTime,
              notes: args.notes ?? existing.notes,
              status: "scheduled",
              remindersSent: [], // Reset reminders for new time
            }).where(eq(appointmentsTable.id, apptId)).returning();

            const ctx = await getCompanyNotifContext();
            sendRescheduleNotifications({
              ...ctx,
              customerName: updated.customerName,
              customerPhone: updated.customerPhone,
              customerEmail: updated.customerEmail,
              title: updated.title,
              notes: updated.notes,
              startTime: updated.startTime,
              endTime: updated.endTime,
              twilioFromNumber: conv.fromNumber,
              oldStartTime,
            }).catch(err => logger.warn({ err: err?.message }, "Reschedule notification failed"));

            const dateStr = newStart.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
            const timeStr = newStart.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
            aiText = isArabic
              ? `تم إعادة جدولة موعدك إلى ${dateStr} الساعة ${timeStr}. ستتلقى تأكيدًا قريبًا.`
              : `Done — your appointment has been rescheduled to ${dateStr} at ${timeStr}. You'll receive an updated confirmation. Is there anything else I can help you with?`;
          }

        } else if (toolName === "cancel_appointment") {
          const apptId = Number(args.appointmentId);
          const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, apptId));
          if (!existing) {
            aiText = isArabic ? "لم أجد هذا الموعد." : "I couldn't find that appointment. Please try again.";
          } else {
            await db.update(appointmentsTable).set({ status: "cancelled" }).where(eq(appointmentsTable.id, apptId));

            const ctx = await getCompanyNotifContext();
            sendCancellationNotifications({
              ...ctx,
              customerName: existing.customerName,
              customerPhone: existing.customerPhone,
              customerEmail: existing.customerEmail,
              title: existing.title,
              notes: existing.notes,
              startTime: existing.startTime,
              endTime: existing.endTime,
              twilioFromNumber: conv.fromNumber,
            }).catch(err => logger.warn({ err: err?.message }, "Cancellation notification failed"));

            aiText = isArabic
              ? `تم إلغاء موعدك بنجاح. إذا أردت الحجز مجددًا في المستقبل، لا تتردد في الاتصال.`
              : `Your appointment has been cancelled. You'll receive a cancellation confirmation. If you'd like to rebook in the future, don't hesitate to call us.`;
          }
        }
      } catch (toolErr: any) {
        logger.error({ err: toolErr?.message, tool: toolName }, "AI tool call failed");
        aiText = isArabic ? "حدث خطأ. يرجى المحاولة مرة أخرى أو الاتصال بنا مباشرة." : "I ran into an issue with that. Please try again or contact us directly.";
      }
    }

    if (!aiText) aiText = isArabic ? "عذرًا، لم أتمكن من المعالجة. هل يمكنك المحاولة مرة أخرى؟" : "I'm sorry, I couldn't process that. Can you try again?";
    conv.messages.push({ role: "assistant", content: aiText });

    // Dynamically update Gather language based on what language the AI is now
    // speaking in. Once the AI replies in Arabic, flip conv.language so Twilio
    // uses Arabic STT for the next turn — critical for mid-call language switches.
    const hasArabic = /[\u0600-\u06FF]/.test(aiText);
    if (hasArabic && !conv.language.startsWith("ar-")) {
      conv.language = "ar-SA";
    } else if (!hasArabic && conv.language.startsWith("ar-")) {
      conv.language = "en-US";
    }
    const currentLanguage = conv.language;
    const currentIsArabic = currentLanguage.startsWith("ar-");

    const audioId = await generateTts(aiText, voice, voiceStyle, engineOpts);

    // Check if AI naturally wants to end
    const endPhrases = currentIsArabic
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
  ${gatherBlock(audioId, aiText, baseUrl, currentLanguage, conv.speechTimeout)}
  <Hangup/>
</Response>`);
  } catch (innerErr: any) {
    req.log.error({ err: innerErr }, "OpenAI call failed in ai-gather");
    const isArabicFallback = conv?.language?.startsWith("ar-") ?? false;
    const errText = isArabicFallback ? "أواجه مشكلة تقنية. يرجى المحاولة مرة أخرى لاحقًا." : "I'm having a technical issue right now. Please try calling again later.";
    const audioId = await generateTts(errText, conv?.voice ?? "nova", conv?.voiceStyle ?? "", { engine: conv?.voiceEngine, elevenLabsVoiceId: conv?.elevenLabsVoiceId ?? null });
    if (!res.headersSent) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${playOrSay(audioId, errText, conv?.baseUrl ?? "")}
  <Hangup/>
</Response>`);
    }
  }

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack }, "Unhandled error in /twilio/ai-gather — returning safe TwiML");
    if (!res.headersSent) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${TWILIO_FALLBACK_VOICE}">I'm having a technical issue. Please try calling again later.</Say>
  <Hangup/>
</Response>`);
    }
  }
});

// ─── Name recorded — caller stated their name, now dial agent with whisper ─────
router.post("/twilio/name-recorded", async (req, res): Promise<void> => {
  const { RecordingUrl, CallSid } = req.body;
  const { phoneNumberId, forwardTo, callerFrom, callScreenFallback } = req.query as Record<string, string>;
  req.log.info({ CallSid, phoneNumberId, hasRecording: !!RecordingUrl }, "Caller name recorded");
  try {

  const baseUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
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

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack }, "Unhandled error in /twilio/name-recorded — returning safe TwiML");
    if (!res.headersSent) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${TWILIO_FALLBACK_VOICE}">Thank you for calling. We are unable to take your call right now. Please try again later.</Say>
</Response>`);
    }
  }
});

// ─── Name screen whisper — plays caller's name recording to agent before bridge
router.post("/twilio/name-screen", (req, res): void => {
  const { recordingUrl, fallback } = req.query as Record<string, string>;
  const parentCallSid: string = req.body.ParentCallSid ?? "";
  const baseUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
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
  const baseUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
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
  try {

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

  const baseUrl = process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
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
    const ttsVoice = phoneNumber?.aiVoice || aiConfig?.voice || "nova";
    const voiceStyle2 = phoneNumber?.aiSpeakingStyle || aiConfig?.voiceStyle || "";
    const voiceEngine2 = phoneNumber?.aiVoiceEngine || aiConfig?.aiVoiceEngine || "openai";
    const elevenLabsVoiceId2 = phoneNumber?.aiElevenLabsVoiceId || aiConfig?.elevenLabsVoiceId || null;
    const engineOpts2: TtsEngineOpts = { engine: voiceEngine2, elevenLabsVoiceId: elevenLabsVoiceId2 };
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
      voiceEngine: voiceEngine2,
      elevenLabsVoiceId: elevenLabsVoiceId2,
      language,
      baseUrl,
      speechTimeout,
      maxTokens,
    });

    // Generate greeting + retry audio in parallel, and start recording (non-blocking)
    const retryFallback = language.startsWith("ar-") ? "لم أفهم. هل يمكنك الإعادة؟" : "I didn't catch that. Could you please repeat?";
    startCallRecording(CallSid, `${baseUrl}/api/twilio/recording`);
    const [greetingAudioId, retryAudioId] = await Promise.all([
      generateTts(greetingText, ttsVoice, voiceStyle2, engineOpts2),
      generateTts(retryFallback, ttsVoice, voiceStyle2, engineOpts2),
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

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack }, "Unhandled error in /twilio/screen-fallback — returning safe TwiML");
    if (!res.headersSent) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${TWILIO_FALLBACK_VOICE}">Thank you for calling. We are unable to take your call right now. Please try again later.</Say>
</Response>`);
    }
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
  callerLocation: string | null;
}> {
  if (conv.messages.length === 0) {
    return { callerName: null, callerEmail: null, callType: null, callSummary: null, actionRequired: null, priority: null, callerLocation: null };
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

callType rules (pick exactly one):
- "Emergency" — caller is stranded, broken down, or needs urgent roadside/tire help RIGHT NOW
- "Appointment" — caller booked or requested a service appointment
- "Pricing Inquiry" — caller only asked about pricing, quotes, or costs with no booking or emergency
- "General Inquiry" — anything else (questions, info requests, callbacks, etc.)

priority rules:
- Emergency → always "High"
- Appointment → always "Medium"
- Pricing Inquiry or General Inquiry → "Low"

callerLocation: for Emergency calls, extract any location the caller mentioned (street, intersection, city, landmark). null otherwise.

Return exactly: {"callerName": "...", "callerEmail": "...", "callType": "Emergency|Appointment|Pricing Inquiry|General Inquiry", "callSummary": "2-3 sentences", "actionRequired": "...", "priority": "Low|Medium|High", "callerLocation": "..."}`,
        },
        { role: "user", content: `Transcript:\n\n${transcript}` },
      ],
      max_tokens: 400,
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
      callerLocation: parsed.callerLocation ?? null,
    };
  } catch (err) {
    logger.error({ err }, "Failed to extract call summary");
    return { callerName: null, callerEmail: null, callType: null, callSummary: null, actionRequired: null, priority: null, callerLocation: null };
  }
}

// ─── Post-call SMS / WhatsApp admin notification ──────────────────────────────
async function sendSmsNotificationIfConfigured(callSid: string): Promise<void> {
  try {
    const [log] = await db
      .select()
      .from(callLogsTable)
      .where(eq(callLogsTable.twilioCallSid, callSid));
    if (!log) return;

    const [aiConfig] = await db.select().from(aiVoiceConfigTable);
    const adminPhone = aiConfig?.adminNotifyPhone?.trim();
    if (!adminPhone) return;

    // Resolve business name from the phone number's company
    let businessName = "Us";
    if (log.toNumber) {
      const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, log.toNumber));
      if (pn?.companyId) {
        const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, pn.companyId));
        if (co?.name) businessName = co.name;
      } else if (pn?.friendlyName) {
        businessName = pn.friendlyName;
      }
    }

    const client = getTwilioClient();

    const callerDisplay = log.contactName ?? log.callerIdName ?? log.callerName ?? log.fromNumber ?? "Unknown";
    const durationDisplay = log.duration && log.duration > 0
      ? `${Math.floor(log.duration / 60)}m ${log.duration % 60}s`
      : "N/A";

    const isEmergency = log.callType === "Emergency" || log.priority === "High";
    const isAppointment = log.callType === "Appointment";

    // ── Admin notification ────────────────────────────────────────────────
    let adminMsg = isEmergency
      ? `URGENT — Emergency call from ${callerDisplay} (${durationDisplay})`
      : isAppointment
        ? `Appointment booked — call from ${callerDisplay} (${durationDisplay})`
        : `New call from ${callerDisplay} (${durationDisplay})`;

    if (log.callType) adminMsg += `\nType: ${log.callType}`;
    if (log.callerLocation) adminMsg += `\nLocation: ${log.callerLocation}`;
    if (log.callSummary) adminMsg += `\nSummary: ${log.callSummary}`;
    if (log.actionRequired) adminMsg += `\nAction: ${log.actionRequired}`;

    // Determine from-number: use the "to" number on the call log (our Twilio line)
    let fromNumber = log.toNumber ?? "";
    // WhatsApp requires the whatsapp: prefix; make sure the from-number is also prefixed
    const isWhatsApp = adminPhone.toLowerCase().startsWith("whatsapp:");
    const adminTo = isWhatsApp ? adminPhone : adminPhone;
    const adminFrom = isWhatsApp ? `whatsapp:${fromNumber}` : fromNumber;

    await client.messages.create({ body: adminMsg, from: adminFrom, to: adminTo });
    logger.info({ callSid, adminPhone, isWhatsApp }, "Admin SMS/WhatsApp notification sent");

    // ── Caller confirmation (only for Emergency and Appointment) ──────────
    const callerNumber = log.fromNumber;
    if (callerNumber && callerNumber !== "Anonymous" && (isEmergency || isAppointment)) {
      let callerMsg: string;
      if (isEmergency) {
        callerMsg = `Thank you for calling ${businessName}. We received your request for roadside assistance`;
        if (log.callerLocation) callerMsg += ` at ${log.callerLocation}`;
        callerMsg += `. A technician will be in touch shortly. For urgent help call us back anytime.`;
      } else {
        callerMsg = `Thank you for booking with ${businessName}!`;
        if (log.callSummary) callerMsg += ` ${log.callSummary}`;
        callerMsg += ` If you need to change your appointment please call us back.`;
      }
      callerMsg += `\n\n---\nPowered by CallingAgent — AI-powered call management for businesses. callingagent.ca`;
      const callerTo = isWhatsApp ? `whatsapp:${callerNumber}` : callerNumber;
      await client.messages.create({ body: callerMsg, from: adminFrom, to: callerTo });
      logger.info({ callSid, callerNumber }, "Caller confirmation SMS sent");
    }
  } catch (err: any) {
    logger.warn({ err: err?.message, callSid }, "SMS notification failed — non-fatal");
  }
}

router.post("/twilio/status", async (req, res): Promise<void> => {
  const { CallSid, CallStatus, CallDuration, RecordingUrl, RecordingSid } = req.body;
  req.log.info({ CallSid, CallStatus, CallDuration }, "Twilio status callback");
  try {

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
    }

    // Always write DB first so the notification email reads fresh duration/status/transcript.
    await db.update(callLogsTable)
      .set(updateData)
      .where(eq(callLogsTable.twilioCallSid, CallSid));

    // Fire SMS/WhatsApp notification immediately after DB write (no need to wait for recording)
    if (isTerminal) {
      setImmediate(() => { sendSmsNotificationIfConfigured(CallSid).catch(() => {}); });
    }

    if (isTerminal) {
      if (!RecordingUrl) {
        // No recording in the status callback — poll Twilio until it's ready, then notify.
        const pollForRecording = async () => {
          const delays = [5000, 20000, 60000];
          const client = getTwilioClient();

          // Use the preferred recording SID stored by startCallRecording() if available,
          // so we don't accidentally pick up the short Dial whisper recording.
          const [currentRow] = await db
            .select({ recordingSid: callLogsTable.recordingSid, recordingUrl: callLogsTable.recordingUrl })
            .from(callLogsTable)
            .where(eq(callLogsTable.twilioCallSid, CallSid));

          const preferredSid = currentRow?.recordingSid ?? null;

          for (const delay of delays) {
            await new Promise(r => setTimeout(r, delay));
            try {
              if (preferredSid) {
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
                const recs = await client.recordings.list({ callSid: CallSid, limit: 10 });
                if (recs.length > 0) {
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
          // Polling exhausted — send notification without a recording link so the
          // summary and transcript still reach the user.
          logger.info({ CallSid }, "No recording found after polling — sending notification without recording");
          await sendCallNotificationIfConfigured(CallSid, null);
        };
        setImmediate(() => { pollForRecording().catch(() => {}); });
      } else {
        // Recording URL already in the status callback — DB is already updated above,
        // so the notification will read fresh data including duration and transcript.
        setImmediate(() => {
          sendCallNotificationIfConfigured(CallSid, `${RecordingUrl}.mp3`).catch(() => {});
        });
      }
    }
  }

  res.sendStatus(200);

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack, CallSid, CallStatus }, "Unhandled error in /twilio/status");
    if (!res.headersSent) res.sendStatus(200); // always 200 to Twilio to prevent retries on a broken payload
  }
});

// ─── Recording callback ──────────────────────────────────────────────────────
router.post("/twilio/recording", async (req, res): Promise<void> => {
  const { CallSid, RecordingUrl, RecordingSid, RecordingDuration, TranscriptionText } = req.body;
  req.log.info({ CallSid, RecordingSid, RecordingDuration }, "Twilio recording callback");
  try {

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

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack, CallSid }, "Unhandled error in /twilio/recording");
    if (!res.headersSent) res.sendStatus(200);
  }
});

// ─── SMS webhook ─────────────────────────────────────────────────────────────

router.post("/twilio/sms", async (req, res): Promise<void> => {
  const _smsSid = req.body?.MessageSid;
  try {
  const { MessageSid, From, To, Body, NumMedia, SmsStatus } = req.body;
  req.log.info({ MessageSid, From, To }, "Inbound SMS received");

  // Resolve the phone number row so we can link and get notification email
  let phoneNumberId: number | null = null;
  let notificationEmail: string | null = null;
  let lineName: string | null = null;

  if (To) {
    const [pn] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.number, To));
    if (pn) {
      phoneNumberId = pn.id;
      notificationEmail = pn.notificationEmail ?? null;
      lineName = pn.friendlyName ?? null;
    }
  }

  // Collect media URLs if any
  const mediaUrls: string[] = [];
  const numMedia = parseInt(NumMedia ?? "0", 10);
  for (let i = 0; i < numMedia; i++) {
    const url = req.body[`MediaUrl${i}`];
    if (url) mediaUrls.push(url);
  }

  // Store in DB
  if (MessageSid) {
    await db.insert(smsMessagesTable).values({
      twilioSid: MessageSid,
      phoneNumberId,
      direction: "inbound",
      from: From ?? "",
      to: To ?? "",
      body: Body ?? "",
      status: SmsStatus ?? "received",
      numMedia: numMedia || 0,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : null,
    }).onConflictDoNothing();
  }

  // Send email notification if configured
  if (notificationEmail) {
    const transport = getEmailTransport();
    if (transport) {
      const fromDisplay = formatE164(From);
      const subject = `New SMS — ${fromDisplay}`;
      const now = new Date();
      const mediaAttachments = mediaUrls.length > 0
        ? `<div style="margin-top:16px">
             <p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#94a3b8">Media (${mediaUrls.length})</p>
             <div style="display:flex;gap:8px;flex-wrap:wrap">
               ${mediaUrls.map((u, i) => `<a href="${u}" style="display:inline-block;padding:8px 16px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;font-weight:600;color:#0f172a;text-decoration:none">Attachment ${i + 1}</a>`).join("")}
             </div>
           </div>`
        : "";
      const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

      <!-- Header -->
      <tr><td style="background:#0f172a;border-radius:10px 10px 0 0;padding:24px 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#22c55e">CallingAgent</p>
              <h1 style="margin:4px 0 0;font-size:20px;font-weight:700;color:#f8fafc;letter-spacing:-.3px">New SMS Message</h1>
              ${lineName ? `<p style="margin:4px 0 0;font-size:13px;color:#94a3b8">${lineName}</p>` : ""}
            </td>
            <td align="right" valign="top">
              <span style="display:inline-block;padding:4px 12px;background:#3b82f622;border:1px solid #3b82f655;border-radius:20px;font-size:11px;font-weight:700;color:#60a5fa;letter-spacing:.5px;text-transform:uppercase">SMS</span>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Meta bar -->
      <tr><td style="background:#1e293b;padding:0 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:16px 0;border-right:1px solid #334155;width:50%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">From</p>
              <p style="margin:4px 0 0;font-size:15px;font-weight:700;color:#f1f5f9">${fromDisplay}</p>
            </td>
            <td style="padding:16px 0;padding-left:24px;width:50%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">Received</p>
              <p style="margin:4px 0 0;font-size:14px;font-weight:600;color:#f1f5f9">${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</p>
              <p style="margin:2px 0 0;font-size:11px;color:#64748b">${now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
            </td>
          </tr>
        </table>
      </td></tr>

      <!-- Message body -->
      <tr><td style="background:#ffffff;padding:28px 32px;border-radius:0 0 10px 10px">
        <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#94a3b8">Message</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:18px 20px">
          <p style="margin:0;font-size:15px;line-height:1.7;color:#0f172a">${(Body ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
        </div>

        ${mediaAttachments}

        <div style="margin-top:28px;padding-top:20px;border-top:1px solid #f1f5f9">
          <p style="margin:0;font-size:11px;color:#94a3b8">Sent by <strong style="color:#64748b">CallingAgent</strong>${lineName ? ` &nbsp;&middot;&nbsp; ${lineName} (${To ?? ""})` : ""}</p>
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
      transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
        to: notificationEmail,
        subject,
        html,
      }).catch((err: any) => {
        logger.error({ err: err?.message }, "Failed to send SMS notification email");
      });
    }
  }

  // Respond with empty TwiML so Twilio doesn't auto-reply
  res.setHeader("Content-Type", "text/xml");
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);

  } catch (err: any) {
    req.log.error({ err: err?.message, stack: err?.stack, sid: _smsSid }, "Unhandled error in /twilio/sms");
    if (!res.headersSent) {
      res.setHeader("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    }
  }
});

function formatE164(raw: string | undefined): string {
  if (!raw) return "Unknown";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

// ─── Admin: resend call notification email ───────────────────────────────────
router.post("/twilio/resend-call-email/:callSid", async (req, res): Promise<void> => {
  const { callSid } = req.params;
  await sendCallNotificationIfConfigured(callSid, undefined);
  res.json({ ok: true, callSid });
});

export default router;
