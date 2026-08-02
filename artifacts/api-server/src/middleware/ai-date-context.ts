import type { NextFunction, Request, Response } from "express";

const TIMEZONE = "America/Toronto";
const RELATIVE_DATE_PATTERN = /\b(today|tomorrow|tonight|this morning|this afternoon|this evening|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week))\b/i;

function getDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

function formatBusinessDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatBusinessDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function addCalendarDaysInBusinessZone(date: Date, days: number): Date {
  const { year, month, day } = getDateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days, 16, 0, 0));
}

export function aiDateContext(req: Request, _res: Response, next: NextFunction): void {
  if (req.path !== "/twilio/ai-gather") {
    next();
    return;
  }

  const speech = typeof req.body?.SpeechResult === "string" ? req.body.SpeechResult.trim() : "";
  if (!speech || !RELATIVE_DATE_PATTERN.test(speech)) {
    next();
    return;
  }

  const now = new Date();
  const tomorrow = addCalendarDaysInBusinessZone(now, 1);
  const context = [
    `Business timezone: ${TIMEZONE}.`,
    `Current business date and time: ${formatBusinessDateTime(now)}.`,
    `Today is ${formatBusinessDate(now)}.`,
    `Tomorrow is ${formatBusinessDate(tomorrow)}.`,
    "Resolve every relative date from this context. Never use a date in the past.",
  ].join(" ");

  req.body.SpeechResult = `${speech}\n\n[Date context for scheduling only: ${context}]`;
  next();
}
