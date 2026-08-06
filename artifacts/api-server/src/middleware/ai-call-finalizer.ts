import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import twilio from "twilio";
import {
  aiVoiceConfigTable,
  appointmentsTable,
  callLogsTable,
  companiesTable,
  db,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);
const DEFAULT_TIMEZONE = "America/Toronto";
const RECENT_APPOINTMENT_WINDOW_MS = 20 * 60 * 1000;

type Extraction = {
  callerName: string | null;
  callerEmail: string | null;
  callType: "Emergency" | "Appointment" | "Pricing Inquiry" | "General Inquiry" | null;
  callSummary: string | null;
  actionRequired: string | null;
  priority: "Low" | "Medium" | "High" | null;
  appointmentRequested: boolean;
  appointmentTitle: string | null;
  appointmentStartTime: string | null;
  appointmentNotes: string | null;
};

function openAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

function twilioClient(): twilio.Twilio | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return twilio(accountSid, authToken);
}

function easternNowText(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DEFAULT_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "long",
  }).format(new Date());
}

function formatEastern(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEFAULT_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

function normalizeE164(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.replace(/^whatsapp:/i, "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

async function sendInterruptedBookingSms(params: {
  callerPhone: string | null;
  fromNumber: string | null;
  companyName: string;
}): Promise<void> {
  const client = twilioClient();
  const to = normalizeE164(params.callerPhone);
  const from = normalizeE164(params.fromNumber);
  if (!client || !to || !from) return;

  try {
    await client.messages.create({
      from,
      to,
      body: `We’re sorry—the call ended before we could finish confirming your appointment with ${params.companyName}. Please call us back or reply with your preferred date and time, and our team will follow up. Reply STOP to opt out.`,
    });
    logger.info({ to }, "Interrupted booking recovery SMS sent");
  } catch (error: any) {
    logger.warn({ error: error?.message, to }, "Could not send interrupted booking recovery SMS");
  }
}

async function sendAdminWhatsApp(params: {
  companyName: string;
  callerPhone: string | null;
  callerName: string | null;
  summary: string | null;
  actionRequired: string | null;
  appointmentRequested: boolean;
}): Promise<void> {
  const client = twilioClient();
  if (!client) return;

  const [config] = await db.select().from(aiVoiceConfigTable).limit(1);
  const adminTarget = normalizeE164(config?.adminNotifyPhone);
  const configuredSender = process.env.TWILIO_WHATSAPP_FROM;
  const whatsappFrom = configuredSender
    ? (configuredSender.toLowerCase().startsWith("whatsapp:") ? configuredSender : `whatsapp:${configuredSender}`)
    : null;

  if (!adminTarget) return;
  if (!whatsappFrom) {
    logger.warn({ adminTarget }, "Admin WhatsApp number is configured but TWILIO_WHATSAPP_FROM is missing");
    return;
  }

  const body = [
    `📞 New AI call — ${params.companyName}`,
    `Caller: ${params.callerName || "Unknown"}${params.callerPhone ? ` (${params.callerPhone})` : ""}`,
    params.appointmentRequested ? "Type: Appointment request" : "Type: Call",
    params.summary ? `Summary: ${params.summary}` : "Summary: Call ended before a complete summary was available.",
    params.actionRequired ? `Action: ${params.actionRequired}` : "Action: Review the call log.",
  ].join("\n");

  try {
    await client.messages.create({
      from: whatsappFrom,
      to: `whatsapp:${adminTarget}`,
      body,
    });
    logger.info({ to: adminTarget }, "Admin post-call WhatsApp sent");
  } catch (error: any) {
    logger.warn({ error: error?.message, to: adminTarget }, "Could not send admin post-call WhatsApp");
  }
}

async function appendCallerSpeech(callSid: string, speech: string): Promise<void> {
  const clean = speech.trim();
  if (!callSid || !clean) return;

  const [log] = await db.select().from(callLogsTable)
    .where(eq(callLogsTable.twilioCallSid, callSid));
  if (!log) return;

  const line = `Caller: ${clean}`;
  const current = log.transcription?.trim() ?? "";
  if (current.split("\n").includes(line)) return;

  await db.update(callLogsTable).set({
    transcription: current ? `${current}\n${line}` : line,
    updatedAt: new Date(),
  }).where(eq(callLogsTable.id, log.id));
}

async function extract(transcript: string): Promise<Extraction | null> {
  const client = openAIClient();
  if (!client || !transcript.trim()) return null;

  const result = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    response_format: { type: "json_object" },
    max_tokens: 450,
    messages: [
      {
        role: "system",
        content: [
          "Analyze the caller statements from a business phone call and return JSON only.",
          `The business timezone is ${DEFAULT_TIMEZONE}. The exact current business date and time is ${easternNowText()}.`,
          "Resolve relative dates such as today, tomorrow, and days from now from that exact business date.",
          "Never invent a name, time, date, email, service, or confirmation that the caller did not provide.",
          "appointmentStartTime must be an ISO 8601 datetime with the correct Eastern UTC offset, or null.",
          "Return exactly these keys: callerName, callerEmail, callType, callSummary, actionRequired, priority, appointmentRequested, appointmentTitle, appointmentStartTime, appointmentNotes.",
          "callType is Emergency, Appointment, Pricing Inquiry, General Inquiry, or null. priority is Low, Medium, High, or null.",
        ].join(" "),
      },
      { role: "user", content: transcript },
    ],
  });

  const raw = JSON.parse(result.choices[0]?.message?.content ?? "{}");
  return {
    callerName: typeof raw.callerName === "string" ? raw.callerName : null,
    callerEmail: typeof raw.callerEmail === "string" ? raw.callerEmail : null,
    callType: raw.callType ?? null,
    callSummary: typeof raw.callSummary === "string" ? raw.callSummary : null,
    actionRequired: typeof raw.actionRequired === "string" ? raw.actionRequired : null,
    priority: raw.priority ?? null,
    appointmentRequested: raw.appointmentRequested === true,
    appointmentTitle: typeof raw.appointmentTitle === "string" ? raw.appointmentTitle : null,
    appointmentStartTime: typeof raw.appointmentStartTime === "string" ? raw.appointmentStartTime : null,
    appointmentNotes: typeof raw.appointmentNotes === "string" ? raw.appointmentNotes : null,
  };
}

async function finalize(callSid: string): Promise<void> {
  const [log] = await db.select().from(callLogsTable)
    .where(eq(callLogsTable.twilioCallSid, callSid));
  if (!log?.transcription?.trim()) return;

  const details = await extract(log.transcription);
  if (!details) return;

  let phoneNumber = null;
  if (log.phoneNumberId) {
    [phoneNumber] = await db.select().from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.id, log.phoneNumberId));
  }
  if (!phoneNumber && log.toNumber) {
    [phoneNumber] = await db.select().from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.number, log.toNumber));
  }

  let companyName = phoneNumber?.friendlyName || "the business";
  if (phoneNumber?.companyId) {
    const [company] = await db.select().from(companiesTable)
      .where(eq(companiesTable.id, phoneNumber.companyId));
    if (company?.name) companyName = company.name;
  }

  let actionRequired = details.actionRequired;
  let summary = details.callSummary;
  let appointmentCreated = false;

  if (details.appointmentRequested && phoneNumber?.companyId) {
    const callerPhone = log.direction === "inbound" ? log.fromNumber : log.toNumber;
    const startTime = details.appointmentStartTime ? new Date(details.appointmentStartTime) : null;

    try {
      if (details.callerName && callerPhone && startTime && !Number.isNaN(startTime.getTime())) {
        const companyAppointments = await db.select().from(appointmentsTable)
          .where(eq(appointmentsTable.companyId, phoneNumber.companyId));

        const samePerson = (appointment: typeof appointmentsTable.$inferSelect) =>
          appointment.customerPhone === callerPhone ||
          appointment.customerPhone === phoneNumber.number ||
          appointment.customerName.toLowerCase() === details.callerName!.toLowerCase();

        const exact = companyAppointments.find((appointment) => {
          if (appointment.status === "cancelled" || !samePerson(appointment)) return false;
          return Math.abs(appointment.startTime.getTime() - startTime.getTime()) <= 10 * 60 * 1000;
        });

        const now = Date.now();
        const recentBad = companyAppointments.find((appointment) => {
          if (appointment.status === "cancelled" || !samePerson(appointment)) return false;
          const createdRecently = Math.abs(appointment.createdAt.getTime() - log.createdAt.getTime()) <= RECENT_APPOINTMENT_WINDOW_MS;
          const invalidPastDate = appointment.startTime.getTime() < now - 60 * 60 * 1000;
          return createdRecently && invalidPastDate;
        });

        let appointmentId: number;
        if (exact) {
          appointmentId = exact.id;
          if (exact.customerPhone !== callerPhone) {
            await db.update(appointmentsTable).set({
              customerPhone: callerPhone,
              customerEmail: exact.customerEmail ?? details.callerEmail,
              updatedAt: new Date(),
            }).where(eq(appointmentsTable.id, exact.id));
          }
          if (recentBad && recentBad.id !== exact.id) {
            await db.update(appointmentsTable).set({
              status: "cancelled",
              notes: `${recentBad.notes ?? ""}\nAutomatically cancelled: invalid duplicate date created during AI call.`.trim(),
              updatedAt: new Date(),
            }).where(eq(appointmentsTable.id, recentBad.id));
          }
        } else if (recentBad) {
          appointmentId = recentBad.id;
          await db.update(appointmentsTable).set({
            customerPhone: callerPhone,
            customerEmail: recentBad.customerEmail ?? details.callerEmail,
            title: details.appointmentTitle ?? recentBad.title,
            notes: details.appointmentNotes ?? recentBad.notes,
            startTime,
            status: "scheduled",
            callLogId: log.id,
            updatedAt: new Date(),
          }).where(eq(appointmentsTable.id, recentBad.id));
        } else {
          const [created] = await db.insert(appointmentsTable).values({
            companyId: phoneNumber.companyId,
            phoneNumberId: phoneNumber.id,
            callLogId: log.id,
            source: "ai_voice",
            customerName: details.callerName,
            customerPhone: callerPhone,
            customerEmail: details.callerEmail,
            title: details.appointmentTitle ?? "Appointment",
            notes: details.appointmentNotes ?? "Booked from AI phone call",
            startTime,
            status: "scheduled",
          }).returning();
          if (!created) throw new Error("Appointment insert returned no record");
          appointmentId = created.id;
        }

        appointmentCreated = true;
        const formatted = formatEastern(startTime);
        actionRequired = `Appointment #${appointmentId} booked for ${formatted}.`;
        summary = summary
          ? `${summary} Appointment booked for ${formatted}.`
          : `The caller requested an appointment. Appointment booked for ${formatted}.`;
      } else {
        actionRequired = "Appointment requested, but the call ended before the caller's name and exact date/time were fully confirmed. Follow up with the caller.";
      }
    } catch (error: any) {
      logger.error({ error: error?.message, callSid }, "Could not complete appointment after AI call");
      actionRequired = `Appointment requested but calendar confirmation failed: ${error?.message || "unknown error"}. Follow up with the caller.`;
    }

    if (!appointmentCreated) {
      await sendInterruptedBookingSms({
        callerPhone,
        fromNumber: phoneNumber.number,
        companyName,
      });
    }
  }

  await db.update(callLogsTable).set({
    callerName: log.callerName ?? details.callerName,
    callerEmail: log.callerEmail ?? details.callerEmail,
    callType: log.callType ?? details.callType,
    callSummary: log.callSummary ?? summary,
    actionRequired: log.actionRequired ?? actionRequired,
    priority: log.priority ?? details.priority,
    updatedAt: new Date(),
  }).where(eq(callLogsTable.id, log.id));

  await sendAdminWhatsApp({
    companyName,
    callerPhone: log.direction === "inbound" ? log.fromNumber : log.toNumber,
    callerName: log.callerName ?? details.callerName,
    summary,
    actionRequired,
    appointmentRequested: details.appointmentRequested,
  });
}

export function aiCallFinalizer(req: Request, res: Response, next: NextFunction): void {
  if (req.path === "/twilio/ai-gather") {
    const callSid = String(req.body?.CallSid ?? "");
    const speech = String(req.body?.SpeechResult ?? "");
    appendCallerSpeech(callSid, speech).catch((error) => {
      logger.warn({ error: error?.message, callSid }, "Could not persist caller speech");
    });
  }

  if (req.path === "/twilio/status") {
    const callSid = String(req.body?.CallSid ?? "");
    const status = String(req.body?.CallStatus ?? "");
    if (callSid && TERMINAL_STATUSES.has(status)) {
      res.once("finish", () => {
        setTimeout(() => {
          finalize(callSid).catch((error) => {
            logger.error({ error: error?.message, callSid }, "Could not finalize AI call");
          });
        }, 2000);
      });
    }
  }

  next();
}
