import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

let readyPromise: Promise<void> | null = null;

export function ensureBookingSchema(): Promise<void> {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_resources (
        id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL,
        resource_type TEXT NOT NULL DEFAULT 'staff', description TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE, allow_random_assignment BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS booking_resources_company_name_idx ON booking_resources(company_id, name)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_services (
        id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT,
        duration_minutes INTEGER NOT NULL DEFAULT 30, buffer_before_minutes INTEGER NOT NULL DEFAULT 0,
        buffer_after_minutes INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS booking_services_company_name_idx ON booking_services(company_id, name)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_resource_services (
        id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, resource_id INTEGER NOT NULL, service_id INTEGER NOT NULL
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS booking_resource_services_unique_idx ON booking_resource_services(resource_id, service_id)`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_availability (
        id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, resource_id INTEGER NOT NULL,
        day_of_week INTEGER NOT NULL, start_time TEXT NOT NULL, end_time TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_time_off (
        id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL, resource_id INTEGER NOT NULL,
        start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ NOT NULL, reason TEXT
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS booking_settings (
        id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL UNIQUE, enabled BOOLEAN NOT NULL DEFAULT TRUE,
        timezone TEXT NOT NULL DEFAULT 'America/Toronto', slot_interval_minutes INTEGER NOT NULL DEFAULT 30,
        minimum_notice_minutes INTEGER NOT NULL DEFAULT 60, maximum_advance_days INTEGER NOT NULL DEFAULT 90,
        allow_resource_selection BOOLEAN NOT NULL DEFAULT TRUE, allow_random_assignment BOOLEAN NOT NULL DEFAULT TRUE,
        require_approval BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS resource_id INTEGER`);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service_id INTEGER`);
    await db.execute(sql`ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'dashboard'`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS appointments_resource_time_idx ON appointments(resource_id, start_time)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS appointments_company_time_idx ON appointments(company_id, start_time)`);

    await db.execute(sql`
      CREATE OR REPLACE FUNCTION callingagent_assign_booking_resource() RETURNS trigger AS $$
      DECLARE
        chosen_service booking_services%ROWTYPE;
        chosen_resource booking_resources%ROWTYPE;
        calculated_end TIMESTAMPTZ;
      BEGIN
        IF NEW.company_id IS NULL OR NEW.status = 'cancelled' THEN RETURN NEW; END IF;

        IF NEW.service_id IS NULL THEN
          SELECT * INTO chosen_service FROM booking_services
          WHERE company_id = NEW.company_id AND active = TRUE
            AND lower(name) = lower(COALESCE(NEW.title, '')) LIMIT 1;
          IF chosen_service.id IS NULL THEN
            SELECT * INTO chosen_service FROM booking_services
            WHERE company_id = NEW.company_id AND active = TRUE ORDER BY id LIMIT 1;
          END IF;
          NEW.service_id := chosen_service.id;
        ELSE
          SELECT * INTO chosen_service FROM booking_services WHERE id = NEW.service_id AND company_id = NEW.company_id;
        END IF;

        calculated_end := COALESCE(NEW.end_time, NEW.start_time + make_interval(mins => COALESCE(chosen_service.duration_minutes, 30)));
        NEW.end_time := calculated_end;

        IF NEW.resource_id IS NULL AND EXISTS (SELECT 1 FROM booking_resources WHERE company_id = NEW.company_id AND active = TRUE) THEN
          SELECT r.* INTO chosen_resource
          FROM booking_resources r
          WHERE r.company_id = NEW.company_id AND r.active = TRUE
            AND (
              position(lower(r.name) in lower(COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.title, ''))) > 0
              OR r.allow_random_assignment = TRUE
            )
            AND (chosen_service.id IS NULL OR NOT EXISTS (
              SELECT 1 FROM booking_resource_services rs WHERE rs.company_id = NEW.company_id AND rs.service_id = chosen_service.id
            ) OR EXISTS (
              SELECT 1 FROM booking_resource_services rs WHERE rs.resource_id = r.id AND rs.service_id = chosen_service.id
            ))
            AND NOT EXISTS (
              SELECT 1 FROM booking_time_off t
              WHERE t.resource_id = r.id AND t.start_time < calculated_end AND t.end_time > NEW.start_time
            )
            AND NOT EXISTS (
              SELECT 1 FROM appointments a
              WHERE a.resource_id = r.id AND a.status <> 'cancelled'
                AND a.id <> COALESCE(NEW.id, -1)
                AND a.start_time < calculated_end
                AND COALESCE(a.end_time, a.start_time + interval '30 minutes') > NEW.start_time
            )
          ORDER BY
            CASE WHEN position(lower(r.name) in lower(COALESCE(NEW.notes, '') || ' ' || COALESCE(NEW.title, ''))) > 0 THEN 0 ELSE 1 END,
            (SELECT COUNT(*) FROM appointments a2 WHERE a2.resource_id = r.id AND a2.status <> 'cancelled'), r.id
          LIMIT 1;

          IF chosen_resource.id IS NULL THEN
            RAISE EXCEPTION 'No booking resource is available at the requested time';
          END IF;
          NEW.resource_id := chosen_resource.id;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`DROP TRIGGER IF EXISTS callingagent_assign_booking_resource_trigger ON appointments`);
    await db.execute(sql`
      CREATE TRIGGER callingagent_assign_booking_resource_trigger
      BEFORE INSERT OR UPDATE OF start_time, end_time, resource_id, service_id, status ON appointments
      FOR EACH ROW EXECUTE FUNCTION callingagent_assign_booking_resource()
    `);
    logger.info("Flexible booking schema ready");
  })().catch((err) => {
    readyPromise = null;
    logger.error({ err: err?.message }, "Failed to prepare booking schema");
    throw err;
  });
  return readyPromise;
}
