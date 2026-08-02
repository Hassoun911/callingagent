import type { NextFunction, Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import OpenAI from "openai";
import {
  appointmentsTable,
  callLogsTable,
  db,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);

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

async function appendCallerSpeech(callSid: string, speech: string): Promise<void> {
  const cleanSpeech = speech.trim();
  if (!callSid || !cleanSpeech) return;

  const [log] = await db
    .select()
    .from(callLogsTable)
    .where(eq(callLogsTable.twilioCallSid, callSid));
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

async function extractCompletion(transcript: string): Promise<CompletionExtraction | null> {
  const openai = getOpenAI();
  if (!openai || !transcript.trim()) return null;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Analyze a phone-call transcript. Return JSON only. Never invent missing details. " +
          "Determine whether the caller requested an appointment and whether the conversation indicates it was confirmed. " +
          "Use an ISO 8601 datetime only when a specific date and time can be determined. " +
          "Return these keys: callerName, callerEmail, callType, callSummary, actionRequired, priority, " +
          "appointmentRequested, appointmentConfirmed, appointmentTitle, appointmentStartTime, appointmentEndTime, appointmentNotes. " +
          "callType must be Emergency, Appointment, Pricing Inquiry, General Inquiry, or null. " +
          "priority must be Low, Medium, High, or null. callSummary should be two or three concise sentences.",
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

function formatAppointmentTime(value: Date): string {
  return value.toLocaleString("en-CA", {
    timeZone: "America/Toronto",
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
      (!matching.customerEmail && extraction.callerEmail);
    if (needsRepair) {
      await db
        .update(appointmentsTable)
        .set({
          customerPhone: callerPhone,
          customerEmail: matching.customerEmail ?? extraction.callerEmail,
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
      customerName: extraction.callerName,
      customerPhone: callerPhone,
      customerEmail: extraction.callerEmail,
      title: extraction.appointmentTitle ?? "Appointment",
      notes: extraction.appointmentNotes ?? "Recovered from AI phone call",
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
  const [log] = await db
    .select()
    .from(callLogsTable)
    .where(eq(callLogsTable.twilioCallSid, callSid));
  if (!log?.transcription?.trim()) return;

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

  const extraction = await extractCompletion(log.transcription);
  if (!extraction) return;

  const appointment = await recoverAppointment(log, phoneNumber, extraction);
  let actionRequired = extraction.actionRequired;
  let summary = extraction.callSummary;

  if (appointment) {
    const time = formatAppointmentTime(appointment.startTime);
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
      callSummary: log.callSummary ?? summary,
      actionRequired: log.actionRequired ?? actionRequired,
      priority: log.priority ?? extraction.priority,
      updatedAt: new Date(),
    })
    .where(eq(callLogsTable.id, log.id));
}

export function aiCallCompletionSafetyNet(req: Request, res: Response, next: NextFunction): void {
  const path = req.path;

  if (path === "/twilio/ai-gather") {
    const callSid = String(req.body?.CallSid ?? "");
    const speech = String(req.body?.SpeechResult ?? "");
    appendCallerSpeech(callSid, speech).catch((err) =>
      logger.warn({ err: err?.message, callSid }, "Failed to persist AI caller speech"),
    );
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
