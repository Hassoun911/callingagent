import nodemailer from "nodemailer";
import twilio from "twilio";
import { logger } from "./logger";
import { sendAdminWhatsappTemplate } from "./admin-whatsapp-template";

const EASTERN_TZ = "America/Toronto";

function getEmailTransport(): nodemailer.Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

function getTwilioClient(): twilio.Twilio | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

function normalizeSmsNumber(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : trimmed;
}

function adminWhatsappSender(twilioFromNumber?: string | null): string | null {
  return process.env.TWILIO_WHATSAPP_FROM?.trim() || twilioFromNumber?.trim() || null;
}

export interface AppointmentNotificationData {
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  title: string;
  notes?: string | null;
  startTime: Date;
  endTime?: Date | null;
  companyName: string;
  companyAdminEmail?: string | null;
  companyAdminWhatsapp?: string | null;
  twilioFromNumber?: string | null;
  timezone?: string | null;
}

function formatDateTime(dt: Date, timezone = EASTERN_TZ): string {
  // All customer/admin booking communications use the Eastern business clock.
  // Keep the display label stable as EST as requested by the business owner,
  // while America/Toronto keeps the actual local clock aligned year-round.
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || EASTERN_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(dt);
  return `${formatted} EST`;
}

async function sendAdminTemplate(data: AppointmentNotificationData, status: string, action?: string): Promise<void> {
  const sender = adminWhatsappSender(data.twilioFromNumber);
  if (!data.companyAdminWhatsapp || !sender) {
    logger.info({ companyName: data.companyName }, "Admin WhatsApp template skipped: destination or sender missing");
    return;
  }

  const dateStr = formatDateTime(data.startTime, data.timezone || EASTERN_TZ);
  const endStr = data.endTime ? ` – ${formatDateTime(data.endTime, data.timezone || EASTERN_TZ)}` : "";

  try {
    await sendAdminWhatsappTemplate({
      from: sender,
      to: data.companyAdminWhatsapp,
      context: {
        companyName: data.companyName,
        callerName: data.customerName,
        callerPhone: normalizeSmsNumber(data.customerPhone),
        callType: "Appointment",
        summary: data.notes || data.title,
        action: action || status,
        appointmentTitle: data.title,
        appointmentDateTime: `${dateStr}${endStr}`,
        status,
      },
    });
    logger.info({ to: data.companyAdminWhatsapp, status }, "Admin appointment WhatsApp template sent");
  } catch (err: any) {
    logger.error({ err: err?.message, to: data.companyAdminWhatsapp, status }, "Admin appointment WhatsApp template failed");
  }
}

async function sendCustomerSms(data: AppointmentNotificationData, body: string, logLabel: string): Promise<void> {
  const client = getTwilioClient();
  if (!client || !data.customerPhone || !data.twilioFromNumber) {
    logger.warn({ customerPhone: data.customerPhone, from: data.twilioFromNumber }, `${logLabel} skipped: Twilio, customer, or sender missing`);
    return;
  }

  const to = normalizeSmsNumber(data.customerPhone);
  const from = normalizeSmsNumber(data.twilioFromNumber);
  try {
    const result = await client.messages.create({ from, to, body });
    logger.info({ to, from, sid: result.sid }, `${logLabel} sent`);
  } catch (err: any) {
    logger.error({ err: err?.message, code: err?.code, to, from }, `${logLabel} failed`);
  }
}

