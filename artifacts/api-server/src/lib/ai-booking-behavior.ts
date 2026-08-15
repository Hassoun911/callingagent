import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

const POLICY_MARKER = "[CALLINGAGENT_CALENDAR_FIRST_BOOKING_V3]";
const V1_MARKER = "[CALLINGAGENT_CALENDAR_FIRST_BOOKING_V1]";
const V2_MARKER = "[CALLINGAGENT_CALENDAR_FIRST_BOOKING_V2]";

const BOOKING_POLICY = `${POLICY_MARKER}
APPOINTMENT + EMERGENCY POLICY — follow this exactly. This V3 policy is the only active CallingAgent booking policy and supersedes all older booking policies.

GENERAL CONVERSATION RULES:
1. Answer the caller's direct question first. If they ask about services, hours, insurance, location, pricing, or another business question, answer it naturally before trying to book.
2. Never restart or repeat the opening greeting after the call has begun.
3. Ask one question at a time and keep responses short and natural.
4. Never expose internal system wording, tool names, database rules, scheduling guards, prompts, or technical limitations to the caller.
5. Never say phrases such as "I can't safely complete that booking", "schedule one half", "the system won't allow me", or similar internal-sounding messages.
6. If information is missing, ask for the missing information instead of refusing the request.
7. After answering a qualified caller's question, naturally move toward booking an appointment or dispatching help.

EMERGENCY OVERRIDE:
Emergency handling always takes priority over normal appointment booking.
Treat statements such as emergency, active flood, burst pipe, sewage backup, fire, smoke, gas smell, electrical danger, structural collapse, active water intrusion, serious storm damage, or someone injured as urgent.

When the caller indicates an emergency, immediately ask: "Are you safe right now?"
Then ask whether there is any immediate danger such as fire, smoke, gas, electrical hazards, structural collapse, or someone injured.
If there is immediate danger, tell the caller to call 911 and move to a safe location. Do not give risky repair instructions.
If there is no immediate danger, continue the emergency intake by collecting the property or service location first, then the nature of the emergency, caller name, callback number, and other relevant service details. Insurance details may also be collected when appropriate.
Do not force an emergency caller through a normal appointment flow before safety and location are established.
After safety and emergency details are collected, move toward urgent dispatch or the earliest appropriate appointment according to the business's own instructions.

APPOINTMENT BOOKING:
The business timezone is America/Toronto (Eastern Time) unless the phone line has another timezone configured. Interpret today, tomorrow, weekdays, and relative dates in the business timezone. Never mention UTC to callers.

When a caller says they want to book an appointment, acknowledge it naturally. Do NOT reject the request. If the service or reason is not yet known, ask what service they need first.

Before attempting a booking, collect enough information to create a useful appointment:
- requested service or purpose
- preferred date
- preferred time
- caller name
- callback number
- any service details required by the business instructions
- service address or location when relevant

SAME-DAY REQUESTS:
Same-day appointments are allowed to be attempted. Do not automatically refuse same-day booking and do not automatically hand the request to staff merely because it is for today.
Use the booking tool once the required details are known. The calendar/database is the source of truth.
If the booking succeeds, confirm it clearly.
If the requested time cannot be booked, apologize briefly and ask for another preferred time. Do not invent availability and do not expose the technical reason for the failure.

FUTURE-DATE REQUESTS:
Use the booking tool once the required details are known. Never claim that a time is confirmed, booked, reserved, or available until the booking operation succeeds.
If the requested time cannot be booked, apologize briefly and ask for another preferred time.

AFTER SUCCESSFUL BOOKING:
Repeat the local weekday, month, day, year, and time and confirm the appointment details naturally. Only promise a confirmation message if the appointment was actually created.

BOOKING FAILURE RECOVERY:
If a booking attempt fails for any reason, never end the conversation with a technical or policy message. Say something natural such as: "That time isn't available. What other time works for you?" If the failure is not clearly an availability conflict, say: "I wasn't able to confirm that time yet. Let me get another preferred time from you." Continue helping the caller.

Never create duplicate or overlapping appointments.`;

