import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aiVoiceConfigTable = pgTable("ai_voice_config", {
  id: serial("id").primaryKey(),
  voice: text("voice").notNull().default("alloy"),
  greeting: text("greeting").notNull().default("Hello, thank you for calling. How can I help you today?"),
  systemPrompt: text("system_prompt").notNull().default("You are a professional and friendly call center assistant. Answer questions helpfully and concisely. If you cannot help with something, offer to take a message."),
  maxCallDuration: integer("max_call_duration").notNull().default(300),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertAiVoiceConfigSchema = createInsertSchema(aiVoiceConfigTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAiVoiceConfig = z.infer<typeof insertAiVoiceConfigSchema>;
export type AiVoiceConfig = typeof aiVoiceConfigTable.$inferSelect;
