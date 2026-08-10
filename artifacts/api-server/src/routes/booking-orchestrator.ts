import { Router, type IRouter } from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  bookingAvailabilityTable,
  bookingResourcesTable,
  bookingServicesTable,
  bookingSettingsTable,
  bookingTimeOffTable,
  callLogsTable,
  companiesTable,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendBookingNotifications } from "../lib/notifications";
import { validateBookingBeforeCreate } from "../lib/booking-validator";
import {
  clearBookingState,
  expireBookingStates,
  getBookingState,
  holdBookingSlot,
  isSlotHeldByAnother,
  markBookingConfirmed,
  markBookingCreated,
  peekBookingState,
  releaseBookingHold,
  setAvailabilityResult,
  setBookingAction,
  setCustomerDetails,
  setSchedulingPreference,
  StaleBookingStateError,
  type BookingAction,
  type BookingDaypart,
  type BookingSlotState,
  type LiveBookingState,
} from "../lib/booking-state-manager";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

const BOOKING_INTENT = /\b(book|booking|appointment|schedule|scheduled|scheduling|availability|available|opening|openings|slot|slots|come in)\b/i;
const SOONEST = /\b(soonest|earliest|first available|next available|as soon as possible|as soon as you can|asap|whatever you have first|first thing available)\b/i;
const REJECT_OFFER = /\b(no|nope|nah|none|not that|not those|another|different|something else|other option|other time|another spot|another time|later one|find me another|none of those)\b/i;
const YES = /\b(yes|yeah|yep|yup|sure|correct|right|that's right|that is right|perfect|sounds good|go ahead|book it|confirm)\b/i;
const NO = /\b(no|nope|nah|not correct|that's wrong|that is wrong|change it)\b/i;
const CANCEL_FLOW = /\b(never mind|nevermind|forget it|don't book|do not book|stop booking|cancel this booking|cancel the booking process)\b/i;
const HUMAN_REQUEST = /\b(human|person|representative|agent|someone from (?:the )?(?:team|office)|talk to someone|speak to someone)\b/i;
const RESCHEDULE_OR_CANCEL = /\b(reschedule|cancel my appointment|cancel an appointment|change my appointment|move my appointment)\b/i;
const SERVICE_STOPWORDS = new Set(["book", "booking", "appointment", "schedule", "scheduled", "scheduling", "availability", "available", "opening", "openings", "slot", "slots", "service", "services", "need", "want", "would", "like", "please", "today", "tomorrow", "morning", "afternoon", "evening"]);

type Slot = BookingSlotState & { start: Date; end: Date };
type CalendarResult = { slots: Slot[]; timeZone: string };
type PendingCheck = { callSid: string; companyId: number; stateVersion: number; expiresAt: number; result?: CalendarResult; error?: string };
type Decision = { action: BookingAction; text?: string };

const pendingChecks = new Map<string, PendingCheck>();

function baseUrl(req: any): string {
  return process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;
}

function xml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function gatherResponse(req: any, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(text)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n  <Say voice="${FALLBACK_VOICE}">Are you still there?</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n</Response>`;
}

function workingResponse(req: any, callSid: string, firstPass: boolean, requestedDay: string | null): string {
  const nextUrl = `${baseUrl(req)}/api/twilio/booking-availability-result?callSid=${encodeURIComponent(callSid)}`;
  const soundUrl = `${baseUrl(req)}/api/twilio/booking-working-sound.wav`;
  const intro = requestedDay && requestedDay !== "soonest" ? `Sure, I'll check ${requestedDay}.` : "Absolutely, I'll check availability.";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${firstPass ? `<Say voice="${FALLBACK_VOICE}">${xml(intro)}</Say>` : ""}\n  <Play>${soundUrl}</Play>\n  <Redirect method="POST">${nextUrl.replace(/&/g, "&amp;")}</Redirect>\n</Response>`;
}

function buildWorkingSound(): Buffer {
  const sampleRate = 8000;
  const durationSeconds = 1.45;
  const samples = Math.floor(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(samples * 2);
  const clicks = [0.07, 0.17, 0.29, 0.41, 0.53, 0.66, 0.78, 0.9, 1.02, 1.14, 1.27, 1.38];
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    let value = Math.sin(2 * Math.PI * 88 * t) * 0.005;
    for (let c = 0; c < clicks.length; c++) {
      const dt = t - clicks[c];
      if (dt >= 0 && dt < 0.04) {
        const envelope = Math.exp(-dt * 78);
        value += Math.sin(2 * Math.PI * (800 + (c % 3) * 130) * dt) * envelope * 0.2;
        value += Math.sin(2 * Math.PI * 2050 * dt) * envelope * 0.05;
      }
    }
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), i * 2);
  }
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVE", 8); wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44); return wav;
}

const workingSound = buildWorkingSound();
router.get("/twilio/booking-working-sound.wav", (_req, res): void => {
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", workingSound.length);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(workingSound);
});

function normalizedPhone(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return value.trim();
}

function naturalPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `${local.slice(0, 3).split("").join(" ")}, ${local.slice(3, 6).split("").join(" ")}, ${local.slice(6).split("").join(" ")}`;
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 2; i++) guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - zoneOffsetMs(guess, timeZone));
  return guess;
}

