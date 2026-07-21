import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, aiVoiceConfigTable, companiesTable } from "@workspace/db";
import {
  GetAiVoiceConfigResponse,
  UpdateAiVoiceConfigBody,
  UpdateAiVoiceConfigResponse,
  ListElevenLabsVoicesResponse,
} from "@workspace/api-zod";
import { warmTtsCache, synthesizeElevenLabs } from "./twilio-webhooks";
import { openai } from "@workspace/integrations-openai-ai-server/audio";

const router: IRouter = Router();

async function ensureConfig() {
  const [existing] = await db.select().from(aiVoiceConfigTable);
  if (existing) return existing;

  const [created] = await db.insert(aiVoiceConfigTable).values({}).returning();
  return created;
}

const VALID_VOICES = ["alloy","ash","ballad","coral","echo","fable","nova","onyx","sage","shimmer","verse"] as const;
type VoiceId = typeof VALID_VOICES[number];

const VOICE_SAMPLES: Record<VoiceId, string> = {
  coral:   "Hello, I'm Coral. I'll be your assistant today. How can I help you?",
  nova:    "Hi there! I'm Nova. Ready to assist you with anything you need.",
  shimmer: "Hello, this is Shimmer. I'm here to help. What can I do for you?",
  alloy:   "Hi, I'm Alloy. I'm here to assist you today. What do you need?",
  ash:     "Hello, this is Ash. I'm ready to take your call. How may I assist you?",
  sage:    "Good day. I'm Sage. I'll do my best to help you. What's on your mind?",
  ballad:  "Hello! I'm Ballad. It's great to speak with you. How can I help?",
  verse:   "Hi, I'm Verse. I'm here and ready to assist. What can I do for you today?",
  echo:    "Hello there. I'm Echo. It's good to hear from you. How can I help?",
  fable:   "Hello! I'm Fable. I'd love to help you today. What do you need?",
  onyx:    "Good day. I'm Onyx. I'm here to assist. Please go ahead.",
};

const PREVIEW_TEXT_BY_LANG: Record<string, string> = {
  en:  "Hello, thank you for calling. I'm here to help — how can I assist you today?",
  ar:  "مرحباً، شكراً لاتصالك. أنا هنا للمساعدة — كيف يمكنني مساعدتك اليوم؟",
  fr:  "Bonjour, merci de votre appel. Je suis là pour vous aider — comment puis-je vous assister aujourd'hui?",
  de:  "Hallo, vielen Dank für Ihren Anruf. Ich bin hier um zu helfen — wie kann ich Ihnen heute behilflich sein?",
  es:  "Hola, gracias por llamar. Estoy aquí para ayudar — ¿en qué puedo asistirle hoy?",
  it:  "Ciao, grazie per aver chiamato. Sono qui per aiutarti — come posso assisterti oggi?",
  pt:  "Olá, obrigado por ligar. Estou aqui para ajudar — como posso lhe ajudar hoje?",
  nl:  "Hallo, bedankt voor uw oproep. Ik ben hier om te helpen — hoe kan ik u vandaag helpen?",
  zh:  "您好，感谢您的来电。我在这里为您提供帮助 — 今天我能为您做什么？",
  ja:  "こんにちは、お電話ありがとうございます。お手伝いするためにここにいます — 本日はどのようにお手伝いできますか？",
  hi:  "नमस्ते, कॉल करने के लिए धन्यवाद। मैं यहाँ मदद के लिए हूँ — आज मैं आपकी कैसे सहायता कर सकता हूँ?",
  ru:  "Здравствуйте, спасибо за звонок. Я здесь, чтобы помочь — как я могу помочь вам сегодня?",
  sv:  "Hej, tack för ditt samtal. Jag är här för att hjälpa — hur kan jag hjälpa dig idag?",
  no:  "Hei, takk for at du ringte. Jeg er her for å hjelpe — hvordan kan jeg hjelpe deg i dag?",
  pl:  "Cześć, dziękuję za telefon. Jestem tutaj, żeby pomóc — jak mogę ci dziś pomóc?",
  cs:  "Dobrý den, děkujeme za váš hovor. Jsem tu, abych pomohl — jak vám mohu pomoci?",
  sk:  "Dobrý deň, ďakujeme za váš hovor. Som tu, aby som pomohol — ako vám môžem pomôcť?",
  ro:  "Bună ziua, vă mulțumim că ați sunat. Sunt aici să ajut — cu ce vă pot ajuta astăzi?",
  hr:  "Bok, hvala što ste pozvali. Ovdje sam da pomognem — kako vam mogu pomoći danas?",
  uk:  "Привіт, дякуємо за дзвінок. Я тут, щоб допомогти — як я можу допомогти вам сьогодні?",
  tr:  "Merhaba, aradığınız için teşekkürler. Yardımcı olmak için buradayım — bugün size nasıl yardımcı olabilirim?",
  vi:  "Xin chào, cảm ơn bạn đã gọi. Tôi ở đây để giúp đỡ — tôi có thể giúp gì cho bạn hôm nay?",
  ms:  "Helo, terima kasih kerana menghubungi. Saya di sini untuk membantu — bagaimana saya boleh membantu anda hari ini?",
  fil: "Kumusta, salamat sa pagtawag. Nandito ako para tumulong — paano kita matutulungan ngayon?",
};

