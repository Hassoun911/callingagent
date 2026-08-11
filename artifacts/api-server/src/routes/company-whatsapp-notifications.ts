import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  aiVoiceConfigTable,
  callLogsTable,
  companiesTable,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendAdminWhatsappTemplate } from "../lib/admin-whatsapp-template";

const router: IRouter = Router();
const TERMINAL = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);

// Protect against two terminal callbacks arriving at nearly the same time before
// the main status handler has persisted the first one. Database status provides
// durable de-duplication across restarts; this set covers the small in-process race.
const terminalAlertsInFlight = new Set<string>();

/**
 * The old aiVoiceConfig.adminNotifyPhone notifier is global, so it cannot safely
 * route notifications in a multi-company system. Disable that legacy destination
 * on boot. Company-specific admin notifications are sent with the approved
 * WhatsApp Content Template instead.
 */
export async function disableLegacyGlobalAdminSms(): Promise<void> {
  try {
    const configs = await db.select().from(aiVoiceConfigTable);
    for (const config of configs) {
      if (config.adminNotifyPhone) {
        await db.update(aiVoiceConfigTable)
          .set({ adminNotifyPhone: null })
          .where(eq(aiVoiceConfigTable.id, config.id));
      }
    }
    logger.info("Legacy global admin SMS destination disabled; using per-company WhatsApp templates");
  } catch (error: any) {
    logger.warn({ err: error?.message }, "Could not disable legacy global admin SMS destination");
  }
}

async function sendCompanyWhatsapp(callSid: string): Promise<void> {
  // Give the main status handler time to persist its AI summary/classification.
  await new Promise(resolve => setTimeout(resolve, 1200));

  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, callSid));
  if (!log?.phoneNumberId) return;

  const [phone] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, log.phoneNumberId));
  if (!phone?.companyId) return;

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, phone.companyId));
  const adminWhatsapp = company?.adminWhatsapp?.trim();
  if (!adminWhatsapp) {
    logger.info({ callSid, companyId: phone.companyId }, "No company admin WhatsApp configured; post-call admin alert skipped");
    return;
  }

  const configuredSender = process.env.TWILIO_WHATSAPP_FROM?.trim();
  const sender = configuredSender || phone.number;
  const caller = log.contactName ?? log.callerIdName ?? log.callerName ?? log.fromNumber ?? "Unknown caller";
  const duration = log.duration && log.duration > 0
    ? `${Math.floor(log.duration / 60)}m ${log.duration % 60}s`
    : "N/A";

  try {
    await sendAdminWhatsappTemplate({
      from: sender,
      to: adminWhatsapp,
      context: {
        companyName: company?.name,
        callerName: caller,
        callerPhone: log.fromNumber,
        duration,
        callType: log.callType,
        location: log.callerLocation,
        summary: log.callSummary,
        action: log.actionRequired,
        appointmentTitle: log.callType === "Appointment" ? "Appointment" : null,
        status: log.status,
      },
    });
    logger.info({ callSid, companyId: phone.companyId, adminWhatsapp }, "Company admin WhatsApp template sent");
  } catch (error: any) {
    logger.error({ callSid, companyId: phone.companyId, err: error?.message }, "Company admin WhatsApp template failed");
  }
}

router.use("/twilio/status", async (req: any, _res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const status = String(req.body?.CallStatus ?? "");

  if (!callSid || !TERMINAL.has(status)) {
    next();
    return;
  }

  try {
    // IMPORTANT: this middleware runs before the main /twilio/status handler.
    // A legitimate first terminal callback should therefore find the stored call
    // in a non-terminal state (normally "in-progress"). If the DB row is already
    // terminal, Twilio is retrying/replaying an old callback and we must NOT send
    // another "new call" WhatsApp alert.
    const [existing] = await db
      .select({ status: callLogsTable.status, createdAt: callLogsTable.createdAt })
      .from(callLogsTable)
      .where(eq(callLogsTable.twilioCallSid, callSid));

    if (!existing) {
      logger.warn({ callSid, status }, "Skipping company WhatsApp alert: status callback has no matching call log");
      next();
      return;
    }

    if (existing.status && TERMINAL.has(existing.status)) {
      logger.info({ callSid, incomingStatus: status, storedStatus: existing.status }, "Skipping duplicate/stale terminal WhatsApp alert");
      next();
      return;
    }

    // A normal AI call is only a few minutes. This extra guard prevents an
    // unexpectedly delayed webhook from resurrecting a very old call as a new alert.
    const ageMs = existing.createdAt ? Date.now() - new Date(existing.createdAt).getTime() : 0;
    if (ageMs > 30 * 60 * 1000) {
      logger.warn({ callSid, status, ageMinutes: Math.round(ageMs / 60000) }, "Skipping stale terminal WhatsApp alert for old call");
      next();
      return;
    }

    if (terminalAlertsInFlight.has(callSid)) {
      logger.info({ callSid, status }, "Skipping concurrent duplicate terminal WhatsApp alert");
      next();
      return;
    }

    terminalAlertsInFlight.add(callSid);
    setTimeout(() => {
      sendCompanyWhatsapp(callSid)
        .catch(error => logger.error({ callSid, err: error?.message }, "Deferred company WhatsApp notification failed"))
        .finally(() => terminalAlertsInFlight.delete(callSid));
    }, 0);
  } catch (error: any) {
    // Notification protection must never block Twilio's actual status handler.
    logger.error({ callSid, status, err: error?.message }, "Could not validate company WhatsApp status callback");
  }

  next();
});

export default router;
