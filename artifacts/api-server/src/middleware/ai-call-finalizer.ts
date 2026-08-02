import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import OpenAI from "openai";
import {
  appointmentsTable,
  callLogsTable,
  db,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

const TERMINAL_STATUSES = new Set(["completed", "failed", "busy", "no-answer", "canceled"]);
const DEFAULT_TIMEZONE = "America/Toronto";

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
          "Resolve relative dates such as today and tomorrow from that exact business date.",
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

  let actionRequired = details.actionRequired;
  let summary = details.callSummary;

  if (details.appointmentRequested && phoneNumber?.companyId) {
    const callerPhone = log.direction === "inbound" ? log.fromNumber : log.toNumber;
    const startTime = details.appointmentStartTime ? new Date(details.appointmentStartTime) : null;

    if (details.callerName && callerPhone && startTime && !Number.isNaN(startTime.getTime())) {
      const companyAppointments = await db.select().from(appointmentsTable)
        .where(eq(appointmentsTable.companyId, phoneNumber.companyId));

      const matching = companyAppointments.find((appointment) => {
        if (appointment.status === "cancelled") return false;
        const sameTime = Math.abs(appointment.startTime.getTime() - startTime.getTime()) <= 10 * 60 * 1000;
        const samePerson = appointment.customerPhone === callerPhone ||
          appointment.customerPhone === phoneNumber.number ||
          appointment.customerName.toLowerCase() === details.callerName!.toLowerCase();
        return sameTime && samePerson;
      });

      let appointmentId: number;
      if (matching) {
        appointmentId = matching.id;
        if (matching.customerPhone !== callerPhone || matching.startTime.getTime() !== startTime.getTime()) {
          await db.update(appointmentsTable).set({
            customerPhone: callerPhone,
            customerEmail: matching.customerEmail ?? details.callerEmail,
            startTime,
            updatedAt: new Date(),
          }).where(eq(appointmentsTable.id, matching.id));
        }
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

      const formatted = formatEastern(startTime);
      actionRequired = `Appointment #${appointmentId} booked for ${formatted}.`;
      summary = summary
        ? `${summary} Appointment booked for ${formatted}.`
        : `The caller requested an appointment. Appointment booked for ${formatted}.`;
    } else {
      actionRequired = "Appointment requested, but the caller's name or exact date/time was missing. Follow up with the caller.";
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