function addCalendarDays(year: number, month: number, day: number, amount: number) {
  const d = new Date(Date.UTC(year, month - 1, day + amount));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function parseClock(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean { return aStart < bEnd && aEnd > bStart; }

function slotLabel(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(start);
}

function shortSlotLabel(start: Date, timeZone: string, includeDay: boolean): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, ...(includeDay ? { weekday: "long" as const } : {}), hour: "numeric", minute: "2-digit" }).format(start);
}

function spokenOptions(slots: Slot[], timeZone: string, requestedDay: string | null): string {
  const visible = slots.slice(0, 3);
  const includeDay = !requestedDay || requestedDay === "soonest";
  const labels = visible.map(slot => shortSlotLabel(slot.start, timeZone, includeDay));
  if (labels.length === 1) return `I have ${labels[0]} available. Does that work?`;
  if (labels.length === 2) return `I have ${labels[0]} or ${labels[1]}. Which works better?`;
  return `I have ${labels[0]}, ${labels[1]}, or ${labels[2]}. Which one works for you?`;
}

function extractRequestedDay(speech: string): string | null {
  if (/\btoday\b/i.test(speech)) return "today";
  if (/\btomorrow\b/i.test(speech)) return "tomorrow";
  const weekday = speech.match(/\b(?:next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) return weekday[1][0].toUpperCase() + weekday[1].slice(1).toLowerCase();
  const monthPattern = MONTHS.join("|");
  const monthDay = speech.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (monthDay) return `${monthDay[1][0].toUpperCase() + monthDay[1].slice(1).toLowerCase()} ${Number(monthDay[2])}`;
  return null;
}

function extractDaypart(speech: string): BookingDaypart | undefined {
  if (/\bmorning\b/i.test(speech)) return "morning";
  if (/\bafternoon\b/i.test(speech)) return "afternoon";
  if (/\b(evening|tonight|night)\b/i.test(speech)) return "evening";
  return undefined;
}

function extractRequestedTime(speech: string): string | undefined {
  const match = speech.match(/\b(?:around|about|at|near)?\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i);
  if (!match) return undefined;
  const hour = Math.max(1, Math.min(12, Number(match[1])));
  const minute = match[2] ? Math.max(0, Math.min(59, Number(match[2]))) : 0;
  const period = match[3].toLowerCase().startsWith("p") ? "PM" : "AM";
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function requestedDate(state: LiveBookingState, now: Date, timeZone: string): { year: number; month: number; day: number } | null {
  if (!state.requestedDay || state.requestedDay === "soonest") return null;
  const today = localParts(now, timeZone);
  if (state.requestedDay === "today") return { year: today.year, month: today.month, day: today.day };
  if (state.requestedDay === "tomorrow") return addCalendarDays(today.year, today.month, today.day, 1);
  const weekday = state.requestedDay.match(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i);
  if (weekday) {
    const target = WEEKDAYS.findIndex(day => day.toLowerCase() === weekday[1].toLowerCase());
    const todayDow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    let offset = (target - todayDow + 7) % 7;
    if (offset === 0) offset = 7;
    return addCalendarDays(today.year, today.month, today.day, offset);
  }
  const monthDay = state.requestedDay.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (!monthDay) return null;
  const month = MONTHS.findIndex(m => m.toLowerCase() === monthDay[1].toLowerCase()) + 1;
  if (!month) return null;
  const day = Number(monthDay[2]);
  let year = today.year;
  if (Date.UTC(year, month - 1, day) < Date.UTC(today.year, today.month - 1, today.day)) year += 1;
  return { year, month, day };
}

function requestedTimeMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function daypartAllows(daypart: BookingDaypart, start: Date, timeZone: string): boolean {
  if (!daypart) return true;
  const hour = localParts(start, timeZone).hour;
  if (daypart === "morning") return hour < 12;
  if (daypart === "afternoon") return hour >= 12 && hour < 17;
  return hour >= 17;
}

function extractCustomerDetails(speech: string, lastAction: BookingAction | null) {
  const explicitName = speech.match(/\b(?:my name is|name is|this is)\s+([A-Za-z][A-Za-z' -]{1,60})/i)?.[1]?.trim();
  const simpleName = lastAction === "ASK_NAME" && /^[A-Za-z][A-Za-z' -]{1,60}$/.test(speech.trim()) ? speech.trim() : undefined;
  const email = speech.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  const phone = speech.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0];
  return { customerName: explicitName || simpleName, customerEmail: email, customerPhone: phone ? normalizedPhone(phone) : undefined };
}

function serviceScore(speech: string, name: string, description?: string | null): number {
  const source = `${name} ${description ?? ""}`.toLowerCase();
  const words = speech.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2 && !SERVICE_STOPWORDS.has(word));
  let score = speech.toLowerCase().includes(name.toLowerCase()) ? 30 : 0;
  for (const word of words) if (source.includes(word)) score += 1;
  return score;
}

async function resolveCall(req: any, callSid: string) {
  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, callSid));
  if (log?.phoneNumberId) {
    const [phone] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, log.phoneNumberId));
    if (phone?.companyId) return { log, phone, companyId: phone.companyId };
  }
  const destination = normalizedPhone(req.body?.To || req.body?.Called || req.body?.DialCallTo || log?.toNumber);
  if (!destination) return null;
  const phones = await db.select().from(phoneNumbersTable);
  const phone = phones.find(row => normalizedPhone(row.number) === destination);
  if (!phone?.companyId) return null;
  return { log: log ?? null, phone, companyId: phone.companyId };
}