async function sendAdminEmail(data: AppointmentNotificationData, subject: string, heading: string, extraRows: string[] = []): Promise<void> {
  if (!data.companyAdminEmail) return;
  const transport = getEmailTransport();
  if (!transport) return;
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "";
  const dateStr = formatDateTime(data.startTime, data.timezone || EASTERN_TZ);
  const endStr = data.endTime ? ` – ${formatDateTime(data.endTime, data.timezone || EASTERN_TZ)}` : "";
  const rows = [
    `<tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td><td><strong>${data.customerName}</strong></td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${normalizeSmsNumber(data.customerPhone)}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${data.customerEmail || "not provided"}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td>${data.title}</td></tr>`,
    `<tr><td style="padding:4px 12px 4px 0;color:#666">Date/Time</td><td><strong>${dateStr}${endStr}</strong></td></tr>`,
    ...extraRows,
  ];
  try {
    await transport.sendMail({
      from: fromEmail,
      to: data.companyAdminEmail,
      subject,
      text: [heading, `Customer: ${data.customerName}`, `Phone: ${normalizeSmsNumber(data.customerPhone)}`, `Appointment: ${data.title}`, `Date/Time: ${dateStr}${endStr}`, data.notes ? `Details: ${data.notes}` : ""].filter(Boolean).join("\n"),
      html: `<h2>${heading}</h2><table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">${rows.join("")}${data.notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Details</td><td>${data.notes}</td></tr>` : ""}</table>`,
    });
    logger.info({ to: data.companyAdminEmail }, "Admin appointment email sent");
  } catch (err: any) {
    logger.warn({ err: err?.message, to: data.companyAdminEmail }, "Admin appointment email failed");
  }
}

export interface ReminderNotificationData extends AppointmentNotificationData {
  reminderLabel: string;
}

export async function sendBookingNotifications(data: AppointmentNotificationData): Promise<void> {
  const dateStr = formatDateTime(data.startTime, data.timezone || EASTERN_TZ);
  const endStr = data.endTime ? ` – ${formatDateTime(data.endTime, data.timezone || EASTERN_TZ)}` : "";
  await Promise.allSettled([
    sendCustomerSms(data, [
      `Hi ${data.customerName}, your appointment is confirmed.`,
      `${data.title} with ${data.companyName}`,
      `Date/Time: ${dateStr}${endStr}`,
      data.notes ? `Details: ${data.notes}` : "",
      "Reply STOP to opt out.",
    ].filter(Boolean).join("\n"), "Customer booking SMS"),
    sendAdminTemplate(data, "Booked", "New appointment booked"),
    sendAdminEmail(data, `New Booking: ${data.title} — ${data.customerName}`, `New Appointment Booked — ${data.companyName}`),
  ]);
}

export async function sendRescheduleNotifications(data: AppointmentNotificationData & { oldStartTime: Date }): Promise<void> {
  const dateStr = formatDateTime(data.startTime, data.timezone || EASTERN_TZ);
  const endStr = data.endTime ? ` – ${formatDateTime(data.endTime, data.timezone || EASTERN_TZ)}` : "";
  const oldDateStr = formatDateTime(data.oldStartTime, data.timezone || EASTERN_TZ);
  await Promise.allSettled([
    sendCustomerSms(data, [
      `Hi ${data.customerName}, your ${data.title} with ${data.companyName} has been rescheduled.`,
      `New Date/Time: ${dateStr}${endStr}`,
      data.notes ? `Details: ${data.notes}` : "",
      "Reply STOP to opt out.",
    ].filter(Boolean).join("\n"), "Customer reschedule SMS"),
    sendAdminTemplate(data, "Rescheduled", `Changed from ${oldDateStr}`),
    sendAdminEmail(data, `Appointment Rescheduled: ${data.title} — ${data.customerName}`, `Appointment Rescheduled — ${data.companyName}`, [
      `<tr><td style="padding:4px 12px 4px 0;color:#666">Previous</td><td>${oldDateStr}</td></tr>`,
    ]),
  ]);
}

export async function sendCancellationNotifications(data: AppointmentNotificationData): Promise<void> {
  const dateStr = formatDateTime(data.startTime, data.timezone || EASTERN_TZ);
  await Promise.allSettled([
    sendCustomerSms(data, [
      `Hi ${data.customerName}, your ${data.title} with ${data.companyName} on ${dateStr} has been cancelled.`,
      "To rebook, please call us.",
      "Reply STOP to opt out.",
    ].join("\n"), "Customer cancellation SMS"),
    sendAdminTemplate(data, "Cancelled", "Appointment cancelled"),
    sendAdminEmail(data, `Appointment Cancelled: ${data.title} — ${data.customerName}`, `Appointment Cancelled — ${data.companyName}`),
  ]);
}

export async function sendReminderNotifications(data: ReminderNotificationData): Promise<void> {
  const dateStr = formatDateTime(data.startTime, data.timezone || EASTERN_TZ);
  const endStr = data.endTime ? ` – ${formatDateTime(data.endTime, data.timezone || EASTERN_TZ)}` : "";
  await Promise.allSettled([
    sendCustomerSms(data, [
      `Reminder: Your ${data.title} with ${data.companyName} is in ${data.reminderLabel}.`,
      `Date/Time: ${dateStr}${endStr}`,
      data.notes ? `Details: ${data.notes}` : "",
      "To reschedule or cancel, call us back.",
      "Reply STOP to opt out.",
    ].filter(Boolean).join("\n"), "Customer reminder SMS"),
    sendAdminTemplate(data, `Reminder ${data.reminderLabel}`, `Upcoming appointment in ${data.reminderLabel}`),
  ]);
}
