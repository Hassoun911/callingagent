import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const numberWatchesTable = pgTable("number_watches", {
  id: serial("id").primaryKey(),
  areaCode: text("area_code"),
  city: text("city"),
  country: text("country").notNull().default("US"),
  status: text("status").notNull().default("watching"), // watching | available | provisioned | paused
  foundNumbers: text("found_numbers"), // JSON string of available number objects
  lastChecked: timestamp("last_checked", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  label: text("label"), // user-defined label e.g. "Windsor 519"
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNumberWatchSchema = createInsertSchema(numberWatchesTable).omit({ id: true, createdAt: true });
export type InsertNumberWatch = z.infer<typeof insertNumberWatchSchema>;
export type NumberWatch = typeof numberWatchesTable.$inferSelect;
