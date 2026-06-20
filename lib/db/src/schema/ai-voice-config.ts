import { pgTable, text, serial, timestamp, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiVoiceConfigTable = pgTable("ai_voice_config", {
  id: serial("id").primaryKey(),
  voice: text("voice").notNull().default("nova"),
  language: text("language").notNull().default("en-US"),
  greeting: text("greeting").notNull().default("Hello, thank you for calling. How can I help you today?"),
  systemPrompt: text("system_prompt").notNull().default("You are a professional phone agent. Speak naturally and conversationally — not like a script. Use contractions. Keep every response to 1-3 sentences. Ask only one question at a time. Sound warm but professional. If someone asks if you are AI, acknowledge you are a virtual assistant and redirect to helping them. Never use bullet points, lists, or markdown — this is a phone call. Your goal is to understand their need and help them or take a detailed message."),
  maxCallDuration: integer("max_call_duration").notNull().default(300),
  speechTimeout: doublePrecision("speech_timeout").notNull().default(2.5),
  maxTokens: integer("max_tokens").notNull().default(250),
  voiceStyle: text("voice_style").notNull().default("Speak naturally and warmly, like a real person — not a recording. Use natural conversational pauses. Vary your pace slightly. Sound professional but approachable."),
  campaignVoiceEngine: text("campaign_voice_engine").notNull().default("google"),
  elevenLabsVoiceId: text("eleven_labs_voice_id"),
  openaiCreditBalance: doublePrecision("openai_credit_balance"),
  openaiCreditUpdatedAt: timestamp("openai_credit_updated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiVoiceConfigSchema = createInsertSchema(aiVoiceConfigTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiVoiceConfig = z.infer<typeof insertAiVoiceConfigSchema>;
export type AiVoiceConfig = typeof aiVoiceConfigTable.$inferSelect;
