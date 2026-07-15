import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const callLogsTable = pgTable("call_logs", {
  id: serial("id").primaryKey(),
  phoneNumberId: integer("phone_number_id"),
  twilioCallSid: text("twilio_call_sid"),
  direction: text("direction").notNull(),
  status: text("status").notNull(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  duration: integer("duration"),
  recordingUrl: text("recording_url"),
  recordingSid: text("recording_sid"),
  transcription: text("transcription"),
  contactId: integer("contact_id"),
  contactName: text("contact_name"),
  callerIdName: text("caller_id_name"),
  answerMode: text("answer_mode"),
  callerName: text("caller_name"),
  callerEmail: text("caller_email"),
  callType: text("call_type"),
  callSummary: text("call_summary"),
  actionRequired: text("action_required"),
  priority: text("priority"),
  callerLocation: text("caller_location"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCallLogSchema = createInsertSchema(callLogsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCallLog = z.infer<typeof insertCallLogSchema>;
export type CallLog = typeof callLogsTable.$inferSelect;