function getPreviewText(lang?: string): string {
  if (!lang) return PREVIEW_TEXT_BY_LANG.en;
  const code = lang.toLowerCase().split("-")[0];
  return PREVIEW_TEXT_BY_LANG[code] ?? PREVIEW_TEXT_BY_LANG.en;
}

router.get("/ai-voice/preview", async (req, res): Promise<void> => {
  const engine = (req.query.engine as string) || "openai";

  if (engine === "elevenlabs") {
    const voiceId = req.query.voiceId as string;
    if (!voiceId) {
      res.status(400).json({ error: "voiceId is required for elevenlabs preview" });
      return;
    }
    const previewText = getPreviewText(req.query.lang as string | undefined);
    try {
      const buf = await synthesizeElevenLabs(previewText, voiceId);
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", buf.length);
      res.send(buf);
    } catch (err: any) {
      res.status(502).json({ error: err?.message ?? "ElevenLabs preview failed" });
    }
    return;
  }

  const voice = req.query.voice as string;
  if (!VALID_VOICES.includes(voice as VoiceId)) {
    res.status(400).json({ error: "Invalid voice" });
    return;
  }
  const v = voice as VoiceId;
  const text = VOICE_SAMPLES[v];
  const mp3 = await openai.audio.speech.create({
    model: "tts-1",
    voice: v,
    input: text,
    response_format: "mp3",
  });
  const arrayBuf = await mp3.arrayBuffer();
  const buf = Buffer.from(arrayBuf);
  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Content-Length", buf.length);
  res.send(buf);
});

router.get("/ai-voice/elevenlabs-voices", async (_req, res): Promise<void> => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "ELEVENLABS_API_KEY not configured" });
    return;
  }
  try {
    const resp = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!resp.ok) {
      const errText = await resp.text();
      res.status(502).json({ error: `ElevenLabs API error ${resp.status}: ${errText}` });
      return;
    }
    const data: any = await resp.json();
    const voices = (data.voices ?? []).map((v: any) => {
      const verifiedLanguages: string[] = Array.isArray(v.verified_languages)
        ? Array.from(new Set(v.verified_languages.map((l: any) => l.language).filter(Boolean)))
        : [];
      const primaryLanguage = v.labels?.language ?? verifiedLanguages[0] ?? null;
      const languages = primaryLanguage
        ? Array.from(new Set([primaryLanguage, ...verifiedLanguages]))
        : verifiedLanguages;
      return {
        voiceId: v.voice_id,
        name: v.name,
        previewUrl: v.preview_url ?? null,
        category: v.category ?? null,
        accent: v.labels?.accent ?? null,
        gender: v.labels?.gender ?? null,
        description: v.description ?? null,
        language: primaryLanguage,
        languages,
      };
    });
    res.json(ListElevenLabsVoicesResponse.parse({ voices }));
  } catch (err: any) {
    res.status(502).json({ error: err?.message ?? "Failed to fetch ElevenLabs voices" });
  }
});

router.get("/ai-voice/config", async (_req, res): Promise<void> => {
  const config = await ensureConfig();
  res.json(GetAiVoiceConfigResponse.parse(config));
});

router.patch("/ai-voice/config", async (req, res): Promise<void> => {
  const parsed = UpdateAiVoiceConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const config = await ensureConfig();

  const updateData: any = {};
  const body = parsed.data;
  if (body.voice != null) updateData.voice = body.voice;
  if (body.language != null) updateData.language = body.language;
  if (body.greeting != null) updateData.greeting = body.greeting;
  if (body.systemPrompt != null) updateData.systemPrompt = body.systemPrompt;
  if (body.maxCallDuration != null) updateData.maxCallDuration = body.maxCallDuration;
  if (body.speechTimeout != null) updateData.speechTimeout = body.speechTimeout;
  if (body.maxTokens != null) updateData.maxTokens = body.maxTokens;
  if (body.voiceStyle != null) updateData.voiceStyle = body.voiceStyle;
  if (body.campaignVoiceEngine != null) updateData.campaignVoiceEngine = body.campaignVoiceEngine;
  if (body.elevenLabsVoiceId != null) updateData.elevenLabsVoiceId = body.elevenLabsVoiceId;
  if (body.aiVoiceEngine != null) updateData.aiVoiceEngine = body.aiVoiceEngine;
  if ("adminNotifyPhone" in body) updateData.adminNotifyPhone = body.adminNotifyPhone ?? null;

  const [updated] = await db.update(aiVoiceConfigTable)
    .set(updateData)
    .where(eq(aiVoiceConfigTable.id, config.id))
    .returning();

  res.json(UpdateAiVoiceConfigResponse.parse(updated));
  warmTtsCache().catch(() => {});
});

