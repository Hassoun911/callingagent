import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import {
  appointmentsTable,
  bookingSettingsTable,
  callLogsTable,
  db,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);
const DEFAULT_TIMEZONE = "America/Toronto";

interface CompletionExtraction {
  callerName: string | null;
  callerEmail: string | null;
  callType: "Emergency" | "Appointment" | "Pricing Inquiry" | "General Inquiry" | null;
  callSummary: string | null;
  actionRequired: string | null;
  priority: "Low" | "Medium" | "High" | null;
  appointmentRequested: boolean;
  appointmentConfirmed: boolean;
  appointmentTitle: string | null;
  appointmentStartTime: string | null;
  appointmentEndTime: string | null;
  appointmentNotes: string | null;
}

function getOpenAI(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

function validTimezone(value: string | null | undefined): string {
  if (!value) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function businessDateContext(timezone: string): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  return `${date} at ${time}`;
}

async function getCallContext(callSid: string): Promise<{
  log: typeof callLogsTable.$inferSelect | null;
  phoneNumber: typeof phoneNumbersTable.$inferSelect | null;
  timezone: string;
}> {
  const [log] = await db
    .select()
    .from(callLogsTable)
    .where(eq(callLogsTable.twilioCallSid, callSid));

  if (!log) return { log: null, phoneNumber: null, timezone: DEFAULT_TIMEZONE };

  let phoneNumber: typeof phoneNumbersTable.$inferSelect | null = null;
  if (log.phoneNumberId) {
    [phoneNumber] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.id, log.phoneNumberId));
  }
  if (!phoneNumber && log.toNumber) {
    [phoneNumber] = await db
      .select()
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.number, log.toNumber));
  }

  let timezone = DEFAULT_TIMEZONE;
  if (phoneNumber?.companyId) {
    const [settings] = await db
      .select()
      .from(bookingSettingsTable)
      .where(eq(bookingSettingsTable.companyId, phoneNumber.companyId));
    timezone = validTimezone(settings?.timezone);
  }

  return { log, phoneNumber, timezone };
}

async function appendCallerSpeech(callSid: string, speech: string): Promise<void> {
  const cleanSpeech = speech.trim();
  if (!callSid || !cleanSpeech) return;

  const { log } = await getCallContext(callSid);
  if (!log) return;

  const line = `Caller: ${cleanSpeech}`;
  const current = log.transcription?.trim() ?? "";
  if (current.split("\n").includes(line)) return;

  await db
    .update(callLogsTable)
    .set({
      transcription: current ? `${current}\n${line}` : line,
      updatedAt: new Date(),
    })
    .where(eq(callLogsTable.id, log.id));
}

async function decorateLiveSpeech(callSid: string, speech: string): Promise<string> {
  const cleanSpeech = speech.trim();
  if (!callSid || !cleanSpeech) return speech;

  const { log, timezone } = await getCallContext(callSid);
  const callerNumber = log?.direction === "inbound" ? log.fromNumber : log?.toNumber;
  const numberGuidance = callerNumber
    ? `The caller's phone number is ${callerNumber}. Do not repeat it unless confirmation is necessary. If spoken, say it naturally in three-three-four groups, not as one robotic number.`
    : "Do not repeat a phone number unless confirmation is necessary. If spoken, say it naturally in three-three-four groups.";

  return `${cleanSpeech}\n\n[Live call context: The business timezone is ${timezone}. The current business date and time is ${businessDateContext(timezone)}. Resolve today, tomorrow, weekdays, and all relative dates only from this exact context. Never invent a date. Keep the reply to one short natural sentence whenever possible. ${numberGuidance} Never say an appointment is booked unless the booking tool returns a real database appointment.]`;
}

async function extractCompletion(
  transcript: string,
  timezone: string,
): Promise<CompletionExtraction | null> {
  const openai = getOpenAI();
  if (!openai || !transcript.trim()) return null;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    max_tokens: 450,
    messages: [
      {
        role: "system",
        content:
          `Analyze a phone-call transcript. The business timezone is ${timezone}. ` +
          `The current business date and time is ${businessDateContext(timezone)}. ` +
          "Resolve relative dates such as today, tomorrow, and weekdays from that exact business date. " +
          "Return JSON only. Never invent missing details. Determine whether the caller requested an appointment. " +
          "Use an ISO 8601 datetime with the correct timezone offset only when a date and time can be determined. " +
          "Return these keys: callerName, callerEmail, callType, callSummary, actionRequired, priority, " +
          "appointmentRequested, appointmentConfirmed, appointmentTitle, appointmentStartTime, appointmentEndTime, appointmentNotes. " +
          "callType must be Emergency, Appointment, Pricing Inquiry, General Inquiry, or null. " +
          "priority must be Low, Medium, High, or null. callSummary should be two concise sentences.",
      },
      { role: "user", content: transcript },
    ],
  });

  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  return {
    callerName: raw.callerName ?? null,
    callerEmail: raw.callerEmail ?? null,
    callType: raw.callType ?? null,
    callSummary: raw.callSummary ?? null,
    actionRequired: raw.actionRequired ?? null,
    priority: raw.priority ?? null,
    appointmentRequested: raw.appointmentRequested === true,
    appointmentConfirmed: raw.appointmentConfirmed === true,
    appointmentTitle: raw.appointmentTitle ?? null,
    appointmentStartTime: raw.appointmentStartTime ?? null,
    appointmentEndTime: raw.appointmentEndTime ?? null,
    appointmentNotes: raw.appointmentNotes ?? null,
  };
}