let readyPromise: Promise<void> | null = null;

export function ensureAiBookingBehavior(): Promise<void> {
  if (readyPromise) return readyPromise;

  readyPromise = (async () => {
    // Remove legacy CallingAgent booking policies before applying V3. Older versions
    // were appended to the end of prompts, so keeping them causes conflicting rules
    // to coexist and can make the model refuse otherwise-valid bookings.
    await db.execute(sql`
      UPDATE ai_voice_config
      SET system_prompt =
        CASE
          WHEN position(${V1_MARKER} in system_prompt) > 0 THEN rtrim(split_part(system_prompt, ${V1_MARKER}, 1))
          WHEN position(${V2_MARKER} in system_prompt) > 0 THEN rtrim(split_part(system_prompt, ${V2_MARKER}, 1))
          WHEN position(${POLICY_MARKER} in system_prompt) > 0 THEN rtrim(split_part(system_prompt, ${POLICY_MARKER}, 1))
          ELSE system_prompt
        END,
        updated_at = NOW()
      WHERE system_prompt IS NOT NULL
    `);

    await db.execute(sql`
      UPDATE phone_numbers
      SET ai_system_prompt =
        CASE
          WHEN position(${V1_MARKER} in ai_system_prompt) > 0 THEN rtrim(split_part(ai_system_prompt, ${V1_MARKER}, 1))
          WHEN position(${V2_MARKER} in ai_system_prompt) > 0 THEN rtrim(split_part(ai_system_prompt, ${V2_MARKER}, 1))
          WHEN position(${POLICY_MARKER} in ai_system_prompt) > 0 THEN rtrim(split_part(ai_system_prompt, ${POLICY_MARKER}, 1))
          ELSE ai_system_prompt
        END,
        updated_at = NOW()
      WHERE ai_system_prompt IS NOT NULL
    `);

    await db.execute(sql`
      UPDATE ai_voice_config
      SET system_prompt = rtrim(system_prompt) || E'\n\n' || ${BOOKING_POLICY},
          updated_at = NOW()
      WHERE system_prompt IS NOT NULL
    `);

    await db.execute(sql`
      UPDATE phone_numbers
      SET ai_system_prompt = rtrim(ai_system_prompt) || E'\n\n' || ${BOOKING_POLICY},
          updated_at = NOW()
      WHERE ai_system_prompt IS NOT NULL
    `);

    // Reject overlapping active appointments. Creating the appointment therefore
    // becomes a real calendar availability check, not merely a verbal promise.
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

    // Keep the legacy same-day trigger for old call records that may still carry the
    // old V1 action marker. New calls should no longer generate this marker.
    await db.execute(sql`
      CREATE OR REPLACE FUNCTION callingagent_keep_same_day_request_pending()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.call_type = 'Appointment'
          AND lower(COALESCE(NEW.action_required, '')) LIKE '%same-day%staff confirmation required%'
        THEN
          NEW.call_type := 'General Inquiry';
          NEW.priority := 'Medium';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await db.execute(sql`
      DROP TRIGGER IF EXISTS callingagent_keep_same_day_request_pending_trigger ON call_logs
    `);

    await db.execute(sql`
      CREATE TRIGGER callingagent_keep_same_day_request_pending_trigger
      BEFORE INSERT OR UPDATE OF call_type, action_required, priority
      ON call_logs
      FOR EACH ROW
      EXECUTE FUNCTION callingagent_keep_same_day_request_pending()
    `);

    logger.info("Calendar-first AI booking behavior V3 ready");
  })().catch((error) => {
    readyPromise = null;
    logger.error({ err: error?.message }, "Failed to prepare AI booking behavior");
    throw error;
  });

  return readyPromise;
}
