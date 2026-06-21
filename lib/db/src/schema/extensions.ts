import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const extensionsTable = pgTable("extensions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  digit: text("digit").notNull(),
  forwardTo: text("forward_to").notNull(),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Extension = typeof extensionsTable.$inferSelect;
