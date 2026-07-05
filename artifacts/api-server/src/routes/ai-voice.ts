import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, aiVoiceConfigTable } from "@workspace/db";
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

const ELEVENLABS_PREVIEW_TEXT = "Hello, thank you for calling. I'm here to help — how can I assist you today?";

router.get("/ai-voice/preview", async (req, res): Promise<void> => {
  const engine = (req.query.engine as string) || "openai";

  if (engine === "elevenlabs") {
    const voiceId = req.query.voiceId as string;
    if (!voiceId) {
      res.status(400).json({ error: "voiceId is required for elevenlabs preview" });
      return;
    }
    try {
      const buf = await synthesizeElevenLabs(ELEVENLABS_PREVIEW_TEXT, voiceId);
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
    const voices = (data.voices ?? []).map((v: any) => ({
      voiceId: v.voice_id,
      name: v.name,
      previewUrl: v.preview_url ?? null,
      category: v.category ?? null,
    }));
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

  const [updated] = await db.update(aiVoiceConfigTable)
    .set(updateData)
    .where(eq(aiVoiceConfigTable.id, config.id))
    .returning();

  res.json(UpdateAiVoiceConfigResponse.parse(updated));

  // Re-warm TTS cache in the background with the new greeting/voice so the next call is instant
  warmTtsCache().catch(() => {});
});

export default router;