router.post("/ai-voice/extract-booking-setup", async (req, res): Promise<void> => {
  try {
    const requestedCompanyId = Number(req.body?.companyId);
    const companyId = req.user?.role === "super_admin" ? requestedCompanyId : Number(req.user?.companyId);
    if (!companyId) {
      res.status(400).json({ error: "companyId is required" });
      return;
    }
    if (req.user?.role !== "super_admin" && Number(req.user?.companyId) !== companyId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const config = await ensureConfig();
    const promptText = String(req.body?.systemPrompt ?? config.systemPrompt ?? "").trim();
    if (!promptText) {
      res.status(400).json({ error: "The AI system prompt is empty" });
      return;
    }

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `Extract a proposed booking configuration from a business receptionist prompt. Return JSON only with this shape:
{
  "resources": [{"name":"string","resourceType":"staff|technician|barber|chair|room|table|vehicle|agent|other","description":"string","allowRandomAssignment":true}],
  "services": [{"name":"string","description":"string","durationMinutes":30,"bufferBeforeMinutes":0,"bufferAfterMinutes":0}],
  "availability": [{"resourceName":"string","dayOfWeek":0,"startTime":"09:00","endTime":"17:00"}],
  "settings": {"enabled":true,"timezone":"America/Toronto","slotIntervalMinutes":30,"minimumNoticeMinutes":60,"maximumAdvanceDays":90,"allowResourceSelection":true,"allowRandomAssignment":true,"requireApproval":false},
  "warnings": ["string"]
}
Rules: infer only what is supported by the prompt. Do not invent named staff. If no named staff/resources exist, create one generic resource appropriate to the business, such as Mobile Technician, Barber, Realtor, Treatment Room, Table, or Service Vehicle. Convert stated regular business hours into availability for the generic resource. Emergency 24/7 service may use 00:00 to 23:59 and minimumNoticeMinutes 0. Use realistic service durations only when the prompt does not specify them, and mention those estimates in warnings. Do not include prices as services unless they are actual bookable services.`
        },
        {
          role: "user",
          content: `Company: ${company.name}\n\nAI receptionist instructions:\n${promptText}`
        }
      ]
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    const resources = Array.isArray(parsed.resources) ? parsed.resources.slice(0, 50).map((r: any) => ({
      name: String(r.name || "").trim(),
      resourceType: String(r.resourceType || "staff").trim(),
      description: String(r.description || "").trim(),
      allowRandomAssignment: r.allowRandomAssignment !== false,
    })).filter((r: any) => r.name) : [];
    const services = Array.isArray(parsed.services) ? parsed.services.slice(0, 100).map((s: any) => ({
      name: String(s.name || "").trim(),
      description: String(s.description || "").trim(),
      durationMinutes: Math.max(5, Math.min(480, Number(s.durationMinutes) || 30)),
      bufferBeforeMinutes: Math.max(0, Math.min(120, Number(s.bufferBeforeMinutes) || 0)),
      bufferAfterMinutes: Math.max(0, Math.min(120, Number(s.bufferAfterMinutes) || 0)),
    })).filter((s: any) => s.name) : [];
    const availability = Array.isArray(parsed.availability) ? parsed.availability.slice(0, 350).map((a: any) => ({
      resourceName: String(a.resourceName || "").trim(),
      dayOfWeek: Math.max(0, Math.min(6, Number(a.dayOfWeek) || 0)),
      startTime: /^\d{2}:\d{2}$/.test(String(a.startTime)) ? String(a.startTime) : "09:00",
      endTime: /^\d{2}:\d{2}$/.test(String(a.endTime)) ? String(a.endTime) : "17:00",
    })).filter((a: any) => a.resourceName && a.endTime > a.startTime) : [];
    const settings = {
      enabled: parsed.settings?.enabled !== false,
      timezone: String(parsed.settings?.timezone || "America/Toronto"),
      slotIntervalMinutes: Math.max(5, Math.min(240, Number(parsed.settings?.slotIntervalMinutes) || 30)),
      minimumNoticeMinutes: Math.max(0, Number(parsed.settings?.minimumNoticeMinutes) || 0),
      maximumAdvanceDays: Math.max(1, Math.min(730, Number(parsed.settings?.maximumAdvanceDays) || 90)),
      allowResourceSelection: parsed.settings?.allowResourceSelection !== false,
      allowRandomAssignment: parsed.settings?.allowRandomAssignment !== false,
      requireApproval: parsed.settings?.requireApproval === true,
    };

    res.json({
      companyId,
      companyName: company.name,
      source: "ai_system_prompt",
      resources,
      services,
      availability,
      settings,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 20) : [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Could not analyze AI settings" });
  }
});

export default router;