async function loadServices(companyId: number) {
  return db.select().from(bookingServicesTable).where(and(eq(bookingServicesTable.companyId, companyId), eq(bookingServicesTable.active, true)));
}

async function updateStateFromSpeech(state: LiveBookingState, speech: string): Promise<{ services: any[]; state: LiveBookingState }> {
  const services = await loadServices(state.companyId);
  const ranked = services.map(service => ({ service, score: serviceScore(speech, service.name, service.description) })).sort((a, b) => b.score - a.score);
  const matched = ranked[0]?.score > 0 ? ranked[0].service : null;
  const singleService = services.length === 1 ? services[0] : null;

  // Conversation understanding only extracts and normalizes facts here. The
  // normalized patch is applied atomically against the version we actually read.
  const schedulingPatch = {
    ...(matched ? { serviceId: matched.id, serviceName: matched.name } : (!state.serviceId && singleService ? { serviceId: singleService.id, serviceName: singleService.name } : {})),
    ...(extractRequestedDay(speech) ? { requestedDay: extractRequestedDay(speech)! } : {}),
    ...(extractDaypart(speech) !== undefined ? { requestedDaypart: extractDaypart(speech)! } : {}),
    ...(extractRequestedTime(speech) !== undefined ? { requestedTime: extractRequestedTime(speech)! } : {}),
  };

  let current = setSchedulingPreference(state.callSid, state.companyId, schedulingPatch, state.stateVersion);
  const details = extractCustomerDetails(speech, state.lastAction);
  if (details.customerName || details.customerEmail || details.customerPhone) {
    current = setCustomerDetails(state.callSid, state.companyId, {
      customerName: details.customerName,
      customerEmail: details.customerEmail,
      customerPhone: details.customerPhone,
      ...(details.customerPhone ? { customerPhoneSource: "spoken" as const, customerPhoneConfirmed: true } : {}),
    }, current.stateVersion);
  }
  return { services, state: current };
}

