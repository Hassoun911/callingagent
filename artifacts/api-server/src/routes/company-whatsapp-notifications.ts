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

  // Successful appointment bookings send their own detailed admin template at the
  // moment the appointment is created. Avoid sending a duplicate post-call alert.
  if (log.callType === "Appointment") {
    logger.info({ callSid, companyId: phone.companyId }, "Skipping generic post-call template for appointment; booking notification owns this event");
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
        status: log.status,
      },
    });
    logger.info({ callSid, companyId: phone.companyId, adminWhatsapp }, "Company admin post-call WhatsApp template sent");
  } catch (error: any) {
    logger.error({ callSid, companyId: phone.companyId, err: error?.message }, "Company admin post-call WhatsApp template failed");
  }
}

router.use("/twilio/status", (req: any, _res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const status = String(req.body?.CallStatus ?? "");
  if (callSid && TERMINAL.has(status)) {
    setTimeout(() => {
      sendCompanyWhatsapp(callSid).catch(error => logger.error({ callSid, err: error?.message }, "Deferred company WhatsApp notification failed"));
    }, 0);
  }
  next();
});

export default router;
