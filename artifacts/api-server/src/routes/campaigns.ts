import { Router, type IRouter } from "express";
import { eq, and, desc, sql, or } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignContactsTable,
  campaignCallLogsTable,
  phoneNumbersTable,
  aiVoiceConfigTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import twilio from "twilio";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";

const router: IRouter = Router();

// In-memory map: twilioCallSid → campaignContactId (for routing status callbacks)
export const outboundCampaignCalls = new Map<string, number>();

// In-memory map: twilioCallSid → campaignCallLogId (for updating the correct log entry)
export const outboundCallLogMap = new Map<string, number>();

// In-memory conversation store for outbound campaign calls
interface OutboundConv {
  contactId: number;
  campaignId: number;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  systemPrompt: string;
  startedAt: number;
  maxDuration: number;
  baseUrl: string;
  voice: string;
  voiceEngine: "google" | "elevenlabs";
  elevenLabsVoiceId: string | null;
}
export const outboundConversations = new Map<string, OutboundConv>();

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
  return twilio(accountSid, authToken);
}

function getChatOpenAI() {
  const directKey = process.env.OPENAI_API_KEY;
  if (directKey) return new OpenAI({ apiKey: directKey });
  return new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
}

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

function getBaseUrl(req: any): string {
  return process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : `${req.protocol}://${req.get("host")}`;
}

function getPublicDomain(): string | null {
  if (process.env.REPLIT_DOMAINS) return `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return null;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const FALLBACK_VOICE = "Google.ar-XA-Neural2-C";

// ─── ElevenLabs TTS cache ─────────────────────────────────────────────────────
const elevenLabsTtsCache = new Map<string, { buffer: Buffer; expiresAt: number }>();

// Prune expired entries on a 5-minute interval
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of elevenLabsTtsCache) {
    if (v.expiresAt < now) elevenLabsTtsCache.delete(k);
  }
}, 5 * 60 * 1000);

async function synthesizeElevenLabs(text: string, voiceId: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not configured");
  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ElevenLabs TTS error ${resp.status}: ${errText}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

async function renderSpeech(
  text: string,
  opts: { voiceEngine: string; elevenLabsVoiceId: string | null; baseUrl: string }
): Promise<string> {
  if (opts.voiceEngine === "elevenlabs" && opts.elevenLabsVoiceId) {
    try {
      const key = randomUUID();
      const buf = await synthesizeElevenLabs(text, opts.elevenLabsVoiceId);
      elevenLabsTtsCache.set(key, { buffer: buf, expiresAt: Date.now() + 120_000 });
      return `<Play>${opts.baseUrl}/api/twilio/campaign-tts/${key}</Play>`;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "ElevenLabs TTS failed, falling back to Google Neural2");
    }
  }
  return `<Say voice="${FALLBACK_VOICE}" language="ar-SA">${escapeXml(text)}</Say>`;
}

async function extractOutboundSummary(messages: Array<{ role: string; content: string }>): Promise<{
  callSummary: string | null;
  interestedInSelling: boolean | null;
  timeline: string | null;
  askingPrice: string | null;
  propertyType: string | null;
  additionalNotes: string | null;
  callOutcome: string;
}> {
  if (messages.length <= 1) {
    return { callSummary: null, interestedInSelling: null, timeline: null, askingPrice: null, propertyType: null, additionalNotes: null, callOutcome: "no_answer" };
  }
  try {
    const openai = getChatOpenAI();
    const transcript = messages.map(m => `${m.role === "user" ? "Owner" : "Agent"}: ${m.content}`).join("\n");
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are analyzing a real estate cold call transcript. Extract the following as JSON only:
{
  "callSummary": "2-3 sentence summary of the conversation",
  "interestedInSelling": true/false/null (null if unknown),
  "timeline": "when they want to sell (e.g. immediately, 3 months, 1 year) or null",
  "askingPrice": "what they expect to sell for or null",
  "propertyType": "house/condo/land/commercial/etc or null",
  "additionalNotes": "any other useful info or null",
  "callOutcome": "interested/not_interested/callback_requested/hung_up/no_answer"
}
IMPORTANT: Use "no_answer" ONLY when the human side produced zero speech (truly unanswered). If the person said anything at all (even just hello), use "hung_up" or "not_interested" as appropriate.
Return JSON only. No explanation.`,
        },
        { role: "user", content: `Transcript:\n\n${transcript}` },
      ],
      max_tokens: 400,
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
    return {
      callSummary: parsed.callSummary ?? null,
      interestedInSelling: parsed.interestedInSelling ?? null,
      timeline: parsed.timeline ?? null,
      askingPrice: parsed.askingPrice ?? null,
      propertyType: parsed.propertyType ?? null,
      additionalNotes: parsed.additionalNotes ?? null,
      callOutcome: parsed.callOutcome ?? "completed",
    };
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Failed to extract outbound call summary");
    return { callSummary: null, interestedInSelling: null, timeline: null, askingPrice: null, propertyType: null, additionalNotes: null, callOutcome: "completed" };
  }
}

async function sendHotLeadEmail(contact: any, campaign: any, summary: any, recordingUrl: string | null, audioBuffer?: Buffer | null) {
  try {
    const transport = getEmailTransport();
    if (!transport || !campaign.notificationEmail) {
      logger.warn({ hasTransport: !!transport, notificationEmail: campaign.notificationEmail }, "Hot lead email skipped — no transport or no recipient");
      return;
    }
    // Verify SMTP connection before sending
    await transport.verify();
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || "";
    const publicDomain = getPublicDomain();
    const recordingLink = recordingUrl && publicDomain
      ? `${publicDomain}/api/campaigns/${campaign.id}/contacts/${contact.id}/recording`
      : recordingUrl;

    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
      <tr><td style="background:#0f172a;border-radius:10px 10px 0 0;padding:24px 32px">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#22c55e">Vanguard.OPS — Hot Lead</p>
        <h1 style="margin:4px 0 0;font-size:22px;font-weight:700;color:#f8fafc">Seller Interested in Listing</h1>
        <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">Campaign: ${escapeXml(campaign.name)}</p>
      </td></tr>
      <tr><td style="background:#1e293b;padding:0 32px">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:16px 0;border-right:1px solid #334155;text-align:center;width:50%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">Contact</p>
              <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#f1f5f9">${escapeXml(contact.name)}</p>
            </td>
            <td style="padding:16px 0;text-align:center;width:50%">
              <p style="margin:0;font-size:10px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#64748b">Phone</p>
              <p style="margin:4px 0 0;font-size:16px;font-weight:700;color:#22c55e">${escapeXml(contact.phone)}</p>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="background:#ffffff;padding:28px 32px;border-radius:0 0 10px 10px">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
          ${contact.address ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;width:140px"><p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Address</p></td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9"><p style="margin:0;font-size:14px;color:#0f172a">${escapeXml(contact.address)}</p></td></tr>` : ""}
          ${summary.propertyType ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9"><p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Property Type</p></td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9"><p style="margin:0;font-size:14px;color:#0f172a">${escapeXml(summary.propertyType)}</p></td></tr>` : ""}
          ${summary.askingPrice ? `<tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9"><p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Asking Price</p></td><td style="padding:8px 0;border-bottom:1px solid #f1f5f9"><p style="margin:0;font-size:14px;font-weight:700;color:#22c55e">${escapeXml(summary.askingPrice)}</p></td></tr>` : ""}
          ${summary.timeline ? `<tr><td style="padding:8px 0"><p style="margin:0;font-size:11px;font-weight:600;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">Timeline</p></td><td style="padding:8px 0"><p style="margin:0;font-size:14px;color:#0f172a">${escapeXml(summary.timeline)}</p></td></tr>` : ""}
        </table>
        ${summary.callSummary ? `<div style="background:#f8f9fa;border-left:3px solid #22c55e;border-radius:0 6px 6px 0;padding:14px 18px;margin:0 0 20px"><p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#22c55e">AI Call Summary</p><p style="margin:0;font-size:14px;line-height:1.6;color:#1a1a1a">${escapeXml(summary.callSummary)}</p>${summary.additionalNotes ? `<p style="margin:10px 0 0;font-size:13px;color:#374151"><strong>Notes:</strong> ${escapeXml(summary.additionalNotes)}</p>` : ""}</div>` : ""}
        ${recordingLink ? `<div style="margin:0 0 20px;text-align:center"><a href="${recordingLink}" style="display:inline-block;padding:12px 32px;background:#22c55e;color:#fff;font-family:sans-serif;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px">&#9654;&nbsp; Listen to Recording</a></div>` : ""}
        <div style="margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9"><p style="margin:0;font-size:11px;color:#94a3b8">Sent by <strong style="color:#64748b">Vanguard.OPS</strong> — Outbound Campaign</p></div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

    const safeName = (contact.name ?? "contact").replace(/[^a-z0-9_-]/gi, "_");
    await transport.sendMail({
      from,
      to: campaign.notificationEmail,
      subject: `Hot Lead — ${contact.name} (${contact.phone}) — Ready to Sell`,
      html,
      attachments: audioBuffer
        ? [{ filename: `call-${safeName}.mp3`, content: audioBuffer, contentType: "audio/mpeg" }]
        : [],
    });
    logger.info({ contactId: contact.id, campaignId: campaign.id, hasAudio: !!audioBuffer }, "Hot lead email sent");
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to send hot lead email");
  }
}