async function findAvailability(callSid: string, state: LiveBookingState): Promise<CalendarResult> {
  const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, state.companyId));
  const timeZone = settings?.timezone || "America/Toronto";
  if (settings && settings.enabled === false) return { slots: [], timeZone };
  const [resources, availability, timeOff, services, appointments] = await Promise.all([
    db.select().from(bookingResourcesTable).where(and(eq(bookingResourcesTable.companyId, state.companyId), eq(bookingResourcesTable.active, true))),
    db.select().from(bookingAvailabilityTable).where(and(eq(bookingAvailabilityTable.companyId, state.companyId), eq(bookingAvailabilityTable.active, true))),
    db.select().from(bookingTimeOffTable).where(eq(bookingTimeOffTable.companyId, state.companyId)),
    loadServices(state.companyId),
    db.select().from(appointmentsTable).where(and(eq(appointmentsTable.companyId, state.companyId), ne(appointmentsTable.status, "cancelled"))),
  ]);
  if (!resources.length || !availability.length) return { slots: [], timeZone };
  const selectedService = state.serviceId ? services.find(service => service.id === state.serviceId) ?? null : (services.length === 1 ? services[0] : null);
  const durationMinutes = selectedService?.durationMinutes ?? 60;
  const before = selectedService?.bufferBeforeMinutes ?? 0;
  const after = selectedService?.bufferAfterMinutes ?? 0;
  const interval = Math.max(5, settings?.slotIntervalMinutes ?? 30);
  const minNotice = Math.max(0, settings?.minimumNoticeMinutes ?? 60);
  const horizon = Math.min(90, Math.max(1, settings?.maximumAdvanceDays ?? 90));
  const now = new Date();
  const earliest = new Date(now.getTime() + minNotice * 60_000);
  const today = localParts(now, timeZone);
  const requested = requestedDate(state, now, timeZone);
  const preferredMinutes = requestedTimeMinutes(state.requestedTime);
  const candidates: Slot[] = [];

  for (let offset = 0; offset <= horizon && candidates.length < 40; offset++) {
    const date = addCalendarDays(today.year, today.month, today.day, offset);
    if (requested && (date.year !== requested.year || date.month !== requested.month || date.day !== requested.day)) continue;
    const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    for (const resource of resources) {
      const windows = availability.filter(row => row.resourceId === resource.id && row.dayOfWeek === dayOfWeek);
      for (const window of windows) {
        const [startHour, startMinute] = parseClock(window.startTime);
        const [endHour, endMinute] = parseClock(window.endTime);
        const windowStart = zonedToUtc(date.year, date.month, date.day, startHour, startMinute, timeZone);
        const windowEnd = zonedToUtc(date.year, date.month, date.day, endHour, endMinute, timeZone);
        for (let start = new Date(windowStart); start.getTime() + durationMinutes * 60_000 <= windowEnd.getTime(); start = new Date(start.getTime() + interval * 60_000)) {
          if (start < earliest || !daypartAllows(state.requestedDaypart, start, timeZone)) continue;
          const end = new Date(start.getTime() + durationMinutes * 60_000);
          const occupiedStart = new Date(start.getTime() - before * 60_000);
          const occupiedEnd = new Date(end.getTime() + after * 60_000);
          if (timeOff.some(row => row.resourceId === resource.id && overlaps(occupiedStart, occupiedEnd, row.startTime, row.endTime))) continue;
          if (appointments.some(appointment => {
            if (appointment.resourceId != null && appointment.resourceId !== resource.id) return false;
            const appointmentEnd = appointment.endTime ?? new Date(appointment.startTime.getTime() + durationMinutes * 60_000);
            return overlaps(occupiedStart, occupiedEnd, appointment.startTime, appointmentEnd);
          })) continue;
          const slot: Slot = {
            start,
            end,
            iso: start.toISOString(),
            endIso: end.toISOString(),
            label: slotLabel(start, timeZone),
            resourceId: resource.id,
            serviceId: selectedService?.id ?? null,
          };
          if (isSlotHeldByAnother(callSid, state.companyId, slot)) continue;
          candidates.push(slot);
        }
      }
    }
    if (requested) break;
    if (candidates.length >= 12) break;
  }

  const unique = Array.from(new Map(candidates.map(slot => [`${slot.serviceId ?? "none"}:${slot.resourceId}:${slot.iso}:${slot.endIso}`, slot])).values());
  unique.sort((a, b) => {
    if (preferredMinutes == null) return a.start.getTime() - b.start.getTime();
    const pa = localParts(a.start, timeZone); const pb = localParts(b.start, timeZone);
    const da = Math.abs(pa.hour * 60 + pa.minute - preferredMinutes); const db = Math.abs(pb.hour * 60 + pb.minute - preferredMinutes);
    return da - db || a.start.getTime() - b.start.getTime();
  });
  return { slots: unique.slice(0, 12), timeZone };
}

function selectedSlot(speech: string, slots: BookingSlotState[], timeZone: string): BookingSlotState | null {
  const visible = slots.slice(0, 3);
  if (visible.length === 1 && YES.test(speech)) return visible[0];
  if (/\b(first|one|1)\b/i.test(speech)) return visible[0] ?? null;
  if (/\b(second|two|2)\b/i.test(speech)) return visible[1] ?? null;
  if (/\b(third|three|3)\b/i.test(speech)) return visible[2] ?? null;
  const normalized = speech.toLowerCase();
  for (const slot of visible) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(slot.iso));
    const weekday = parts.find(part => part.type === "weekday")?.value?.toLowerCase() ?? "";
    const hour = parts.find(part => part.type === "hour")?.value ?? "";
    const minute = parts.find(part => part.type === "minute")?.value ?? "00";
    const period = parts.find(part => part.type === "dayPeriod")?.value?.toLowerCase() ?? "";
    if (weekday && normalized.includes(weekday) && normalized.includes(hour)) return slot;
    if (normalized.includes(`${hour}:${minute}`) || normalized.includes(`${hour} ${period}`) || normalized.includes(`${hour}${period}`)) return slot;
  }
  return null;
}

