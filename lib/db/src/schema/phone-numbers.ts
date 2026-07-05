import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const phoneNumbersTable = pgTable("phone_numbers", {
  id: serial("id").primaryKey(),
  number: text("number").notNull().unique(),
  twilioSid: text("twilio_sid"),
  friendlyName: text("friendly_name").notNull(),
  callerIdName: text("caller_id_name").notNull(),
  companyId: integer("company_id"),
  forwardTo: text("forward_to"),
  ringCount: integer("ring_count").notNull().default(4),
  answerMode: text("answer_mode").notNull().default("forward"),
  forwardCallerId: text("forward_caller_id").notNull().default("caller"),
  callerExperience: text("caller_experience").notNull().default("ringing"),
  callScreen: boolean("call_screen").notNull().default(false),
  callScreenFallback: text("call_screen_fallback").notNull().default("voicemail"),
  forwardNoAnswerAction: text("forward_no_answer_action").notNull().default("personal_voicemail"),
  holdMessage: text("hold_message"),
  aiSystemPrompt: text("ai_system_prompt"),
  aiVoice: text("ai_voice"),
  aiVoiceEngine: text("ai_voice_engine"),
  aiElevenLabsVoiceId: text("ai_eleven_labs_voice_id"),
  aiLanguage: text("ai_language"),
  aiGreeting: text("ai_greeting"),
  aiSpeakingStyle: text("ai_speaking_style"),
  voicemailGreeting: text("voicemail_greeting"),
  notificationEmail: text("notification_email"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPhoneNumberSchema = createInsertSchema(phoneNumbersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPhoneNumber = z.infer<typeof insertPhoneNumberSchema>;
export type PhoneNumber = typeof phoneNumbersTable.$inferSelect;
