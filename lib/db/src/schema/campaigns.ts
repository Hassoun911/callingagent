import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  script: text("script").notNull(),
  systemPrompt: text("system_prompt"),
  fromPhoneNumberId: integer("from_phone_number_id"),
  notificationEmail: text("notification_email"),
  status: text("status").notNull().default("draft"),
  maxCallDuration: integer("max_call_duration").default(300),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const campaignContactsTable = pgTable("campaign_contacts", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  address: text("address"),
  callStatus: text("call_status").notNull().default("pending"),
  callOutcome: text("call_outcome"),
  twilioCallSid: text("twilio_call_sid"),
  callSummary: text("call_summary"),
  transcription: text("transcription"),
  recordingUrl: text("recording_url"),
  recordingSid: text("recording_sid"),
  callDuration: integer("call_duration"),
  interestedInSelling: boolean("interested_in_selling"),
  timeline: text("timeline"),
  askingPrice: text("asking_price"),
  propertyType: text("property_type"),
  additionalNotes: text("additional_notes"),
  attemptCount: integer("attempt_count").default(0),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  callbackAt: timestamp("callback_at", { withTimezone: true }),
  calendarNotes: text("calendar_notes"),
  userNotes: text("user_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const campaignCallLogsTable = pgTable("campaign_call_logs", {
  id: serial("id").primaryKey(),
  contactId: integer("contact_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  twilioCallSid: text("twilio_call_sid"),
  callStatus: text("call_status").notNull().default("calling"),
  callOutcome: text("call_outcome"),
  callDuration: integer("call_duration"),
  callSummary: text("call_summary"),
  transcription: text("transcription"),
  recordingUrl: text("recording_url"),
  recordingSid: text("recording_sid"),
  interestedInSelling: boolean("interested_in_selling"),
  timeline: text("timeline"),
  askingPrice: text("asking_price"),
  propertyType: text("property_type"),
  additionalNotes: text("additional_notes"),
  calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCampaignContactSchema = createInsertSchema(campaignContactsTable).omit({ id: true, createdAt: true, updatedAt: true });

export type Campaign = typeof campaignsTable.$inferSelect;
export type CampaignContact = typeof campaignContactsTable.$inferSelect;
export type CampaignCallLog = typeof campaignCallLogsTable.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type InsertCampaignContact = z.infer<typeof insertCampaignContactSchema>;
