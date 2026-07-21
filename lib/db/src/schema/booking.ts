import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const bookingResourcesTable = pgTable("booking_resources", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  resourceType: text("resource_type").notNull().default("staff"),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  allowRandomAssignment: boolean("allow_random_assignment").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  companyNameUnique: uniqueIndex("booking_resources_company_name_idx").on(table.companyId, table.name),
}));

export const bookingServicesTable = pgTable("booking_services", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  durationMinutes: integer("duration_minutes").notNull().default(30),
  bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
  bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => ({
  companyNameUnique: uniqueIndex("booking_services_company_name_idx").on(table.companyId, table.name),
}));

export const bookingResourceServicesTable = pgTable("booking_resource_services", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  resourceId: integer("resource_id").notNull(),
  serviceId: integer("service_id").notNull(),
}, (table) => ({
  assignmentUnique: uniqueIndex("booking_resource_services_unique_idx").on(table.resourceId, table.serviceId),
}));

export const bookingAvailabilityTable = pgTable("booking_availability", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  resourceId: integer("resource_id").notNull(),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  active: boolean("active").notNull().default(true),
});

export const bookingTimeOffTable = pgTable("booking_time_off", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  resourceId: integer("resource_id").notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  reason: text("reason"),
});

export const bookingSettingsTable = pgTable("booking_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().unique(),
  enabled: boolean("enabled").notNull().default(true),
  timezone: text("timezone").notNull().default("America/Toronto"),
  slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
  minimumNoticeMinutes: integer("minimum_notice_minutes").notNull().default(60),
  maximumAdvanceDays: integer("maximum_advance_days").notNull().default(90),
  allowResourceSelection: boolean("allow_resource_selection").notNull().default(true),
  allowRandomAssignment: boolean("allow_random_assignment").notNull().default(true),
  requireApproval: boolean("require_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type BookingResource = typeof bookingResourcesTable.$inferSelect;
export type BookingService = typeof bookingServicesTable.$inferSelect;
