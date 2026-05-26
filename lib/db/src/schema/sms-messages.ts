import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { phoneNumbersTable } from "./phone-numbers";

export const smsMessagesTable = pgTable("sms_messages", {
  id: serial("id").primaryKey(),
  phoneNumberId: integer("phone_number_id").references(() => phoneNumbersTable.id, { onDelete: "set null" }),
  twilioSid: text("twilio_sid").unique(),
  direction: text("direction").notNull(),
  from: text("from").notNull(),
  to: text("to").notNull(),
  body: text("body").notNull(),
  status: text("status"),
  numMedia: integer("num_media").default(0),
  mediaUrls: text("media_urls").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SmsMessage = typeof smsMessagesTable.$inferSelect;
export type InsertSmsMessage = typeof smsMessagesTable.$inferInsert;