async function initiateOutboundCall(contact: any, campaign: any, fromNumber: string, baseUrl: string) {
  const client = getTwilioClient();
  const callbackUrl = `${baseUrl}/api/twilio/campaign-status`;
  const voiceUrl = `${baseUrl}/api/twilio/campaign-voice?contactId=${contact.id}&campaignId=${campaign.id}`;

  const call = await client.calls.create({
    to: contact.phone,
    from: fromNumber,
    url: voiceUrl,
    statusCallback: callbackUrl,
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    statusCallbackMethod: "POST",
    method: "POST",
    machineDetection: "DetectMessageEnd",
    asyncAmd: "true",
    asyncAmdStatusCallback: `${baseUrl}/api/twilio/campaign-amd?contactId=${contact.id}&campaignId=${campaign.id}`,
    asyncAmdStatusCallbackMethod: "POST",
  });

  // Create a call log entry for this attempt
  const [callLog] = await db.insert(campaignCallLogsTable).values({
    contactId: contact.id,
    campaignId: campaign.id,
    twilioCallSid: call.sid,
    callStatus: "calling",
  }).returning();

  outboundCampaignCalls.set(call.sid, contact.id);
  outboundCallLogMap.set(call.sid, callLog.id);

  await db.update(campaignContactsTable).set({
    callStatus: "calling",
    twilioCallSid: call.sid,
    lastAttemptAt: new Date(),
    attemptCount: (contact.attemptCount ?? 0) + 1,
  }).where(eq(campaignContactsTable.id, contact.id));

  logger.info({ callSid: call.sid, contactId: contact.id, callLogId: callLog.id, to: contact.phone }, "Outbound campaign call initiated");
  return call.sid;
}

// ─── Test email ──────────────────────────────────────────────────────────────
router.post("/campaigns/test-email", async (req, res): Promise<void> => {
  try {
    const transport = getEmailTransport();
    if (!transport) {
      res.status(500).json({ error: "Email not configured — SMTP_HOST, SMTP_USER, SMTP_PASS must be set" });
      return;
    }
    const to = req.body?.to || process.env.SMTP_FROM || process.env.SMTP_USER;
    if (!to) { res.status(400).json({ error: "No recipient — pass { to: 'email@example.com' } or set SMTP_FROM" }); return; }

    // Verify SMTP connection
    await transport.verify();
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
      to,
      subject: "Vanguard.OPS — Email Test",
      html: `<p style="font-family:sans-serif">This is a test email from <strong>Vanguard.OPS</strong>. If you received this, hot lead notifications are working correctly.</p>`,
    });
    logger.info({ to }, "Test email sent");
    res.json({ ok: true, sentTo: to });
  } catch (err: any) {
    logger.error({ err: err?.message, stack: err?.stack }, "Test email failed");
    res.status(500).json({ error: err?.message ?? "Unknown error" });
  }
});