function startAvailabilityCheck(callSid: string, state: LiveBookingState, revalidate = false): PendingCheck {
  const action: BookingAction = revalidate ? "REVALIDATE_AVAILABILITY" : "SEARCH_AVAILABILITY";
  const actionState = setBookingAction(callSid, state.companyId, action, state.stateVersion);
  const check: PendingCheck = { callSid, companyId: state.companyId, stateVersion: actionState.stateVersion, expiresAt: Date.now() + 60_000 };
  pendingChecks.set(callSid, check);
  void findAvailability(callSid, actionState).then(result => {
    const current = pendingChecks.get(callSid); if (current === check) current.result = result;
  }).catch((error: any) => {
    const current = pendingChecks.get(callSid); if (current === check) current.error = error?.message || "Availability lookup failed";
    logger.error({ callSid, companyId: state.companyId, err: error?.message }, "Booking availability lookup failed");
  });
  return check;
}

function bookingSummary(state: LiveBookingState): string {
  const service = state.serviceName || "appointment";
  const slot = state.selectedSlot?.label || "the selected time";
  return `Perfect. I have ${state.customerName} for ${service}, ${slot}. Is that correct?`;
}

function nextDecision(state: LiveBookingState, servicesCount: number): Decision {
  if (state.slotStatus === "expired" || state.availabilityStatus === "stale" && state.selectedSlot) {
    return { action: "REVALIDATE_AVAILABILITY", text: "That hold expired, so I'll quickly recheck that time for you." };
  }
  if (servicesCount === 0) return { action: "ESCALATE_TO_HUMAN", text: "I can't safely complete that booking from the schedule I have. I'll have someone from the team help with this request." };
  if (!state.serviceId && servicesCount > 1) return { action: "ASK_SERVICE", text: "Absolutely. What would you like the appointment for?" };
  if (!state.requestedDay) return { action: "ASK_DATE", text: "Sure. What day works best for you?" };
  if (state.availabilityStatus === "not_searched" || state.availabilityStatus === "stale" || !state.availabilityChecked) return { action: "SEARCH_AVAILABILITY" };
  if (!state.selectedSlot) return state.offeredSlots.length ? { action: "OFFER_SLOTS" } : { action: "NO_AVAILABILITY", text: "I don't have an opening for that request. Would you like me to check another day or time?" };
  if (!state.customerName) return { action: "ASK_NAME", text: "Perfect. What's the name for the appointment?" };
  if (state.customerPhone && !state.customerPhoneConfirmed) return { action: "ASK_PHONE_CONFIRMATION", text: `And should I use the number you're calling from, ${naturalPhone(state.customerPhone)}, for the confirmation?` };
  if (!state.customerPhone) return { action: "ASK_PHONE_CONFIRMATION", text: "What's the best phone number for the confirmation?" };
  if (!state.confirmed) return { action: "CONFIRM_BOOKING", text: bookingSummary(state) };
  return { action: "CREATE_BOOKING" };
}

function scheduleNotificationRetry(payload: Parameters<typeof sendBookingNotifications>[0], appointmentId: number, attempt = 1): void {
  void sendBookingNotifications(payload).catch(error => {
    logger.warn({ err: error?.message, appointmentId, attempt }, "Post-commit booking notification attempt failed");
    if (attempt >= 3) return;
    const delay = attempt * 15_000;
    const timer = setTimeout(() => scheduleNotificationRetry(payload, appointmentId, attempt + 1), delay);
    timer.unref();
  });
}

