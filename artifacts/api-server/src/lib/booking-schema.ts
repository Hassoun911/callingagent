import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

let readyPromise: Promise<void> | null = null;

export function ensureBookingSchema(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_resources (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        resource_type TEXT NOT NULL DEFAULT 'staff',
        description TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        allow_random_assignment BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS booking_resources_company_name_idx ON booking_resources(company_id, name)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_services (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 30,
        buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
        buffer_after_minutes INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS booking_services_company_name_idx ON booking_services(company_id, name)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_resource_services (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        resource_id INTEGER NOT NULL,
        service_id INTEGER NOT NULL
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS booking_resource_services_unique_idx ON booking_resource_services(resource_id, service_id)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_availability (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        resource_id INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_time_off (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        resource_id INTEGER NOT NULL,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        reason TEXT
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_settings (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL UNIQUE,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        timezone TEXT NOT NULL DEFAULT 'America/Toronto',
        slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
        minimum_notice_minutes INTEGER NOT NULL DEFAULT 60,
        maximum_advance_days INTEGER NOT NULL DEFAULT 90,
        allow_resource_selection BOOLEAN NOT NULL DEFAULT TRUE,
        allow_random_assignment BOOLEAN NOT NULL DEFAULT TRUE,
        require_approval BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS resource_id INTEGER`);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id INTEGER`);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dashboard'`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS appointments_resource_time_idx ON appointments(resource_id, start_time)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS appointments_company_time_idx ON appointments(company_id, start_time)`);
    logger.info("Flexible booking schema ready");
  })().catch((err) => {
    readyPromise = null;
    logger.error({ err: err?.message }, "Failed to prepare booking schema");
    throw err;
  });
  return readyPromise;
}