// ─── List campaigns ──────────────────────────────────────────────────────────
router.get("/campaigns", async (req, res): Promise<void> => {
  try {
    const phoneNumberId = req.query.phoneNumberId ? parseInt(req.query.phoneNumberId as string, 10) : null;
    const campaigns = phoneNumberId
      ? await db.select().from(campaignsTable).where(eq(campaignsTable.fromPhoneNumberId, phoneNumberId)).orderBy(desc(campaignsTable.createdAt))
      : await db.select().from(campaignsTable).orderBy(desc(campaignsTable.createdAt));
    const counts = await db
      .select({
        campaignId: campaignContactsTable.campaignId,
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${campaignContactsTable.callStatus} = 'pending')::int`,
        completed: sql<number>`count(*) filter (where ${campaignContactsTable.callStatus} = 'completed')::int`,
        interested: sql<number>`count(*) filter (where ${campaignContactsTable.interestedInSelling} = true)::int`,
      })
      .from(campaignContactsTable)
      .groupBy(campaignContactsTable.campaignId);

    const countMap = new Map(counts.map(c => [c.campaignId, c]));
    const result = campaigns.map(c => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      totalContacts: countMap.get(c.id)?.total ?? 0,
      pendingContacts: countMap.get(c.id)?.pending ?? 0,
      completedContacts: countMap.get(c.id)?.completed ?? 0,
      interestedContacts: countMap.get(c.id)?.interested ?? 0,
    }));
    res.json(result);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list campaigns");
    res.status(500).json({ error: "Failed to list campaigns" });
  }
});

// ─── Create campaign ─────────────────────────────────────────────────────────
router.post("/campaigns", async (req, res): Promise<void> => {
  try {
    const { name, script, systemPrompt, fromPhoneNumberId, notificationEmail, maxCallDuration } = req.body;
    if (!name || !script) { res.status(400).json({ error: "name and script are required" }); return; }
    const [campaign] = await db.insert(campaignsTable).values({
      name, script, systemPrompt: systemPrompt ?? null,
      fromPhoneNumberId: fromPhoneNumberId ?? null,
      notificationEmail: notificationEmail ?? null,
      maxCallDuration: maxCallDuration ?? 300,
      status: "draft",
    }).returning();
    res.status(201).json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString(), totalContacts: 0, pendingContacts: 0, completedContacts: 0, interestedContacts: 0 });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to create campaign");
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// ─── Get campaign ────────────────────────────────────────────────────────────
// ─── Calendar events (callbacks + hot leads) ──────────────────────────────────
router.get("/campaigns/stats", async (req, res): Promise<void> => {
  try {
    const [totalRows, notInterestedRows] = await Promise.all([
      db
        .select({
          id: campaignContactsTable.id,
          name: campaignContactsTable.name,
          phone: campaignContactsTable.phone,
          callOutcome: campaignContactsTable.callOutcome,
          lastAttemptAt: campaignContactsTable.lastAttemptAt,
          campaignName: campaignsTable.name,
        })
        .from(campaignContactsTable)
        .innerJoin(campaignsTable, eq(campaignContactsTable.campaignId, campaignsTable.id))
        .where(eq(campaignContactsTable.callStatus, "completed"))
        .orderBy(desc(campaignContactsTable.lastAttemptAt)),
      db
        .select({
          id: campaignContactsTable.id,
          name: campaignContactsTable.name,
          phone: campaignContactsTable.phone,
          callOutcome: campaignContactsTable.callOutcome,
          lastAttemptAt: campaignContactsTable.lastAttemptAt,
          campaignName: campaignsTable.name,
        })
        .from(campaignContactsTable)
        .innerJoin(campaignsTable, eq(campaignContactsTable.campaignId, campaignsTable.id))
        .where(eq(campaignContactsTable.callOutcome, "not_interested"))
        .orderBy(desc(campaignContactsTable.lastAttemptAt)),
    ]);
    res.json({
      totalCalls: totalRows.map(r => ({ ...r, lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null })),
      notInterested: notInterestedRows.map(r => ({ ...r, lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null })),
    });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "Failed to get campaign stats");
    res.status(500).json({ error: "Failed to get campaign stats" });
  }
});

router.get("/campaigns/calendar", async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: campaignContactsTable.id,
        campaignId: campaignContactsTable.campaignId,
        campaignName: campaignsTable.name,
        name: campaignContactsTable.name,
        phone: campaignContactsTable.phone,
        callOutcome: campaignContactsTable.callOutcome,
        callSummary: campaignContactsTable.callSummary,
        callbackAt: campaignContactsTable.callbackAt,
        calendarNotes: campaignContactsTable.calendarNotes,
        lastAttemptAt: campaignContactsTable.lastAttemptAt,
        recordingUrl: campaignContactsTable.recordingUrl,
        recordingSid: campaignContactsTable.recordingSid,
      })
      .from(campaignContactsTable)
      .innerJoin(campaignsTable, eq(campaignContactsTable.campaignId, campaignsTable.id))
      .where(
        or(
          eq(campaignContactsTable.callOutcome, "callback_requested"),
          eq(campaignContactsTable.callOutcome, "hot_lead"),
          eq(campaignContactsTable.callOutcome, "interested"),
        )
      )
      .orderBy(desc(campaignContactsTable.lastAttemptAt));

    res.json(rows.map(r => ({
      id: r.id,
      campaignId: r.campaignId,
      campaignName: r.campaignName,
      name: r.name,
      phone: r.phone,
      callOutcome: r.callOutcome,
      callSummary: r.callSummary,
      eventType: (r.callOutcome === "hot_lead" || r.callOutcome === "interested") ? "hot_lead" : "callback",
      callbackAt: r.callbackAt?.toISOString() ?? null,
      calendarNotes: r.calendarNotes ?? null,
      lastAttemptAt: r.lastAttemptAt?.toISOString() ?? null,
      hasRecording: !!(r.recordingUrl || r.recordingSid),
    })));
  } catch (err: any) {
    req.log.error({ err: err?.message }, "Failed to get calendar events");
    res.status(500).json({ error: "Failed to get calendar events" });
  }
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${campaignContactsTable.callStatus} = 'pending')::int`,
        completed: sql<number>`count(*) filter (where ${campaignContactsTable.callStatus} = 'completed')::int`,
        interested: sql<number>`count(*) filter (where ${campaignContactsTable.interestedInSelling} = true)::int`,
      })
      .from(campaignContactsTable)
      .where(eq(campaignContactsTable.campaignId, id));
    res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString(), totalContacts: counts?.total ?? 0, pendingContacts: counts?.pending ?? 0, completedContacts: counts?.completed ?? 0, interestedContacts: counts?.interested ?? 0 });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to get campaign" });
  }
});

// ─── Update campaign ─────────────────────────────────────────────────────────
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, script, systemPrompt, fromPhoneNumberId, notificationEmail, status, maxCallDuration, maxConcurrentCalls, scheduleConfig } = req.body;
    const updateData: any = {};
    if (name != null) updateData.name = name;
    if (script != null) updateData.script = script;
    if (systemPrompt !== undefined) updateData.systemPrompt = systemPrompt;
    if (fromPhoneNumberId !== undefined) updateData.fromPhoneNumberId = fromPhoneNumberId;
    if (notificationEmail !== undefined) updateData.notificationEmail = notificationEmail;
    if (status != null) updateData.status = status;
    if (maxCallDuration != null) updateData.maxCallDuration = maxCallDuration;
    if (maxConcurrentCalls != null) updateData.maxConcurrentCalls = maxConcurrentCalls;
    if (scheduleConfig !== undefined) updateData.scheduleConfig = scheduleConfig;
    const [campaign] = await db.update(campaignsTable).set(updateData).where(eq(campaignsTable.id, id)).returning();
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ ...campaign, createdAt: campaign.createdAt.toISOString(), updatedAt: campaign.updatedAt.toISOString() });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

// ─── Delete campaign ─────────────────────────────────────────────────────────
router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(campaignContactsTable).where(eq(campaignContactsTable.campaignId, id));
    await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// ─── List contacts ───────────────────────────────────────────────────────────
router.get("/campaigns/:id/contacts", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const contacts = await db.select().from(campaignContactsTable)
      .where(eq(campaignContactsTable.campaignId, id))
      .orderBy(campaignContactsTable.createdAt);
    res.json(contacts.map(c => ({ ...c, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString(), lastAttemptAt: c.lastAttemptAt?.toISOString() ?? null, callbackAt: c.callbackAt?.toISOString() ?? null, scheduledCallAt: c.scheduledCallAt?.toISOString() ?? null })));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to list contacts" });
  }
});

// ─── Add single contact ───────────────────────────────────────────────────────
router.post("/campaigns/:id/contacts", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, phone, address } = req.body;
    if (!name || !phone) { res.status(400).json({ error: "name and phone are required" }); return; }
    const [contact] = await db.insert(campaignContactsTable).values({ campaignId: id, name, phone, address: address ?? null }).returning();
    res.status(201).json({ ...contact, createdAt: contact.createdAt.toISOString(), updatedAt: contact.updatedAt.toISOString(), lastAttemptAt: null });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to add contact" });
  }
});

// ─── Bulk import contacts ─────────────────────────────────────────────────────
router.post("/campaigns/:id/contacts/import", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: "text is required" }); return; }

    const lines = text.split("\n").map((l: string) => l.trim()).filter((l: string) => l.length > 0);
    let imported = 0;
    let skipped = 0;

    const looksLikePhone = (s: string) => s.replace(/\D/g, "").length >= 7;

    for (const line of lines) {
      const parts = line.split(/[,|\t]/).map((p: string) => p.trim()).filter((p: string) => p.length > 0);
      if (parts.length === 0) { skipped++; continue; }

      // If every part on this line looks like a phone number, treat each as its own contact
      if (parts.every(looksLikePhone)) {
        for (const p of parts) {
          try {
            await db.insert(campaignContactsTable).values({ campaignId: id, name: p, phone: p, address: null }).onConflictDoNothing();
            imported++;
          } catch {
            skipped++;
          }
        }
        continue;
      }

      // Standard format: Name, Phone[, Address]
      const name = parts[0];
      const phone = parts[1];
      const address = parts[2] ?? null;
      if (!name || !phone) { skipped++; continue; }
      try {
        await db.insert(campaignContactsTable).values({ campaignId: id, name, phone, address }).onConflictDoNothing();
        imported++;
      } catch {
        skipped++;
      }
    }
    res.json({ imported, skipped });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to import contacts" });
  }
});

