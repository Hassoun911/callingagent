import type { NextFunction, Request, Response } from "express";

const TIMEZONE = "America/Toronto";
const SIMPLE_RELATIVE_PATTERN = /\b(today|tomorrow|tonight|this morning|this afternoon|this evening|day after tomorrow|next (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week))\b/i;
const DAY_COUNT_PATTERN = /\b(?:(?:in\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+days?(?:\s+from\s+now)?|(?:a|one)\s+day\s+from\s+now)\b/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

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

function parseDayCount(speech: string): number | null {
  const match = speech.match(DAY_COUNT_PATTERN);
  if (!match) return null;

  const raw = match[1]?.toLowerCase();
  if (!raw) return 1;
  if (/^\d+$/.test(raw)) return Number(raw);
  return NUMBER_WORDS[raw] ?? null;
}

function replaceDayCountPhrase(speech: string, exactDate: string): string {
  return speech.replace(DAY_COUNT_PATTERN, `${exactDate} (resolved in ${TIMEZONE})`);
}

export function aiDateContext(req: Request, _res: Response, next: NextFunction): void {
  if (req.path !== "/twilio/ai-gather") {
    next();
    return;
  }

  const speech = typeof req.body?.SpeechResult === "string" ? req.body.SpeechResult.trim() : "";
  if (!speech) {
    next();
    return;
  }

  const now = new Date();
  const dayCount = parseDayCount(speech);
  const hasSimpleRelativeDate = SIMPLE_RELATIVE_PATTERN.test(speech);

  if (dayCount === null && !hasSimpleRelativeDate) {
    next();
    return;
  }

  const tomorrow = addCalendarDaysInBusinessZone(now, 1);
  const twoDaysFromNow = addCalendarDaysInBusinessZone(now, 2);
  const resolvedDate = dayCount !== null ? addCalendarDaysInBusinessZone(now, dayCount) : null;
  const normalizedSpeech = resolvedDate
    ? replaceDayCountPhrase(speech, formatBusinessDate(resolvedDate))
    : speech;

  const context = [
    `Business timezone: ${TIMEZONE}.`,
    `Current business date and time: ${formatBusinessDateTime(now)}.`,
    `Today is ${formatBusinessDate(now)}.`,
    `Tomorrow is ${formatBusinessDate(tomorrow)}.`,
    `Two days from now is ${formatBusinessDate(twoDaysFromNow)}.`,
    resolvedDate ? `The caller's relative date resolves exactly to ${formatBusinessDate(resolvedDate)}.` : "",
    "Use the resolved calendar date exactly as written.",
    "Never substitute a different month or year and never use a date in the past.",
  ].filter(Boolean).join(" ");

  req.body.SpeechResult = `${normalizedSpeech}\n\n[Authoritative scheduling date context: ${context}]`;
  next();
}
