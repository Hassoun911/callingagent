import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const POLICY_MARKER = "[CALLINGAGENT_CALENDAR_FIRST_BOOKING_V1]";

const BOOKING_POLICY = `${POLICY_MARKER}
APPOINTMENT BOOKING POLICY — follow this exactly:
The business timezone is America/Toronto (Eastern Time) unless the phone line has another timezone configured. Interpret today, tomorrow, weekdays, and relative dates in the business timezone. Never mention UTC to callers.

As soon as the caller clearly says they want an appointment, acknowledge it naturally and say something like, "Absolutely. Let me check our availability for you." Do this before claiming that any time is available.

For tomorrow or any future date:
1. Collect the requested service, preferred date, preferred time, caller name, callback number, and any required service details.
2. Check the real appointment calendar before confirming.
3. Never say booked, confirmed, reserved, or available until the calendar operation succeeds.
4. If the requested time is unavailable, apologize briefly and ask for another time. Do not invent availability.
5. After a successful booking, repeat the full local weekday, month, day, year, and time and ask the caller to confirm that it is correct.

For same-day service requests:
Do not guarantee or confirm a same-day appointment and do not call the booking tool. Collect the caller's name, callback number, service address or location, vehicle and service details, and preferred time. Then say, "I’ll send this to our team now. Someone from our team will get back to you shortly to confirm whether same-day service is available." Mark the call as requiring staff follow-up.

Never send or promise a confirmation message unless an appointment was successfully created in the calendar. Never create a duplicate or overlapping appointment.`;

let readyPromise: Promise<void> | null = null;

export function ensureAiBookingBehavior(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    // Add the calendar-first policy to the global AI prompt and any line-specific
    // prompts. The marker makes this safe to run on every deployment.
    await db.execute(sql`
      UPDATE ai_voice_config
      SET system_prompt = system_prompt || E'\n\n' || ${BOOKING_POLICY},
          updated_at = NOW()
      WHERE position(${POLICY_MARKER} in system_prompt) = 0
    `);

    await db.execute(sql`
      UPDATE phone_numbers
      SET ai_system_prompt = ai_system_prompt || E'\n\n' || ${BOOKING_POLICY},
          updated_at = NOW()
      WHERE ai_system_prompt IS NOT NULL
        AND position(${POLICY_MARKER} in ai_system_prompt) = 0
    `);

    // The voice agent currently creates the appointment as its calendar action.
    // This guard makes that operation an actual availability check: an overlapping
    // active appointment is rejected before it can be confirmed or messaged.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION callingagent_prevent_appointment_overlap()
      RETURNS trigger AS $$
      DECLARE
        requested_end TIMESTAMPTZ;
      BEGIN
        IF NEW.company_id IS NULL OR NEW.status NOT IN ('scheduled', 'confirmed') THEN
          RETURN NEW;
        END IF;

        requested_end := COALESCE(NEW.end_time, NEW.start_time + interval '90 minutes');

        IF EXISTS (
          SELECT 1
          FROM appointments existing
          WHERE existing.company_id = NEW.company_id
            AND existing.id <> COALESCE(NEW.id, -1)
            AND existing.status IN ('scheduled', 'confirmed')
            AND (
              (NEW.resource_id IS NOT NULL AND existing.resource_id = NEW.resource_id)
              OR (NEW.resource_id IS NULL AND existing.resource_id IS NULL)
            )
            AND existing.start_time < requested_end
            AND COALESCE(existing.end_time, existing.start_time + interval '90 minutes') > NEW.start_time
        ) THEN
          RAISE EXCEPTION 'Requested appointment time is unavailable';
        END IF;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await db.execute(sql`
      DROP TRIGGER IF EXISTS callingagent_prevent_appointment_overlap_trigger ON appointments
    `);

    await db.execute(sql`
      CREATE TRIGGER callingagent_prevent_appointment_overlap_trigger
      BEFORE INSERT OR UPDATE OF company_id, resource_id, start_time, end_time, status
      ON appointments
      FOR EACH ROW
      EXECUTE FUNCTION callingagent_prevent_appointment_overlap()
    `);

    logger.info("Calendar-first AI booking behavior ready");
  })().catch((error) => {
    readyPromise = null;
    logger.error({ err: error?.message }, "Failed to prepare AI booking behavior");
    throw error;
  });

  return readyPromise;
}
