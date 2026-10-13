import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const extensionsTable = pgTable("extensions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  digit: text("digit").notNull(),
  forwardTo: text("forward_to").notNull(),
  description: text("description"),
  agents: jsonb("agents").$type<Array<{ userId: number; phone: string }>>().notNull().default([]),
  fallbackAction: text("fallback_action").notNull().default("voicemail"),
  ringCount: integer("ring_count").notNull().default(4),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Extension = typeof extensionsTable.$inferSelect;