function formatAppointmentTime(value: Date, timezone: string): string {
  return value.toLocaleString("en-CA", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function recoverAppointment(
  log: typeof callLogsTable.$inferSelect,
  phoneNumber: typeof phoneNumbersTable.$inferSelect | null,
  extraction: CompletionExtraction,
): Promise<{ appointmentId: number; startTime: Date; repaired: boolean } | null> {
  if (!extraction.appointmentRequested || !phoneNumber?.companyId) return null;

  const callerPhone = log.direction === "inbound" ? log.fromNumber : log.toNumber;
  const startTime = extraction.appointmentStartTime
    ? new Date(extraction.appointmentStartTime)
    : null;

  if (!extraction.callerName || !callerPhone || !startTime || Number.isNaN(startTime.getTime())) {
    return null;
  }

  const companyAppointments = await db
    .select()
    .from(appointmentsTable)
    .where(eq(appointmentsTable.companyId, phoneNumber.companyId));

  const matching = companyAppointments.find((appointment) => {
    const sameTime = Math.abs(appointment.startTime.getTime() - startTime.getTime()) <= 5 * 60 * 1000;
    const sameCaller = appointment.customerPhone === callerPhone ||
      appointment.customerPhone === phoneNumber.number ||
      appointment.customerName.toLowerCase() === extraction.callerName!.toLowerCase();
    return sameTime && sameCaller && appointment.status !== "cancelled";
  });

  if (matching) {
    const needsRepair = matching.customerPhone !== callerPhone ||
      (!matching.customerEmail && extraction.callerEmail) ||
      matching.callLogId !== log.id;
    if (needsRepair) {
      await db
        .update(appointmentsTable)
        .set({
          customerPhone: callerPhone,
          customerEmail: matching.customerEmail ?? extraction.callerEmail,
          callLogId: log.id,
          updatedAt: new Date(),
        })
        .where(eq(appointmentsTable.id, matching.id));
    }
    return { appointmentId: matching.id, startTime: matching.startTime, repaired: needsRepair };
  }

  const [appointment] = await db
    .insert(appointmentsTable)
    .values({
      companyId: phoneNumber.companyId,
      phoneNumberId: phoneNumber.id,
      callLogId: log.id,
      customerName: extraction.callerName,
      customerPhone: callerPhone,
      customerEmail: extraction.callerEmail,
      title: extraction.appointmentTitle ?? "Appointment",
      notes: extraction.appointmentNotes ?? "Created from AI phone call",
      startTime,
      endTime: extraction.appointmentEndTime ? new Date(extraction.appointmentEndTime) : null,
      status: "scheduled",
      source: "ai_voice",
    })
    .returning();

  return appointment
    ? { appointmentId: appointment.id, startTime: appointment.startTime, repaired: false }
    : null;
}

async function finalizeCall(callSid: string): Promise<void> {
  const { log, phoneNumber, timezone } = await getCallContext(callSid);
  if (!log?.transcription?.trim()) return;

  const extraction = await extractCompletion(log.transcription, timezone);
  if (!extraction) return;

  const appointment = await recoverAppointment(log, phoneNumber, extraction);
  let actionRequired = extraction.actionRequired;
  let summary = extraction.callSummary;

  if (appointment) {
    const time = formatAppointmentTime(appointment.startTime, timezone);
    actionRequired = `Appointment booked (#${appointment.appointmentId}) for ${time}.`;
    summary = summary
      ? `${summary} Appointment booked for ${time}.`
      : `The caller requested an appointment. Appointment booked for ${time}.`;
  } else if (extraction.appointmentRequested) {
    actionRequired = actionRequired ||
      "Appointment requested but not created automatically because the caller's name or exact date/time was missing. Follow up with the caller.";
  }

  await db
    .update(callLogsTable)
    .set({
      callerName: log.callerName ?? extraction.callerName,
      callerEmail: log.callerEmail ?? extraction.callerEmail,
      callType: log.callType ?? extraction.callType,
      callSummary: summary ?? log.callSummary,
      actionRequired: actionRequired ?? log.actionRequired,
      priority: log.priority ?? extraction.priority,
      updatedAt: new Date(),
    })
    .where(eq(callLogsTable.id, log.id));
}

export async function aiCallCompletionSafetyNet(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const path = req.path;

  if (path === "/twilio/ai-gather") {
    const callSid = String(req.body?.CallSid ?? "");
    const originalSpeech = String(req.body?.SpeechResult ?? "");

    try {
      await appendCallerSpeech(callSid, originalSpeech);
      req.body.SpeechResult = await decorateLiveSpeech(callSid, originalSpeech);
    } catch (err: any) {
      logger.warn({ err: err?.message, callSid }, "Failed to enrich AI live-call context");
    }
  }

  if (path === "/twilio/status") {
    const callSid = String(req.body?.CallSid ?? "");
    const status = String(req.body?.CallStatus ?? "");
    if (callSid && TERMINAL_STATUSES.has(status)) {
      res.once("finish", () => {
        setTimeout(() => {
          finalizeCall(callSid).catch((err) =>
            logger.error({ err: err?.message, callSid }, "Failed to finalize AI call"),
          );
        }, 1500);
      });
    }
  }

  next();
}
