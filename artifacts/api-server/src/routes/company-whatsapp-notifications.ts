import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import twilio from "twilio";
import {
  db,
  aiVoiceConfigTable,
  callLogsTable,
  companiesTable,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const TERMINAL = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);

function client() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function normalizeWhatsapp(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

/**
 * The old aiVoiceConfig.adminNotifyPhone notifier is global, so it cannot safely
 * route notifications in a multi-company system. Disable that legacy destination
 * on boot. Company-specific admin notifications are handled below and booking
 * confirmations are handled by sendBookingNotifications().
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
    logger.info("Legacy global admin SMS destination disabled; using per-company WhatsApp notifications");
  } catch (error: any) {
    logger.warn({ err: error?.message }, "Could not disable legacy global admin SMS destination");
  }
}

async function sendCompanyWhatsapp(callSid: string): Promise<void> {
  // Give the main status handler time to write its AI summary/classification.
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

  // Successful appointment bookings already send a detailed booking-specific
  // WhatsApp message at the moment the appointment is inserted. Do not duplicate it.
  if (log.callType === "Appointment") {
    logger.info({ callSid, companyId: phone.companyId }, "Skipping generic post-call WhatsApp for appointment; booking notification already owns this event");
    return;
  }

  const twilioClient = client();
  if (!twilioClient) return;

  const configuredSender = process.env.TWILIO_WHATSAPP_FROM?.trim();
  const from = configuredSender
    ? normalizeWhatsapp(configuredSender)
    : normalizeWhatsapp(phone.number);
  const to = normalizeWhatsapp(adminWhatsapp);

  const caller = log.contactName ?? log.callerIdName ?? log.callerName ?? log.fromNumber ?? "Unknown caller";
  const duration = log.duration && log.duration > 0
    ? `${Math.floor(log.duration / 60)}m ${log.duration % 60}s`
    : "N/A";
  const isUrgent = log.callType === "Emergency" || log.priority === "High";

  const body = [
    isUrgent ? `🚨 URGENT CALL — ${company?.name ?? "Company"}` : `📞 New Call — ${company?.name ?? "Company"}`,
    `Caller: ${caller}`,
    `Duration: ${duration}`,
    log.callType ? `Type: ${log.callType}` : "",
    log.callerLocation ? `Location: ${log.callerLocation}` : "",
    log.callSummary ? `Summary: ${log.callSummary}` : "",
    log.actionRequired ? `Action: ${log.actionRequired}` : "",
  ].filter(Boolean).join("\n");

  try {
    await twilioClient.messages.create({ from, to, body });
    logger.info({ callSid, companyId: phone.companyId, to }, "Company admin WhatsApp call alert sent");
  } catch (error: any) {
    logger.error({ callSid, companyId: phone.companyId, err: error?.message }, "Company admin WhatsApp call alert failed");
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