// ─── Update contact ───────────────────────────────────────────────────────────
router.patch("/campaigns/:id/contacts/:contactId", async (req, res): Promise<void> => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    const { name, phone, address, callbackAt, calendarNotes, userNotes, scheduledCallAt, callStatus } = req.body;
    const updateData: any = {};
    if (name != null) updateData.name = name;
    if (phone != null) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (callbackAt !== undefined) updateData.callbackAt = callbackAt ? new Date(callbackAt) : null;
    if (calendarNotes !== undefined) updateData.calendarNotes = calendarNotes;
    if (userNotes !== undefined) updateData.userNotes = userNotes ?? null;
    if (scheduledCallAt !== undefined) updateData.scheduledCallAt = scheduledCallAt ? new Date(scheduledCallAt) : null;
    // Allow skip / unskip (reset to pending)
    if (callStatus === "skipped" || callStatus === "pending") updateData.callStatus = callStatus;
    const [contact] = await db.update(campaignContactsTable).set(updateData).where(eq(campaignContactsTable.id, contactId)).returning();
    if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }
    res.json({
      ...contact,
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
      lastAttemptAt: contact.lastAttemptAt?.toISOString() ?? null,
      callbackAt: contact.callbackAt?.toISOString() ?? null,
      scheduledCallAt: contact.scheduledCallAt?.toISOString() ?? null,
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update contact" });
  }
});

// ─── Delete contact ───────────────────────────────────────────────────────────
router.delete("/campaigns/:id/contacts/:contactId", async (req, res): Promise<void> => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    await db.delete(campaignContactsTable).where(eq(campaignContactsTable.id, contactId));
    res.sendStatus(204);
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

// ─── Fire due contacts up to concurrent limit ─────────────────────────────────
// Picks pending contacts whose scheduledCallAt is null or in the past, respects maxConcurrentCalls.
// If campaign has a schedule window, contacts with no specific scheduledCallAt only fire inside that window.
async function fireDueContacts(campaign: any, fromNumber: string, baseUrl: string): Promise<number> {
  const maxConcurrent = campaign.maxConcurrentCalls ?? 1;
  const now = new Date();

  // Determine if this campaign is restricted to a schedule window
  let scheduleRestricted = false;
  let withinWindow = false;
  if (campaign.scheduleConfig) {
    try {
      const cfg: CampaignScheduleConfig = JSON.parse(campaign.scheduleConfig);
      if (cfg.enabled && cfg.slots?.length) {
        scheduleRestricted = true;
        withinWindow = isWithinScheduleWindow(cfg);
      }
    } catch { /* ignore */ }
  }

  // Count currently in-flight calls
  const [countRow] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(campaignContactsTable)
    .where(and(
      eq(campaignContactsTable.campaignId, campaign.id),
      sql`${campaignContactsTable.callStatus} IN ('calling', 'in_progress')`,
    ));
  const calling = countRow?.cnt ?? 0;
  const slots = maxConcurrent - calling;
  if (slots <= 0) return 0;

  // Find due pending contacts:
  // - Contacts with a specific scheduledCallAt in the past always fire (explicit override)
  // - Contacts with no scheduledCallAt only fire if there's no schedule restriction OR we're inside the window
  const noSchedCondition = scheduleRestricted
    ? (withinWindow ? sql`${campaignContactsTable.scheduledCallAt} IS NULL` : sql`false`)
    : sql`${campaignContactsTable.scheduledCallAt} IS NULL`;

  const due = await db.select().from(campaignContactsTable)
    .where(and(
      eq(campaignContactsTable.campaignId, campaign.id),
      eq(campaignContactsTable.callStatus, "pending"),
      sql`(${noSchedCondition} OR ${campaignContactsTable.scheduledCallAt} <= ${now})`,
    ))
    .limit(slots);

  let fired = 0;
  for (const contact of due) {
    try {
      await initiateOutboundCall(contact, campaign, fromNumber, baseUrl);
      fired++;
      await new Promise(r => setTimeout(r, 500));
    } catch (err: any) {
      logger.error({ err: err?.message, contactId: contact.id }, "fireDueContacts: call failed");
      await db.update(campaignContactsTable).set({ callStatus: "failed" }).where(eq(campaignContactsTable.id, contact.id));
    }
  }
  return fired;
}

// Check if all contacts are done (pending = 0 AND no in-flight calls)
async function checkCampaignComplete(campaignId: number): Promise<void> {
  const [row] = await db
    .select({ cnt: sql<number>`count(*) filter (where ${campaignContactsTable.callStatus} IN ('pending', 'calling', 'in_progress'))::int` })
    .from(campaignContactsTable)
    .where(eq(campaignContactsTable.campaignId, campaignId));
  if ((row?.cnt ?? 1) === 0) {
    await db.update(campaignsTable).set({ status: "completed" }).where(eq(campaignsTable.id, campaignId));
    logger.info({ campaignId }, "Campaign completed — all contacts dialed");
  }
}

// ─── Start campaign ───────────────────────────────────────────────────────────
router.post("/campaigns/:id/start", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    let fromNumber = "";
    if (campaign.fromPhoneNumberId) {
      const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, campaign.fromPhoneNumberId));
      fromNumber = pn?.number ?? "";
    }
    if (!fromNumber) { res.status(400).json({ error: "No phone number configured for this campaign" }); return; }

    await db.update(campaignsTable).set({ status: "active" }).where(eq(campaignsTable.id, id));

    const baseUrl = getBaseUrl(req);
    const queued = await fireDueContacts(campaign, fromNumber, baseUrl);

    // If nothing was fired, check if all done (all contacts may be scheduled in the future or skipped)
    if (queued === 0) {
      await checkCampaignComplete(id);
    }

    res.json({ queued });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to start campaign");
    res.status(500).json({ error: "Failed to start campaign" });
  }
});

// ─── Test call ────────────────────────────────────────────────────────────────
router.post("/campaigns/:id/test-call", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    const { toNumber } = req.body;
    if (!toNumber) { res.status(400).json({ error: "toNumber is required" }); return; }

    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    if (!campaign.fromPhoneNumberId) { res.status(400).json({ error: "No phone number configured for this campaign" }); return; }

    const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, campaign.fromPhoneNumberId));
    if (!pn?.number) { res.status(400).json({ error: "Phone number not found" }); return; }

    const client = getTwilioClient();
    const baseUrl = getBaseUrl(req);

    const call = await client.calls.create({
      to: toNumber,
      from: pn.number,
      url: `${baseUrl}/api/twilio/campaign-test-voice?campaignId=${id}`,
      statusCallback: `${baseUrl}/api/twilio/campaign-status`,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
      method: "POST",
    });

    logger.info({ callSid: call.sid, campaignId: id, to: toNumber }, "Test call initiated");
    res.json({ callSid: call.sid });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to initiate test call");
    res.status(500).json({ error: err?.message ?? "Failed to initiate test call" });
  }
});

