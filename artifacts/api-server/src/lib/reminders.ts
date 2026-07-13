import { gte, lte, and, inArray, eq } from "drizzle-orm";
import { db, appointmentsTable, companiesTable, phoneNumbersTable } from "@workspace/db";
import { sendReminderNotifications } from "./notifications";
import { logger } from "./logger";

const ACTIVE_STATUSES = ["scheduled", "confirmed"];

// Reminder windows — how far in advance to fire each reminder
const REMINDERS: Array<{ key: string; windowMs: number; label: string }> = [
  { key: "24h", windowMs: 24 * 60 * 60 * 1000, label: "24 hours" },
  { key: "1h",  windowMs: 60 * 60 * 1000,       label: "1 hour"  },
];

async function runReminderCheck() {
  const now = new Date();

  for (const reminder of REMINDERS) {
    const windowEnd = new Date(now.getTime() + reminder.windowMs + 5 * 60 * 1000); // +5 min buffer

    // Find upcoming appointments in this window that haven't received this reminder yet
    let candidates: typeof appointmentsTable.$inferSelect[] = [];
    try {
      candidates = await db
        .select()
        .from(appointmentsTable)
        .where(
          and(
            inArray(appointmentsTable.status, ACTIVE_STATUSES),
            gte(appointmentsTable.startTime, now),
            lte(appointmentsTable.startTime, windowEnd),
          )
        );
    } catch (err: any) {
      logger.warn({ err: err?.message, reminder: reminder.key }, "Reminder query failed");
      continue;
    }

    // Filter to only those that haven't received this reminder
    const pending = candidates.filter(a => !a.remindersSent.includes(reminder.key));
    if (pending.length === 0) continue;

    logger.info({ count: pending.length, reminder: reminder.key }, "Sending reminders");

    for (const appt of pending) {
      try {
        // Fetch company and phone number for context
        let companyName = "the business";
        let companyAdminEmail: string | null = null;
        let companyAdminWhatsapp: string | null = null;
        let twilioFromNumber: string | null = null;

        if (appt.companyId) {
          const [co] = await db.select().from(companiesTable).where(eq(companiesTable.id, appt.companyId));
          if (co) {
            companyName = co.name;
            companyAdminEmail = co.adminNotificationEmail || co.email || null;
            companyAdminWhatsapp = co.adminWhatsapp || null;
          }
        }

        if (appt.phoneNumberId) {
          const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, appt.phoneNumberId));
          if (pn) twilioFromNumber = pn.number;
        } else if (appt.companyId) {
          const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.companyId, appt.companyId));
          if (pn) twilioFromNumber = pn.number;
        }

        await sendReminderNotifications({
          customerName: appt.customerName,
          customerPhone: appt.customerPhone,
          customerEmail: appt.customerEmail,
          title: appt.title,
          notes: appt.notes,
          startTime: appt.startTime,
          endTime: appt.endTime,
          companyName,
          companyAdminEmail,
          companyAdminWhatsapp,
          twilioFromNumber,
          reminderLabel: reminder.label,
        });

        // Mark this reminder as sent
        await db
          .update(appointmentsTable)
          .set({ remindersSent: [...appt.remindersSent, reminder.key] })
          .where(eq(appointmentsTable.id, appt.id));

        logger.info({ appointmentId: appt.id, reminder: reminder.key }, "Reminder sent");
      } catch (err: any) {
        logger.warn({ err: err?.message, appointmentId: appt.id, reminder: reminder.key }, "Failed to send reminder");
      }
    }
  }
}

export function startReminderPoller() {
  const INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

  // Run once at startup (after a 30s delay to let the server settle)
  setTimeout(() => {
    runReminderCheck().catch(err =>
      logger.warn({ err: err?.message }, "Initial reminder check failed")
    );
  }, 30_000);

  // Then on a regular interval
  setInterval(() => {
    runReminderCheck().catch(err =>
      logger.warn({ err: err?.message }, "Scheduled reminder check failed")
    );
  }, INTERVAL_MS);

  logger.info({ intervalMs: INTERVAL_MS }, "Reminder poller started");
}
