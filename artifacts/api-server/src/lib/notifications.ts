import nodemailer from "nodemailer";
import twilio from "twilio";
import { logger } from "./logger";

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
}

function formatDateTime(dt: Date): string {
  return dt.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export interface ReminderNotificationData extends AppointmentNotificationData {
  reminderLabel: string; // e.g. "24 hours" or "1 hour"
}

export async function sendReminderNotifications(data: ReminderNotificationData): Promise<void> {
  const {
    customerName, customerPhone, customerEmail,
    title, notes, startTime, endTime,
    companyName, companyAdminEmail, companyAdminWhatsapp,
    twilioFromNumber, reminderLabel,
  } = data;

  const dateStr = formatDateTime(startTime);
  const endStr = endTime ? ` – ${formatDateTime(endTime)}` : "";
  const notesLine = notes ? `\nDetails: ${notes}` : "";

  const transport = getEmailTransport();
  const twilioClient = getTwilioClient();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "";

  // Customer SMS reminder
  if (twilioClient && customerPhone && twilioFromNumber) {
    try {
      const body = [
        `Reminder: Your ${title} with ${companyName} is in ${reminderLabel}.`,
        `Date/Time: ${dateStr}${endStr}`,
        notes ? `Details: ${notes}` : "",
        `To reschedule or cancel, call us back.`,
        `Reply STOP to opt out.`,
      ].filter(Boolean).join("\n");
      await twilioClient.messages.create({ from: twilioFromNumber, to: customerPhone, body });
      logger.info({ to: customerPhone, reminder: reminderLabel }, "Reminder SMS sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send reminder SMS");
    }
  }

  // Customer email reminder
  if (transport && customerEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: customerEmail,
        subject: `Reminder: ${title} in ${reminderLabel} — ${companyName}`,
        text: [
          `Hi ${customerName},`,
          ``,
          `This is a reminder that your ${title} with ${companyName} is coming up in ${reminderLabel}.`,
          ``,
          `Date/Time: ${dateStr}${endStr}`,
          notesLine,
          ``,
          `To reschedule or cancel, please call us.`,
        ].filter(Boolean).join("\n"),
        html: `
          <p>Hi <strong>${customerName}</strong>,</p>
          <p>This is a reminder that your appointment is coming up in <strong>${reminderLabel}</strong>.</p>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td><strong>${title}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">With</td><td>${companyName}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Date/Time</td><td>${dateStr}${endStr}</td></tr>
            ${notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Details</td><td>${notes}</td></tr>` : ""}
          </table>
          <p style="color:#666;font-size:12px">To reschedule or cancel, please call us.</p>
        `,
      });
      logger.info({ to: customerEmail }, "Reminder email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send reminder email");
    }
  }

  // Admin WhatsApp reminder alert
  if (twilioClient && companyAdminWhatsapp && twilioFromNumber) {
    try {
      const whatsappFrom = `whatsapp:${twilioFromNumber}`;
      const whatsappTo = `whatsapp:${companyAdminWhatsapp}`;
      const body = [
        `⏰ Upcoming in ${reminderLabel} — ${companyName}`,
        `Customer: ${customerName} (${customerPhone})`,
        `Appointment: ${title}`,
        `Date/Time: ${dateStr}${endStr}`,
      ].filter(Boolean).join("\n");
      await twilioClient.messages.create({ from: whatsappFrom, to: whatsappTo, body });
      logger.info({ to: whatsappTo }, "Admin reminder WhatsApp sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send admin reminder WhatsApp");
    }
  }
}

export async function sendRescheduleNotifications(data: AppointmentNotificationData & { oldStartTime: Date }): Promise<void> {
  const {
    customerName, customerPhone, customerEmail,
    title, notes, startTime, endTime,
    companyName, companyAdminEmail, companyAdminWhatsapp,
    twilioFromNumber, oldStartTime,
  } = data;

  const newDateStr = formatDateTime(startTime);
  const endStr = endTime ? ` – ${formatDateTime(endTime)}` : "";
  const oldDateStr = formatDateTime(oldStartTime);
  const notesLine = notes ? `\nDetails: ${notes}` : "";

  const transport = getEmailTransport();
  const twilioClient = getTwilioClient();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "";

  // Customer SMS
  if (twilioClient && customerPhone && twilioFromNumber) {
    try {
      const body = [
        `Hi ${customerName}, your ${title} with ${companyName} has been rescheduled.`,
        `New Date/Time: ${newDateStr}${endStr}`,
        notes ? `Details: ${notes}` : "",
        `Reply STOP to opt out.`,
      ].filter(Boolean).join("\n");
      await twilioClient.messages.create({ from: twilioFromNumber, to: customerPhone, body });
      logger.info({ to: customerPhone }, "Reschedule SMS sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send reschedule SMS");
    }
  }

  // Customer email
  if (transport && customerEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: customerEmail,
        subject: `Appointment Rescheduled: ${title} — ${companyName}`,
        text: [
          `Hi ${customerName},`,
          ``,
          `Your appointment has been rescheduled.`,
          ``,
          `Appointment: ${title}`,
          `With: ${companyName}`,
          `Previous: ${oldDateStr}`,
          `New Date/Time: ${newDateStr}${endStr}`,
          notesLine,
        ].filter(Boolean).join("\n"),
        html: `
          <p>Hi <strong>${customerName}</strong>,</p>
          <p>Your appointment has been <strong>rescheduled</strong>.</p>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td><strong>${title}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">With</td><td>${companyName}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Previous</td><td style="text-decoration:line-through;color:#999">${oldDateStr}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">New Date/Time</td><td><strong>${newDateStr}${endStr}</strong></td></tr>
            ${notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Details</td><td>${notes}</td></tr>` : ""}
          </table>
        `,
      });
      logger.info({ to: customerEmail }, "Reschedule email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send reschedule email");
    }
  }

  // Admin WhatsApp
  if (twilioClient && companyAdminWhatsapp && twilioFromNumber) {
    try {
      const whatsappFrom = `whatsapp:${twilioFromNumber}`;
      const whatsappTo = `whatsapp:${companyAdminWhatsapp}`;
      const body = [
        `🔄 Appointment Rescheduled — ${companyName}`,
        `Customer: ${customerName} (${customerPhone})`,
        `Appointment: ${title}`,
        `Was: ${oldDateStr}`,
        `Now: ${newDateStr}${endStr}`,
      ].join("\n");
      await twilioClient.messages.create({ from: whatsappFrom, to: whatsappTo, body });
      logger.info({ to: whatsappTo }, "Admin reschedule WhatsApp sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send admin reschedule WhatsApp");
    }
  }

  // Admin email
  if (transport && companyAdminEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: companyAdminEmail,
        subject: `Appointment Rescheduled: ${title} — ${customerName}`,
        text: [
          `An appointment has been rescheduled via AI call for ${companyName}.`,
          ``,
          `Customer: ${customerName} (${customerPhone})`,
          `Appointment: ${title}`,
          `Previous: ${oldDateStr}`,
          `New Date/Time: ${newDateStr}${endStr}`,
        ].join("\n"),
        html: `
          <h2>Appointment Rescheduled — ${companyName}</h2>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td><td><strong>${customerName}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${customerPhone}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td>${title}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Previous</td><td style="text-decoration:line-through;color:#999">${oldDateStr}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">New Date/Time</td><td><strong>${newDateStr}${endStr}</strong></td></tr>
          </table>
        `,
      });
      logger.info({ to: companyAdminEmail }, "Admin reschedule email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send admin reschedule email");
    }
  }
}

