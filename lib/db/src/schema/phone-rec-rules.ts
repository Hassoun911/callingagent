import { pgTable, text, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Rules synchronized from the Phone Rec Android app.
 *
 * lineNumber is the CallingAgent/Twilio number that receives the forwarded call.
 * callerNumber is either an E.164 caller number or __unknown_callers__.
 * payload stores the complete Phone Rec rule + business profile as JSON so the
 * telephony server can apply the exact script and permissions selected on-device.
 */
export const phoneRecRulesTable = pgTable("phone_rec_rules", {
  id: serial("id").primaryKey(),
  lineNumber: text("line_number").notNull(),
  callerNumber: text("caller_number").notNull(),
  payload: text("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  lineCallerUnique: uniqueIndex("phone_rec_rules_line_caller_unique").on(table.lineNumber, table.callerNumber),
}));

export const insertPhoneRecRuleSchema = createInsertSchema(phoneRecRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPhoneRecRule = z.infer<typeof insertPhoneRecRuleSchema>;
export type PhoneRecRule = typeof phoneRecRulesTable.$inferSelect;