// ─── Test call voice webhook ──────────────────────────────────────────────────
router.post("/twilio/campaign-test-voice", async (req, res): Promise<void> => {
  const { CallSid } = req.body;
  const { campaignId } = req.query as Record<string, string>;
  const baseUrl = getBaseUrl(req);
  try {
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, parseInt(campaignId, 10)));
    if (!campaign) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Campaign not found.</Say><Hangup/></Response>`);
      return;
    }

    const [voiceConfig] = await db.select().from(aiVoiceConfigTable);
    const voiceEngine = (voiceConfig?.campaignVoiceEngine ?? "google") as "google" | "elevenlabs";
    const elevenLabsVoiceId = voiceConfig?.elevenLabsVoiceId ?? null;

    const DEFAULT_SYSTEM_PROMPT = `You are a professional outbound calling agent. Introduce yourself, explain the purpose of the call, and have a natural conversation. Be warm, brief, and human. Never sound robotic.`;
    // script field is always behavioral instructions — never text to read aloud
    const systemPrompt = campaign.systemPrompt?.trim() || campaign.script?.trim() || DEFAULT_SYSTEM_PROMPT;

    const engineOpts = { voiceEngine, elevenLabsVoiceId, baseUrl };
    let greetingText = "مرحبا، كيف حالك؟";

    try {
      const openai = getChatOpenAI();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.85,
        messages: [
          { role: "system", content: systemPrompt + `

--- LIVE CALL SYSTEM RULES (internal — do NOT speak these aloud) ---
You are now on a live phone call. Deliver ONE short, natural opening sentence only.
Do NOT recite, quote, or summarize any instructions above — understand them and act on them.
Do NOT read any script verbatim. Sound like a real person, not a robot.
No lists, no numbered points. Speak naturally in the language specified above.` },
          { role: "user", content: "[call connected — say your opening line]" },
        ],
        max_tokens: 60,
      });
      greetingText = completion.choices[0]?.message?.content ?? greetingText;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Test call: AI greeting failed, using fallback");
    }

    // Store conversation (contactId: null for test calls)
    outboundConversations.set(CallSid, {
      contactId: null as any,
      campaignId: campaign.id,
      messages: [{ role: "assistant", content: greetingText }],
      systemPrompt,
      startedAt: Date.now(),
      maxDuration: campaign.maxCallDuration ?? 180,
      baseUrl,
      voice: "Google.ar-XA-Neural2-C",
      voiceEngine,
      elevenLabsVoiceId,
    });

    const greetingBlock = await renderSpeech(greetingText, engineOpts);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greetingBlock}
  <Gather input="speech" timeout="10" speechTimeout="auto" language="ar-SA" action="${baseUrl}/api/twilio/campaign-gather" method="POST">
  </Gather>
  <Say voice="${FALLBACK_VOICE}" language="ar-SA">لم أسمعك. شكراً لك وإلى اللقاء.</Say>
  <Hangup/>
</Response>`);
  } catch (err: any) {
    logger.error({ err: err?.message, CallSid }, "Error in campaign-test-voice");
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>An error occurred.</Say><Hangup/></Response>`);
  }
});

// ─── Pause campaign ───────────────────────────────────────────────────────────
router.post("/campaigns/:id/pause", async (req, res): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to pause campaign" });
  }
});

// ─── Call single contact manually ────────────────────────────────────────────
router.post("/campaigns/:id/contacts/:contactId/call", async (req, res): Promise<void> => {
  try {
    const campaignId = parseInt(req.params.id, 10);
    const contactId = parseInt(req.params.contactId, 10);
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    const [contact] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, contactId));
    if (!contact) { res.status(404).json({ error: "Contact not found" }); return; }

    let fromNumber = "";
    if (campaign.fromPhoneNumberId) {
      const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, campaign.fromPhoneNumberId));
      fromNumber = pn?.number ?? "";
    }
    if (!fromNumber) { res.status(400).json({ error: "No phone number configured for this campaign" }); return; }

    const baseUrl = getBaseUrl(req);
    await initiateOutboundCall(contact, campaign, fromNumber, baseUrl);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to manually call contact");
    res.status(500).json({ error: "Failed to call contact" });
  }
});

// ─── Call logs for a contact ─────────────────────────────────────────────────
router.get("/campaigns/:id/contacts/:contactId/call-logs", async (req, res): Promise<void> => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    const logs = await db.select().from(campaignCallLogsTable)
      .where(eq(campaignCallLogsTable.contactId, contactId))
      .orderBy(desc(campaignCallLogsTable.calledAt));
    res.json(logs.map(l => ({ ...l, calledAt: l.calledAt.toISOString() })));
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch call logs" });
  }
});

// ─── Delete a specific call log entry ────────────────────────────────────────
router.delete("/campaigns/:id/call-logs/:logId", async (req, res): Promise<void> => {
  try {
    const logId = parseInt(req.params.logId, 10);
    const [log] = await db.select().from(campaignCallLogsTable).where(eq(campaignCallLogsTable.id, logId));
    if (!log) { res.status(404).json({ error: "Call log not found" }); return; }
    await db.delete(campaignCallLogsTable).where(eq(campaignCallLogsTable.id, logId));
    // Decrement attempt_count on the contact
    await db.update(campaignContactsTable)
      .set({ attemptCount: sql`GREATEST(COALESCE(attempt_count, 1) - 1, 0)` })
      .where(eq(campaignContactsTable.id, log.contactId));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to delete call log" });
  }
});

// ─── Recording proxy for a specific call log ─────────────────────────────────
router.get("/campaigns/:id/call-logs/:logId/recording", async (req, res): Promise<void> => {
  try {
    const logId = parseInt(req.params.logId, 10);
    const [log] = await db.select().from(campaignCallLogsTable).where(eq(campaignCallLogsTable.id, logId));
    if (!log?.recordingUrl && !log?.recordingSid) { res.status(404).send("No recording available"); return; }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) { res.status(500).send("Twilio not configured"); return; }

    const url = log.recordingUrl ?? `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${log.recordingSid}.mp3`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const response = await fetch(url, { headers: { Authorization: `Basic ${credentials}` }, redirect: "manual" });

    let audioResponse: Response;
    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const location = response.headers.get("Location");
      if (!location) { res.status(502).send("Invalid redirect from Twilio"); return; }
      audioResponse = await fetch(location);
    } else {
      audioResponse = response;
    }
    if (!audioResponse.ok) { res.status(audioResponse.status).send("Recording not available"); return; }
    res.set("Content-Type", audioResponse.headers.get("Content-Type") || "audio/mpeg");
    res.set("Cache-Control", "no-store");
    if (req.query.download) res.set("Content-Disposition", `attachment; filename="call-${logId}.mp3"`);
    res.send(Buffer.from(await audioResponse.arrayBuffer()));
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to fetch call log recording");
    res.status(500).send("Failed to fetch recording");
  }
});

// ─── Recording proxy for campaign contacts (latest recording) ─────────────────
router.get("/campaigns/:id/contacts/:contactId/recording", async (req, res): Promise<void> => {
  try {
    const contactId = parseInt(req.params.contactId, 10);
    const [contact] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, contactId));
    if (!contact?.recordingUrl && !contact?.recordingSid) { res.status(404).send("No recording available"); return; }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) { res.status(500).send("Twilio not configured"); return; }

    const url = contact.recordingUrl ?? `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${contact.recordingSid}.mp3`;
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    // Fetch with manual redirect handling — Twilio redirects to CDN and the auth
    // header must NOT be forwarded to the CDN or it returns 400.
    const response = await fetch(url, {
      headers: { Authorization: `Basic ${credentials}` },
      redirect: "manual",
    });

    let audioResponse: Response;
    if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
      const location = response.headers.get("Location");
      if (!location) { res.status(502).send("Invalid redirect from Twilio"); return; }
      audioResponse = await fetch(location); // no auth header for CDN
    } else {
      audioResponse = response;
    }

    if (!audioResponse.ok) { res.status(audioResponse.status).send("Recording not available"); return; }

    res.set("Content-Type", audioResponse.headers.get("Content-Type") || "audio/mpeg");
    res.set("Cache-Control", "no-store");
    const buffer = Buffer.from(await audioResponse.arrayBuffer());
    res.send(buffer);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to fetch campaign recording");
    res.status(500).send("Failed to fetch recording");
  }
});

// ─── Twilio: outbound campaign voice webhook ──────────────────────────────────
router.post("/twilio/campaign-voice", async (req, res): Promise<void> => {
  const { CallSid, AnsweredBy } = req.body;
  const { contactId, campaignId } = req.query as Record<string, string>;
  const baseUrl = getBaseUrl(req);
  try {
    const [contact] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, parseInt(contactId, 10)));
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, parseInt(campaignId, 10)));

    if (!contact || !campaign) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }

    // Fetch voice engine config (non-fatal if missing)
    const [voiceConfig] = await db.select().from(aiVoiceConfigTable);
    const voiceEngine = (voiceConfig?.campaignVoiceEngine ?? "google") as "google" | "elevenlabs";
    const elevenLabsVoiceId = voiceConfig?.elevenLabsVoiceId ?? null;

    // If AMD detected a machine, leave a short AI voicemail — never read the script verbatim
    if (AnsweredBy === "machine_start" || AnsweredBy === "fax") {
      await db.update(campaignContactsTable).set({ callStatus: "completed", callOutcome: "voicemail" }).where(eq(campaignContactsTable.id, contact.id));
      const vmSystemPrompt = campaign.systemPrompt?.trim() || campaign.script?.trim() || `You are a professional calling agent.`;
      let vmMessage = "مرحبا، هذه رسالة من فريقنا. يرجى التواصل معنا. شكراً.";
      try {
        const openai = getChatOpenAI();
        const vmCompletion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            { role: "system", content: vmSystemPrompt + `

--- VOICEMAIL RULES (internal — do NOT say these aloud) ---
You reached voicemail. Leave ONE short, natural voicemail message (1-2 sentences max).
Do NOT read any script verbatim. Do NOT recite instructions.
Sound warm and human. Use the language specified in the instructions above.` },
            { role: "user", content: "[voicemail beep — leave your message now]" },
          ],
          max_tokens: 60,
        });
        vmMessage = vmCompletion.choices[0]?.message?.content ?? vmMessage;
      } catch {
        // fallback to default message
      }
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${FALLBACK_VOICE}" language="ar-SA">${escapeXml(vmMessage)}</Say><Hangup/></Response>`);
      return;
    }

    outboundCampaignCalls.set(CallSid, contact.id);

    const DEFAULT_SYSTEM_PROMPT = `You are a professional outbound calling agent. Introduce yourself, explain the purpose of the call, and have a natural conversation. Be warm, brief, and human. Never sound robotic.`;

    // Always AI mode — systemPrompt takes priority, then script content as instructions, then default
    const systemPrompt = campaign.systemPrompt?.trim() || campaign.script?.trim() || DEFAULT_SYSTEM_PROMPT;

    // Start recording in background
    setImmediate(async () => {
      try {
        const client = getTwilioClient();
        const rec = await client.calls(CallSid).recordings.create({
          recordingStatusCallback: `${baseUrl}/api/twilio/campaign-recording`,
          recordingStatusCallbackMethod: "POST",
        });
        await db.update(campaignContactsTable).set({ recordingSid: rec.sid }).where(eq(campaignContactsTable.id, contact.id));
      } catch (err: any) {
        logger.warn({ err: err?.message, CallSid }, "Failed to start campaign call recording");
      }
    });

    // AI always generates the opening — script/systemPrompt are treated as behavioral instructions, never read aloud
    let aiGreeting = "مرحبا، كيف حالك؟";
    try {
      const openai = getChatOpenAI();
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0.85,
        messages: [
          { role: "system", content: systemPrompt + `

--- LIVE CALL SYSTEM RULES (internal — do NOT speak these aloud) ---
You are now on a live phone call. Deliver ONE short, natural opening sentence.
Do NOT recite, quote, or summarize any instructions above — understand them and act on them.
Do NOT sound scripted or robotic. Sound like a real person making a real call.
No lists, no numbered points, no formal language. Speak naturally.
Use the language specified in the instructions above.` },
          { role: "user", content: "[call connected — say your opening line]" },
        ],
        max_tokens: 60,
      });
      aiGreeting = completion.choices[0]?.message?.content ?? aiGreeting;
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to generate AI opening, using fallback");
    }

    const engineOpts = { voiceEngine, elevenLabsVoiceId, baseUrl };
    outboundConversations.set(CallSid, {
      contactId: contact.id,
      campaignId: campaign.id,
      messages: [{ role: "assistant", content: aiGreeting }],
      systemPrompt,
      startedAt: Date.now(),
      maxDuration: campaign.maxCallDuration ?? 300,
      baseUrl,
      voice: "Google.ar-XA-Neural2-C",
      voiceEngine,
      elevenLabsVoiceId,
    });

    const greetingBlock = await renderSpeech(aiGreeting, engineOpts);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greetingBlock}
  <Gather input="speech" timeout="10" speechTimeout="auto" language="ar-SA" action="${baseUrl}/api/twilio/campaign-gather" method="POST">
  </Gather>
  <Say voice="${FALLBACK_VOICE}" language="ar-SA">لم أسمعك. شكراً لك وإلى اللقاء.</Say>
  <Hangup/>