export async function sendCancellationNotifications(data: AppointmentNotificationData): Promise<void> {
  const {
    customerName, customerPhone, customerEmail,
    title, startTime, endTime,
    companyName, companyAdminEmail, companyAdminWhatsapp,
    twilioFromNumber,
  } = data;

  const dateStr = formatDateTime(startTime);
  const endStr = endTime ? ` – ${formatDateTime(endTime)}` : "";

  const transport = getEmailTransport();
  const twilioClient = getTwilioClient();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "";

  // Customer SMS
  if (twilioClient && customerPhone && twilioFromNumber) {
    try {
      const body = [
        `Hi ${customerName}, your ${title} with ${companyName} on ${dateStr} has been cancelled.`,
        `To rebook, please call us.`,
        `Reply STOP to opt out.`,
      ].join("\n");
      await twilioClient.messages.create({ from: twilioFromNumber, to: customerPhone, body });
      logger.info({ to: customerPhone }, "Cancellation SMS sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send cancellation SMS");
    }
  }

  // Customer email
  if (transport && customerEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: customerEmail,
        subject: `Appointment Cancelled: ${title} — ${companyName}`,
        text: [
          `Hi ${customerName},`,
          ``,
          `Your appointment has been cancelled.`,
          ``,
          `Appointment: ${title}`,
          `With: ${companyName}`,
          `Date/Time: ${dateStr}${endStr}`,
          ``,
          `To rebook, please contact us by phone.`,
        ].join("\n"),
        html: `
          <p>Hi <strong>${customerName}</strong>,</p>
          <p>Your appointment has been <strong>cancelled</strong>.</p>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td>${title}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">With</td><td>${companyName}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Date/Time</td><td>${dateStr}${endStr}</td></tr>
          </table>
          <p style="color:#666;font-size:12px">To rebook, please contact us by phone.</p>
        `,
      });
      logger.info({ to: customerEmail }, "Cancellation email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send cancellation email");
    }
  }

  // Admin WhatsApp
  if (twilioClient && companyAdminWhatsapp && twilioFromNumber) {
    try {
      const whatsappFrom = `whatsapp:${twilioFromNumber}`;
      const whatsappTo = `whatsapp:${companyAdminWhatsapp}`;
      const body = [
        `❌ Appointment Cancelled — ${companyName}`,
        `Customer: ${customerName} (${customerPhone})`,
        `Appointment: ${title}`,
        `Was: ${dateStr}${endStr}`,
      ].join("\n");
      await twilioClient.messages.create({ from: whatsappFrom, to: whatsappTo, body });
      logger.info({ to: whatsappTo }, "Admin cancellation WhatsApp sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send admin cancellation WhatsApp");
    }
  }

  // Admin email
  if (transport && companyAdminEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: companyAdminEmail,
        subject: `Appointment Cancelled: ${title} — ${customerName}`,
        text: [
          `An appointment was cancelled via AI call for ${companyName}.`,
          ``,
          `Customer: ${customerName} (${customerPhone})`,
          `Appointment: ${title}`,
          `Date/Time: ${dateStr}${endStr}`,
        ].join("\n"),
        html: `
          <h2>Appointment Cancelled — ${companyName}</h2>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td><td><strong>${customerName}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${customerPhone}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td>${title}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Date/Time</td><td>${dateStr}${endStr}</td></tr>
          </table>
        `,
      });
      logger.info({ to: companyAdminEmail }, "Admin cancellation email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send admin cancellation email");
    }
  }
}

