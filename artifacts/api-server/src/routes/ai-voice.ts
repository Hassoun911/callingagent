import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, aiVoiceConfigTable } from "@workspace/db";
import {
  GetAiVoiceConfigResponse,
  UpdateAiVoiceConfigBody,
  UpdateAiVoiceConfigResponse,
} from "@workspace/api-zod";
import { warmTtsCache } from "./twilio-webhooks";

const router: IRouter = Router();

async function ensureConfig() {
  const [existing] = await db.select().from(aiVoiceConfigTable);
  if (existing) return existing;

  const [created] = await db.insert(aiVoiceConfigTable).values({}).returning();
  return created;
}

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

  const [updated] = await db.update(aiVoiceConfigTable)
    .set(updateData)
    .where(eq(aiVoiceConfigTable.id, config.id))
    .returning();

  res.json(UpdateAiVoiceConfigResponse.parse(updated));

  // Re-warm TTS cache in the background with the new greeting/voice so the next call is instant
  warmTtsCache().catch(() => {});
});

export default router;