</Response>`);
  } catch (err: any) {
    logger.error({ err: err?.message, CallSid }, "Error in campaign voice webhook");
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }
});

// ─── ElevenLabs TTS audio serve endpoint ─────────────────────────────────────
router.get("/twilio/campaign-tts/:key", (req, res): void => {
  const entry = elevenLabsTtsCache.get(req.params.key);
  if (!entry || entry.expiresAt < Date.now()) {
    res.status(404).send("Not found or expired");
    return;
  }
  res.set("Content-Type", "audio/mpeg");
  res.set("Content-Length", String(entry.buffer.length));
  res.set("Cache-Control", "no-store");
  res.send(entry.buffer);
});

// ─── AMD callback ─────────────────────────────────────────────────────────────
router.post("/twilio/campaign-amd", async (req, res): Promise<void> => {
  const { CallSid, AnsweredBy } = req.body;
  const { contactId } = req.query as Record<string, string>;
  logger.info({ CallSid, AnsweredBy, contactId }, "Campaign AMD callback");
  if (AnsweredBy === "machine_end_beep" || AnsweredBy === "machine_end_silence") {
    try {
      const client = getTwilioClient();
      await client.calls(CallSid).update({ twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>` });
    } catch {}
  }
  res.sendStatus(200);
});

// ─── Twilio: outbound campaign gather (AI response) ───────────────────────────
router.post("/twilio/campaign-gather", async (req, res): Promise<void> => {
  const { CallSid, SpeechResult } = req.body;
  const baseUrl = getBaseUrl(req);
  try {
    const conv = outboundConversations.get(CallSid);
    if (!conv) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${FALLBACK_VOICE}" language="ar-SA">شكراً لك. إلى اللقاء.</Say><Hangup/></Response>`);
      return;
    }

    const elapsed = (Date.now() - conv.startedAt) / 1000;
    if (elapsed > conv.maxDuration) {
      outboundConversations.delete(CallSid);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${FALLBACK_VOICE}" language="ar-SA">شكراً لوقتك. إلى اللقاء.</Say><Hangup/></Response>`);
      return;
    }

    if (!SpeechResult) {
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${FALLBACK_VOICE}" language="ar-SA">عذراً، لم أسمعك. هل يمكنك الإعادة؟</Say>
  <Gather input="speech" timeout="10" speechTimeout="auto" language="ar-SA" action="${baseUrl}/api/twilio/campaign-gather" method="POST">
  </Gather>
  <Hangup/>
</Response>`);
      return;
    }

    conv.messages.push({ role: "user", content: SpeechResult });

    const openai = getChatOpenAI();
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.85,
      messages: [
        { role: "system", content: conv.systemPrompt + `

--- LIVE CALL SYSTEM RULES (internal — do NOT speak these aloud) ---
You are mid-conversation on a live phone call. CRITICAL:
- Reply in 1-2 short sentences MAXIMUM. Shorter = better. Think how a real person talks on the phone.
- Do NOT re-introduce yourself. Do NOT repeat what you've already said. Do NOT quote any instructions.
- Sound warm, natural, human. No lists, no bullet points, no formal phrasing.
- No punctuation that sounds unnatural when spoken (no colons mid-sentence, no asterisks, no parentheses).
- Respond in the language the caller is using or as specified in the instructions.
- If the call is clearly done, wrap up warmly in one sentence.` },
        ...conv.messages,
      ],
      max_tokens: 80,
    });

    const aiText = completion.choices[0]?.message?.content ?? "شكراً لك.";
    conv.messages.push({ role: "assistant", content: aiText });

    const engineOpts = { voiceEngine: conv.voiceEngine, elevenLabsVoiceId: conv.elevenLabsVoiceId, baseUrl };
    const endPhrases = ["إلى اللقاء", "وداعاً", "مع السلامة", "شكراً لك", "شكراً جزيلاً"];
    const wantsToEnd = endPhrases.some(p => aiText.includes(p)) && conv.messages.length > 6;

    if (wantsToEnd) {
      outboundConversations.delete(CallSid);
      const speechBlock = await renderSpeech(aiText, engineOpts);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speechBlock}
  <Hangup/>
</Response>`);
      return;
    }

    const speechBlock = await renderSpeech(aiText, engineOpts);
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${speechBlock}
  <Gather input="speech" timeout="10" speechTimeout="auto" language="ar-SA" action="${baseUrl}/api/twilio/campaign-gather" method="POST">
  </Gather>
  <Say voice="${FALLBACK_VOICE}" language="ar-SA">شكراً لك. إلى اللقاء.</Say>
  <Hangup/>
</Response>`);
  } catch (err: any) {
    logger.error({ err: err?.message, CallSid }, "Error in campaign gather");
    res.set("Content-Type", "text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${FALLBACK_VOICE}" language="ar-SA">عذراً، حدث خطأ تقني. شكراً لك.</Say><Hangup/></Response>`);
  }
});