async function createValidatedBooking(call: any, state: LiveBookingState): Promise<{ ok: true; text: string } | { ok: false; text: string; retryAvailability?: boolean }> {
  if (!state.selectedSlot) return { ok: false, text: "I no longer have a selected appointment time. Let's choose a time again." };
  const slotIdentity = [state.companyId, state.selectedSlot.serviceId ?? "none", state.selectedSlot.resourceId, state.selectedSlot.iso, state.selectedSlot.endIso].join(":");
  const callLogId = call.log?.id ?? null;

  const transactionResult = await db.transaction(async tx => {
    // Idempotency lock serializes duplicate Twilio callbacks for the same booking attempt.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${state.idempotencyKey}))`);
    // Exact-slot lock serializes cross-worker creates for company+service+resource+start+end.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${slotIdentity}))`);

    const validation = await validateBookingBeforeCreate(state, { executor: tx, callLogId });
    if (!validation.ok) return { validation } as const;

    if (validation.existingBookingId) {
      const [existing] = await tx.select().from(appointmentsTable).where(eq(appointmentsTable.id, validation.existingBookingId));
      return { validation, appointment: existing, alreadyExisted: true } as const;
    }

    const notes = Object.keys(state.notes).length ? Object.entries(state.notes).map(([key, value]) => `${key}: ${value}`).join("; ") : null;
    const [appointment] = await tx.insert(appointmentsTable).values({
      companyId: state.companyId,
      phoneNumberId: call.phone?.id ?? null,
      callLogId,
      resourceId: state.selectedSlot!.resourceId,
      serviceId: state.selectedSlot!.serviceId,
      source: "ai_voice",
      customerName: state.customerName!,
      customerPhone: normalizedPhone(state.customerPhone),
      customerEmail: state.customerEmail,
      title: state.serviceName || "Appointment",
      notes,
      startTime: validation.startTime,
      endTime: validation.endTime,
      status: "scheduled",
    }).returning();
    return { validation, appointment, alreadyExisted: false } as const;
  });

  if ("validation" in transactionResult && !transactionResult.validation.ok) {
    const validation = transactionResult.validation;
    logger.warn({ callSid: state.callSid, code: validation.code, reason: validation.reason, idempotencyKey: state.idempotencyKey }, "Booking validator rejected create");
    if (validation.code === "HOLD_EXPIRED" || validation.code === "SLOT_CONFLICT") {
      releaseBookingHold(state.callSid);
      const current = getBookingState(state.callSid, state.companyId);
      setAvailabilityResult(state.callSid, state.companyId, [], current.stateVersion);
      return { ok: false, retryAvailability: true, text: validation.code === "SLOT_CONFLICT" ? "That time was just taken. I'll check the next closest options." : "That temporary hold expired. I'll check that time again for you." };
    }
    return { ok: false, text: validation.reason };
  }

  const appointment = transactionResult.appointment;
  if (!appointment) return { ok: false, text: "I couldn't finish the booking just now. Please try again." };
  const current = getBookingState(state.callSid, state.companyId);
  markBookingCreated(state.callSid, state.companyId, appointment.id, current.stateVersion);

  // Notifications are post-commit side effects. Failures never invalidate the booking.
  if (!transactionResult.alreadyExisted) {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, state.companyId));
    scheduleNotificationRetry({
      companyName: company?.name ?? "the business",
      companyAdminEmail: company?.adminNotificationEmail ?? company?.email ?? null,
      companyAdminWhatsapp: company?.adminWhatsapp ?? null,
      customerName: appointment.customerName,
      customerPhone: appointment.customerPhone,
      customerEmail: appointment.customerEmail,
      title: appointment.title,
      notes: appointment.notes,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      twilioFromNumber: call.phone?.number ?? call.log?.toNumber ?? null,
    }, appointment.id);
  }

  const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, state.companyId));
  const timeZone = settings?.timezone || "America/Toronto";
  const spoken = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(appointment.startTime);
  return { ok: true, text: `You're all set. You're booked for ${spoken}. I'll send the confirmation to your phone.` };
}