export async function sendBookingNotifications(data: AppointmentNotificationData): Promise<void> {
  const {
    customerName,
    customerPhone,
    customerEmail,
    title,
    notes,
    startTime,
    endTime,
    companyName,
    companyAdminEmail,
    companyAdminWhatsapp,
    twilioFromNumber,
  } = data;

  const dateStr = formatDateTime(startTime);
  const endStr = endTime ? ` – ${formatDateTime(endTime)}` : "";
  const notesLine = notes ? `\nNotes: ${notes}` : "";

  const transport = getEmailTransport();
  const twilioClient = getTwilioClient();
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER || "";

  // ── Admin email ────────────────────────────────────────────────────────────
  const adminEmail = companyAdminEmail;
  if (transport && adminEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: adminEmail,
        subject: `New Booking: ${title} — ${customerName}`,
        text: [
          `New appointment booked via AI call for ${companyName}`,
          ``,
          `Customer: ${customerName}`,
          `Phone: ${customerPhone}`,
          `Email: ${customerEmail || "not provided"}`,
          ``,
          `Appointment: ${title}`,
          `Date/Time: ${dateStr}${endStr}`,
          notesLine,
        ].filter(Boolean).join("\n"),
        html: `
          <h2>New Appointment Booked — ${companyName}</h2>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Customer</td><td><strong>${customerName}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Phone</td><td>${customerPhone}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Email</td><td>${customerEmail || "not provided"}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td>${title}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Date/Time</td><td>${dateStr}${endStr}</td></tr>
            ${notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Notes</td><td>${notes}</td></tr>` : ""}
          </table>
        `,
      });
      logger.info({ to: adminEmail }, "Admin booking email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message, to: adminEmail }, "Failed to send admin booking email");
    }
  }

  // ── Admin WhatsApp ─────────────────────────────────────────────────────────
  if (twilioClient && companyAdminWhatsapp && twilioFromNumber) {
    try {
      const whatsappFrom = `whatsapp:${twilioFromNumber}`;
      const whatsappTo = `whatsapp:${companyAdminWhatsapp}`;
      const body = [
        `📋 New Booking — ${companyName}`,
        `Customer: ${customerName} (${customerPhone})`,
        `Appointment: ${title}`,
        `Date/Time: ${dateStr}${endStr}`,
        notes ? `Notes: ${notes}` : "",
      ].filter(Boolean).join("\n");
      await twilioClient.messages.create({ from: whatsappFrom, to: whatsappTo, body });
      logger.info({ to: whatsappTo }, "Admin booking WhatsApp sent");
    } catch (err: any) {
      logger.warn({ err: err?.message }, "Failed to send admin booking WhatsApp");
    }
  }

  // ── Customer SMS ───────────────────────────────────────────────────────────
  if (twilioClient && customerPhone && twilioFromNumber) {
    try {
      const body = [
        `Hi ${customerName}, your appointment has been confirmed.`,
        `${title} with ${companyName}`,
        `Date/Time: ${dateStr}${endStr}`,
        notes ? `Details: ${notes}` : "",
        `Reply STOP to opt out.`,
      ].filter(Boolean).join("\n");
      await twilioClient.messages.create({ from: twilioFromNumber, to: customerPhone, body });
      logger.info({ to: customerPhone }, "Customer booking SMS sent");
    } catch (err: any) {
      logger.warn({ err: err?.message, to: customerPhone }, "Failed to send customer booking SMS");
    }
  }

  // ── Customer email ─────────────────────────────────────────────────────────
  if (transport && customerEmail) {
    try {
      await transport.sendMail({
        from: fromEmail,
        to: customerEmail,
        subject: `Appointment Confirmed: ${title}`,
        text: [
          `Hi ${customerName},`,
          ``,
          `Your appointment has been confirmed.`,
          ``,
          `Appointment: ${title}`,
          `With: ${companyName}`,
          `Date/Time: ${dateStr}${endStr}`,
          notesLine,
          ``,
          `If you need to cancel or reschedule, please contact us by phone.`,
        ].filter(Boolean).join("\n"),
        html: `
          <p>Hi <strong>${customerName}</strong>,</p>
          <p>Your appointment has been confirmed.</p>
          <table style="border-collapse:collapse;font-family:sans-serif;font-size:14px">
            <tr><td style="padding:4px 12px 4px 0;color:#666">Appointment</td><td><strong>${title}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">With</td><td>${companyName}</td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#666">Date/Time</td><td>${dateStr}${endStr}</td></tr>
            ${notes ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Details</td><td>${notes}</td></tr>` : ""}
          </table>
          <p style="color:#666;font-size:12px">To cancel or reschedule, please contact us by phone.</p>
        `,
      });
      logger.info({ to: customerEmail }, "Customer booking email sent");
    } catch (err: any) {
      logger.warn({ err: err?.message, to: customerEmail }, "Failed to send customer booking email");
    }
  }
}