// ─── Twilio: campaign call status callback ────────────────────────────────────
router.post("/twilio/campaign-status", async (req, res): Promise<void> => {
  const { CallSid, CallStatus, CallDuration } = req.body;
  try {
    let contactId = outboundCampaignCalls.get(CallSid);
    let callLogId = outboundCallLogMap.get(CallSid);

    // If in-memory maps were wiped (server restart mid-call), fall back to DB lookup
    if (!contactId) {
      const [dbLog] = await db.select().from(campaignCallLogsTable).where(eq(campaignCallLogsTable.twilioCallSid, CallSid));
      if (!dbLog) { res.sendStatus(200); return; }
      contactId = dbLog.contactId;
      callLogId = dbLog.id;
      logger.info({ CallSid, CallStatus, contactId, callLogId }, "campaign-status: recovered from DB after restart");
    }

    const isTerminal = ["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus);

    if (CallStatus === "no-answer" || CallStatus === "busy") {
      await db.update(campaignContactsTable).set({ callStatus: "no_answer", callDuration: 0 }).where(eq(campaignContactsTable.id, contactId));
      if (callLogId) {
        await db.update(campaignCallLogsTable).set({ callStatus: "no_answer", callOutcome: "no_answer", callDuration: 0 }).where(eq(campaignCallLogsTable.id, callLogId));
      }
      outboundCampaignCalls.delete(CallSid);
      outboundConversations.delete(CallSid);
      outboundCallLogMap.delete(CallSid);
      res.sendStatus(200);
      return;
    }

    if (CallStatus === "in-progress") {
      await db.update(campaignContactsTable).set({ callStatus: "in_progress" }).where(eq(campaignContactsTable.id, contactId));
      if (callLogId) {
        await db.update(campaignCallLogsTable).set({ callStatus: "in_progress" }).where(eq(campaignCallLogsTable.id, callLogId));
      }
      res.sendStatus(200);
      return;
    }

    if (CallStatus === "failed" || CallStatus === "canceled") {
      await db.update(campaignContactsTable).set({ callStatus: "failed" }).where(eq(campaignContactsTable.id, contactId));
      if (callLogId) {
        await db.update(campaignCallLogsTable).set({ callStatus: "failed", callOutcome: "failed" }).where(eq(campaignCallLogsTable.id, callLogId));
      }
      outboundCampaignCalls.delete(CallSid);
      outboundConversations.delete(CallSid);
      outboundCallLogMap.delete(CallSid);
      res.sendStatus(200);
      return;
    }

    if (isTerminal) {
      const conv = outboundConversations.get(CallSid);
      const duration = CallDuration ? parseInt(CallDuration, 10) : 0;

      const [contact] = await db.select().from(campaignContactsTable).where(eq(campaignContactsTable.id, contactId));
      const [campaign] = contact ? await db.select().from(campaignsTable).where(eq(campaignsTable.id, contact.campaignId)) : [];

      const summary = conv ? await extractOutboundSummary(conv.messages) : null;
      const transcription = conv ? conv.messages.map(m => `${m.role === "user" ? "Owner" : "AI"}: ${m.content}`).join("\n\n") : null;

      const callData = {
        callStatus: "completed",
        callDuration: duration,
        callSummary: summary?.callSummary ?? null,
        transcription,
        interestedInSelling: summary?.interestedInSelling ?? null,
        timeline: summary?.timeline ?? null,
        askingPrice: summary?.askingPrice ?? null,
        propertyType: summary?.propertyType ?? null,
        additionalNotes: summary?.additionalNotes ?? null,
        callOutcome: summary?.callOutcome ?? "completed",
      };

      // Update contact record (always reflects latest call)
      await db.update(campaignContactsTable).set(callData).where(eq(campaignContactsTable.id, contactId));

      // Update the call log entry for this specific attempt
      if (callLogId) {
        await db.update(campaignCallLogsTable).set(callData).where(eq(campaignCallLogsTable.id, callLogId));
      }

      outboundCampaignCalls.delete(CallSid);
      outboundConversations.delete(CallSid);
      outboundCallLogMap.delete(CallSid);

      // Hot lead email is sent from the recording callback (once audio is ready)

      // Fire next pending contacts up to concurrent limit (event-driven dialing)
      if (campaign && campaign.status === "active") {
        setImmediate(async () => {
          try {
            let fromNumber = "";
            if (campaign.fromPhoneNumberId) {
              const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, campaign.fromPhoneNumberId));
              fromNumber = pn?.number ?? "";
            }
            if (fromNumber) {
              const baseUrl = getPublicDomain() ?? "";
              if (baseUrl) await fireDueContacts(campaign, fromNumber, baseUrl);
            }
            await checkCampaignComplete(campaign.id);
          } catch (err: any) {
            logger.error({ err: err?.message, campaignId: campaign.id }, "Error firing next contact after call completion");
          }
        });
      }
    }

    res.sendStatus(200);
  } catch (err: any) {
    logger.error({ err: err?.message, CallSid }, "Error in campaign status callback");
    if (!res.headersSent) res.sendStatus(200);
  }
});