router.post("/twilio/booking-availability-result", async (req: any, res): Promise<void> => {
  const callSid = String(req.query.callSid ?? req.body?.CallSid ?? "");
  const check = pendingChecks.get(callSid);
  if (!callSid || !check) { res.type("text/xml").send(gatherResponse(req, "I had trouble checking that. What day works best for you?")); return; }
  if (check.error) { pendingChecks.delete(callSid); res.type("text/xml").send(gatherResponse(req, "I couldn't reach the calendar just now. What other day works for you?")); return; }
  if (!check.result) { const state = peekBookingState(callSid); res.type("text/xml").send(workingResponse(req, callSid, false, state?.requestedDay ?? null)); return; }

  pendingChecks.delete(callSid);
  const state = peekBookingState(callSid);
  if (!state || state.companyId !== check.companyId || state.stateVersion !== check.stateVersion) {
    if (state) startAvailabilityCheck(callSid, state, true);
    res.type("text/xml").send(workingResponse(req, callSid, false, state?.requestedDay ?? null));
    return;
  }

  const { slots, timeZone } = check.result;
  const resultState = setAvailabilityResult(callSid, state.companyId, slots, state.stateVersion);
  if (!slots.length) {
    setBookingAction(callSid, resultState.companyId, "NO_AVAILABILITY", resultState.stateVersion);
    const requested = resultState.requestedDay && resultState.requestedDay !== "soonest" ? ` on ${resultState.requestedDay}` : "";
    res.type("text/xml").send(gatherResponse(req, `I don't have an opening${requested}. Would you like me to check another day or time?`));
    return;
  }
  setBookingAction(callSid, resultState.companyId, "OFFER_SLOTS", resultState.stateVersion);
  logger.info({ callSid, companyId: resultState.companyId, stateVersion: resultState.stateVersion, slots: slots.slice(0, 3).map(slot => slot.iso) }, "Offering validated real calendar slots");
  res.type("text/xml").send(gatherResponse(req, spokenOptions(slots, timeZone, resultState.requestedDay)));
});

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech || RESCHEDULE_OR_CANCEL.test(speech)) { next(); return; }

  try {
    const call = await resolveCall(req, callSid);
    if (!call) { next(); return; }
    const existing = peekBookingState(callSid);
    const hasIntent = BOOKING_INTENT.test(speech) || SOONEST.test(speech);
    if (!existing && !hasIntent) { next(); return; }

    if (existing && CANCEL_FLOW.test(speech)) {
      setBookingAction(callSid, existing.companyId, "CANCEL_BOOKING_FLOW", existing.stateVersion);
      clearBookingState(callSid);
      res.type("text/xml").send(gatherResponse(req, "No problem. I won't book anything. What else can I help you with?"));
      return;
    }
    if (existing && HUMAN_REQUEST.test(speech)) {
      setBookingAction(callSid, existing.companyId, "ESCALATE_TO_HUMAN", existing.stateVersion);
      releaseBookingHold(callSid);
      res.type("text/xml").send(gatherResponse(req, "Absolutely. I'll have someone from the team help with this request."));
      return;
    }

    let state = getBookingState(callSid, call.companyId);
    if (!state.customerPhone && call.log?.fromNumber && call.log.fromNumber !== "Anonymous") {
      state = setCustomerDetails(callSid, call.companyId, {
        customerPhone: normalizedPhone(call.log.fromNumber),
        customerPhoneSource: "caller_id",
        customerPhoneConfirmed: false,
      }, state.stateVersion);
    }

    const before = { serviceId: state.serviceId, requestedDay: state.requestedDay, requestedDaypart: state.requestedDaypart, requestedTime: state.requestedTime };
    const previousAction = state.lastAction;
    const updated = await updateStateFromSpeech(state, speech);
    const services = updated.services;
    state = updated.state;
    const schedulingChanged = before.serviceId !== state.serviceId || before.requestedDay !== state.requestedDay || before.requestedDaypart !== state.requestedDaypart || before.requestedTime !== state.requestedTime;

    if (SOONEST.test(speech) && !state.requestedDay) {
      state = setSchedulingPreference(callSid, state.companyId, { requestedDay: "soonest" }, state.stateVersion);
    }

    if (previousAction === "ASK_PHONE_CONFIRMATION" && state.customerPhone && !state.customerPhoneConfirmed && YES.test(speech)) {
      state = setCustomerDetails(callSid, state.companyId, { customerPhoneConfirmed: true }, state.stateVersion);
    } else if (previousAction === "ASK_PHONE_CONFIRMATION" && state.customerPhone && !state.customerPhoneConfirmed && NO.test(speech) && !extractCustomerDetails(speech, previousAction).customerPhone) {
      state = setCustomerDetails(callSid, state.companyId, { customerPhone: null, customerPhoneSource: null, customerPhoneConfirmed: false }, state.stateVersion);
    }

    if (state.offeredSlots.length && !state.selectedSlot && !schedulingChanged) {
      const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, state.companyId));
      const timeZone = settings?.timezone || "America/Toronto";
      const chosen = selectedSlot(speech, state.offeredSlots, timeZone);
      if (chosen) {
        try {
          state = holdBookingSlot(callSid, state.companyId, chosen, undefined, state.stateVersion);
          state = setBookingAction(callSid, state.companyId, "HOLD_SLOT", state.stateVersion);
          logger.info({ callSid, selected: chosen.iso, end: chosen.endIso, holdExpiresAt: state.holdExpiresAt, stateVersion: state.stateVersion }, "Held exact selected slot for caller");
        } catch (error: any) {
          if (error instanceof StaleBookingStateError) throw error;
          const current = getBookingState(callSid, state.companyId);
          state = setAvailabilityResult(callSid, state.companyId, [], current.stateVersion);
          startAvailabilityCheck(callSid, state, true);
          res.type("text/xml").send(workingResponse(req, callSid, true, state.requestedDay));
          return;
        }
      } else if (REJECT_OFFER.test(speech)) {
        const remaining = state.offeredSlots.slice(Math.min(3, state.offeredSlots.length));
        if (remaining.length) {
          state = setAvailabilityResult(callSid, state.companyId, remaining, state.stateVersion);
          state = setBookingAction(callSid, state.companyId, "OFFER_SLOTS", state.stateVersion);
          res.type("text/xml").send(gatherResponse(req, `No problem. ${spokenOptions(remaining.map(slot => ({ ...slot, start: new Date(slot.iso), end: new Date(slot.endIso) })), timeZone, state.requestedDay)}`));
          return;
        }
        state = setAvailabilityResult(callSid, state.companyId, [], state.stateVersion);
        setBookingAction(callSid, state.companyId, "NO_AVAILABILITY", state.stateVersion);
        res.type("text/xml").send(gatherResponse(req, "No problem. Would later that day work, or should I check another day?"));
        return;
      } else {
        res.type("text/xml").send(gatherResponse(req, spokenOptions(state.offeredSlots.slice(0, 3).map(slot => ({ ...slot, start: new Date(slot.iso), end: new Date(slot.endIso) })), timeZone, state.requestedDay)));
        return;
      }
    }

    if (schedulingChanged && state.serviceId !== null && state.requestedDay) {
      startAvailabilityCheck(callSid, state);
      res.type("text/xml").send(workingResponse(req, callSid, true, state.requestedDay));
      return;
    }

    if (previousAction === "CONFIRM_BOOKING" && state.selectedSlot && YES.test(speech)) {
      state = markBookingConfirmed(callSid, state.companyId, state.stateVersion);
      state = setBookingAction(callSid, state.companyId, "CREATE_BOOKING", state.stateVersion);
      const created = await createValidatedBooking(call, state);
      if (!created.ok && created.retryAvailability) {
        state = getBookingState(callSid, state.companyId);
        startAvailabilityCheck(callSid, state, true);
        res.type("text/xml").send(gatherResponse(req, `${created.text} One moment.`));
        return;
      }
      res.type("text/xml").send(gatherResponse(req, created.text));
      return;
    }
    if (previousAction === "CONFIRM_BOOKING" && NO.test(speech) && !schedulingChanged) {
      state.confirmed = false;
      state = setBookingAction(callSid, state.companyId, "CONFIRM_BOOKING", state.stateVersion);
      res.type("text/xml").send(gatherResponse(req, "No problem. What would you like to change?"));
      return;
    }

    const decision = nextDecision(state, services.length);
    state = setBookingAction(callSid, state.companyId, decision.action, state.stateVersion);

    if (decision.action === "SEARCH_AVAILABILITY" || decision.action === "REVALIDATE_AVAILABILITY") {
      startAvailabilityCheck(callSid, state, decision.action === "REVALIDATE_AVAILABILITY");
      res.type("text/xml").send(workingResponse(req, callSid, true, state.requestedDay));
      return;
    }
    if (decision.action === "CREATE_BOOKING") {
      const created = await createValidatedBooking(call, state);
      res.type("text/xml").send(gatherResponse(req, created.text));
      return;
    }
    if (decision.action === "OFFER_SLOTS") {
      const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, state.companyId));
      const timeZone = settings?.timezone || "America/Toronto";
      res.type("text/xml").send(gatherResponse(req, spokenOptions(state.offeredSlots.map(slot => ({ ...slot, start: new Date(slot.iso), end: new Date(slot.endIso) })), timeZone, state.requestedDay)));
      return;
    }
    if (decision.action === "ESCALATE_TO_HUMAN") {
      releaseBookingHold(callSid);
    }

    res.type("text/xml").send(gatherResponse(req, decision.text || "What would you like to do?"));
  } catch (error: any) {
    if (error instanceof StaleBookingStateError) {
      logger.warn({ callSid, expected: error.expectedVersion, actual: error.actualVersion }, "Ignored stale concurrent booking webhook update");
      const state = peekBookingState(callSid);
      res.type("text/xml").send(gatherResponse(req, state?.lastAction === "OFFER_SLOTS" ? "I have the latest availability ready. Which time works best for you?" : "Got it. What would you like to do next?"));
      return;
    }
    logger.error({ callSid, err: error?.message, stack: error?.stack }, "Action-driven booking orchestrator failed; falling back to general AI");
    next();
  }
});

setInterval(() => {
  const now = Date.now();
  expireBookingStates(now);
  for (const [callSid, check] of pendingChecks) if (check.expiresAt <= now) pendingChecks.delete(callSid);
}, 60_000).unref();

export default router;