// ─── Twilio: campaign recording callback ─────────────────────────────────────
router.post("/twilio/campaign-recording", async (req, res): Promise<void> => {
  const { CallSid, RecordingUrl, RecordingSid } = req.body;
  try {
    const recordingData = {
      recordingUrl: RecordingUrl ? `${RecordingUrl}.mp3` : undefined,
      recordingSid: RecordingSid ?? undefined,
    };

    // Update call log by twilioCallSid (primary path)
    const [callLog] = await db.select().from(campaignCallLogsTable)
      .where(eq(campaignCallLogsTable.twilioCallSid, CallSid));
    if (callLog) {
      await db.update(campaignCallLogsTable).set(recordingData).where(eq(campaignCallLogsTable.id, callLog.id));
      logger.info({ callLogId: callLog.id, RecordingSid }, "Campaign recording saved to call log");
    }

    // Also update contact record for backward compat
    const [contact] = await db.select().from(campaignContactsTable)
      .where(eq(campaignContactsTable.twilioCallSid, CallSid));
    if (contact) {
      await db.update(campaignContactsTable).set(recordingData).where(eq(campaignContactsTable.id, contact.id));
    }

    if (!callLog && !contact) {
      logger.warn({ CallSid, RecordingUrl, RecordingSid }, "Campaign recording callback: no call log or contact found");
    }

    // Send hot lead email now that we have the recording — download MP3 and attach it
    const isHotOrCallback = callLog?.callOutcome === "hot_lead" || callLog?.callOutcome === "callback_requested";
    if (isHotOrCallback && contact && RecordingUrl) {
      setImmediate(async () => {
        try {
          const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, contact.campaignId));
          if (!campaign) return;

          // Download the recording from Twilio (requires auth)
          const accountSid = process.env.TWILIO_ACCOUNT_SID!;
          const authToken = process.env.TWILIO_AUTH_TOKEN!;
          const mp3Url = `${RecordingUrl}.mp3`;
          let audioBuffer: Buffer | null = null;
          try {
            const authHeader = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");
            const audioRes = await fetch(mp3Url, { headers: { Authorization: authHeader } });
            // Twilio redirects to a CDN — follow the redirect without auth
            const finalUrl = audioRes.redirected ? audioRes.url : mp3Url;
            const finalRes = audioRes.redirected ? await fetch(finalUrl) : audioRes;
            if (finalRes.ok) audioBuffer = Buffer.from(await finalRes.arrayBuffer());
          } catch (dlErr: any) {
            logger.warn({ dlErr: dlErr?.message }, "Could not download recording for email attachment — sending without audio");
          }

          const summary = {
            callSummary: callLog.callSummary,
            callOutcome: callLog.callOutcome,
            interestedInSelling: callLog.interestedInSelling,
            timeline: callLog.timeline,
            askingPrice: callLog.askingPrice,
            propertyType: callLog.propertyType,
            additionalNotes: callLog.additionalNotes,
          };
          await sendHotLeadEmail(contact, campaign, summary, mp3Url, audioBuffer);
        } catch (err: any) {
          logger.error({ err: err?.message, CallSid }, "Hot lead email (from recording callback) failed");
        }
      });
    }

    res.sendStatus(200);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Error in campaign recording callback");
    if (!res.headersSent) res.sendStatus(200);
  }
});

// ─── Campaign Scheduler ───────────────────────────────────────────────────────
interface ScheduleSlot { days: number[]; startTime: string; endTime: string; }
interface CampaignScheduleConfig { enabled: boolean; timezone: string; slots: ScheduleSlot[]; }

function isWithinScheduleWindow(config: CampaignScheduleConfig): boolean {
  const tz = config.timezone || "UTC";
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = parts.find(p => p.type === "weekday")?.value ?? "";
  const dayOfWeek = dayMap[weekday] ?? -1;
  let hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  const currentMinutes = hour * 60 + minute;
  for (const slot of (config.slots ?? [])) {
    if (!slot.days.includes(dayOfWeek)) continue;
    const [sh, sm] = slot.startTime.split(":").map(Number);
    const [eh, em] = slot.endTime.split(":").map(Number);
    if (currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em) return true;
  }
  return false;
}

async function getCampaignFromNumber(campaign: any): Promise<string> {
  if (!campaign.fromPhoneNumberId) return "";
  const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, campaign.fromPhoneNumberId));
  return pn?.number ?? "";
}

async function autoStartCampaignScheduled(campaign: any): Promise<void> {
  const baseUrl = getPublicDomain();
  if (!baseUrl) { logger.warn({ campaignId: campaign.id }, "Scheduler: no public domain"); return; }
  const fromNumber = await getCampaignFromNumber(campaign);
  if (!fromNumber) { logger.warn({ campaignId: campaign.id }, "Scheduler: no phone number"); return; }
  await db.update(campaignsTable).set({ status: "active" }).where(eq(campaignsTable.id, campaign.id));
  const fired = await fireDueContacts(campaign, fromNumber, baseUrl);
  logger.info({ campaignId: campaign.id, fired }, "Scheduler auto-started campaign");
  if (fired === 0) await checkCampaignComplete(campaign.id);
}

setInterval(async () => {
  try {
    const allCampaigns = await db.select().from(campaignsTable)
      .where(sql`status IN ('draft', 'paused', 'active')`);

    for (const campaign of allCampaigns) {
      // ── Schedule-window auto-start/pause ───────────────────────────────────
      if (campaign.scheduleConfig) {
        try {
          const cfg: CampaignScheduleConfig = JSON.parse(campaign.scheduleConfig);
          if (cfg.enabled && cfg.slots?.length) {
            const inWindow = isWithinScheduleWindow(cfg);
            if (inWindow && (campaign.status === "draft" || campaign.status === "paused")) {
              await autoStartCampaignScheduled(campaign);
              continue; // handled — skip per-contact check below
            } else if (!inWindow && campaign.status === "active") {
              await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, campaign.id));
              logger.info({ campaignId: campaign.id }, "Campaign auto-paused (outside schedule window)");
              continue;
            }
          }
        } catch { /* ignore parse errors */ }
      }

      // ── Per-contact scheduled calls for active campaigns ───────────────────
      if (campaign.status === "active") {
        try {
          const fromNumber = await getCampaignFromNumber(campaign);
          const baseUrl = getPublicDomain() ?? "";
          if (fromNumber && baseUrl) {
            const fired = await fireDueContacts(campaign, fromNumber, baseUrl);
            if (fired > 0) logger.info({ campaignId: campaign.id, fired }, "Scheduler fired due contacts");
            await checkCampaignComplete(campaign.id);
          }
        } catch (err: any) {
          logger.error({ err: err?.message, campaignId: campaign.id }, "Scheduler: per-contact fire error");
        }
      }
    }
  } catch (err: any) {
    logger.error({ err: err?.message }, "Campaign scheduler tick error");
  }
}, 60_000);

export default router;
