import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  bookingAvailabilityTable,
  bookingResourcesTable,
  bookingServicesTable,
  bookingSettingsTable,
  bookingTimeOffTable,
  callLogsTable,
  phoneNumbersTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  bookingStatePrompt,
  expireBookingStates,
  getBookingState,
  holdBookingSlot,
  isSlotHeldByAnother,
  peekBookingState,
  setAvailabilityResult,
  setCustomerDetails,
  setSchedulingPreference,
  type BookingDaypart,
  type BookingSlotState,
  type LiveBookingState,
} from "../lib/booking-state-manager";

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const BOOKING_INTENT = /\b(book|booking|appointment|schedule|scheduled|scheduling|availability|available|opening|openings|slot|slots|come in)\b/i;
const SOONEST = /\b(soonest|earliest|first available|next available|as soon as possible|as soon as you can|asap|whatever you have first|first thing available)\b/i;
const REJECT_OFFER = /\b(no|nope|nah|none|not that|not those|another|different|something else|other option|other time|another spot|another time|later one|find me another|none of those)\b/i;
const RESCHEDULE_OR_CANCEL = /\b(reschedule|cancel|change my appointment|move my appointment)\b/i;

type Slot = BookingSlotState & { start: Date; end: Date };
type CalendarResult = { slots: Slot[]; timeZone: string };
type PendingCheck = {
  callSid: string;
  companyId: number;
  stateVersion: number;
  expiresAt: number;
  result?: CalendarResult;
  error?: string;
};

const pendingChecks = new Map<string, PendingCheck>();

function baseUrl(req: any): string {
  return process.env.APP_URL
    ? process.env.APP_URL.replace(/\/$/, "")
    : process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${req.protocol}://${req.get("host")}`;
}

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizedPhone(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return {
    year: value("year"), month: value("month"), day: value("day"),
    hour: value("hour"), minute: value("minute"), second: value("second"),
  };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  let guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  for (let i = 0; i < 2; i++) {
    guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0) - zoneOffsetMs(guess, timeZone));
  }
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

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function slotLabel(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function shortSlotLabel(start: Date, timeZone: string, includeDay = true): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(includeDay ? { weekday: "long" as const } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function spokenOptions(slots: Slot[], timeZone: string, requestedDay: string | null): string {
  const visible = slots.slice(0, 3);
  const includeDay = !requestedDay || SOONEST.test(requestedDay);
  const labels = visible.map(slot => shortSlotLabel(slot.start, timeZone, includeDay));
  if (labels.length === 1) return `I have ${labels[0]} available. Does that work?`;
  if (labels.length === 2) return `I have ${labels[0]} or ${labels[1]}. Which works better?`;
  return `I have ${labels[0]}, ${labels[1]}, or ${labels[2]}. Which one works for you?`;
}

function gatherResponse(req: any, text: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(text)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n  <Say voice="${FALLBACK_VOICE}">Are you still there?</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n</Response>`;
}

function workingResponse(req: any, callSid: string, firstPass: boolean, requestedDay: string | null): string {
  const nextUrl = `${baseUrl(req)}/api/twilio/booking-availability-result?callSid=${encodeURIComponent(callSid)}`;
  const soundUrl = `${baseUrl(req)}/api/twilio/booking-working-sound.wav`;
  const intro = requestedDay && !SOONEST.test(requestedDay)
    ? `Sure, I'll check ${requestedDay}.`
    : "Absolutely, I'll check availability.";
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
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

const workingSound = buildWorkingSound();
router.get("/twilio/booking-working-sound.wav", (_req, res): void => {
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", workingSound.length);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(workingSound);
});

function extractRequestedDay(speech: string): string | null {
  if (/\btoday\b/i.test(speech)) return "today";
  if (/\btomorrow\b/i.test(speech)) return "tomorrow";

  const weekday = speech.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (weekday) {
    const name = weekday[2][0].toUpperCase() + weekday[2].slice(1).toLowerCase();
    return weekday[1] ? `next ${name}` : name;
  }

  const monthPattern = MONTHS.join("|");
  const monthDay = speech.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"));
  if (monthDay) {
    const month = monthDay[1][0].toUpperCase() + monthDay[1].slice(1).toLowerCase();
    return `${month} ${Number(monthDay[2])}`;
  }

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
  if (!state.requestedDay || SOONEST.test(state.requestedDay)) return null;
  const today = localParts(now, timeZone);

  if (state.requestedDay === "today") return { year: today.year, month: today.month, day: today.day };
  if (state.requestedDay === "tomorrow") return addCalendarDays(today.year, today.month, today.day, 1);

  const weekday = state.requestedDay.match(/^(next\s+)?(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)$/i);
  if (weekday) {
    const target = WEEKDAYS.findIndex(day => day.toLowerCase() === weekday[2].toLowerCase());
    const todayDow = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay();
    let offset = (target - todayDow + 7) % 7;
    if (weekday[1]) offset = offset === 0 ? 7 : offset + 7;
    return addCalendarDays(today.year, today.month, today.day, offset);
  }

  const monthDay = state.requestedDay.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (monthDay) {
    const month = MONTHS.findIndex(m => m.toLowerCase() === monthDay[1].toLowerCase()) + 1;
    if (!month) return null;
    const day = Number(monthDay[2]);
    let year = today.year;
    const candidate = Date.UTC(year, month - 1, day);
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
    if (candidate < todayUtc) year += 1;
    return { year, month, day };
  }

  return null;
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

function extractCustomerDetails(speech: string) {
  const nameMatch = speech.match(/\b(?:my name is|name is|this is)\s+([A-Za-z][A-Za-z' -]{1,60})/i);
  const emailMatch = speech.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  const phoneMatch = speech.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return {
    customerName: nameMatch?.[1]?.trim() || undefined,
    customerEmail: emailMatch?.[0] || undefined,
    customerPhone: phoneMatch?.[0] || undefined,
  };
}

function serviceScore(speech: string, name: string, description?: string | null): number {
  const source = `${name} ${description ?? ""}`.toLowerCase();
  const words = speech.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
  let score = 0;
  if (speech.toLowerCase().includes(name.toLowerCase())) score += 20;
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
  return db.select().from(bookingServicesTable)
    .where(and(eq(bookingServicesTable.companyId, companyId), eq(bookingServicesTable.active, true)));
}

async function updateStateFromSpeech(state: LiveBookingState, speech: string) {
  const services = await loadServices(state.companyId);
  const ranked = services
    .map(service => ({ service, score: serviceScore(speech, service.name, service.description) }))
    .sort((a, b) => b.score - a.score);
  const matched = ranked[0]?.score > 0 ? ranked[0].service : null;
  const singleService = services.length === 1 ? services[0] : null;

  const requestedDay = extractRequestedDay(speech);
  const requestedDaypart = extractDaypart(speech);
  const requestedTime = extractRequestedTime(speech);

  setSchedulingPreference(state.callSid, state.companyId, {
    ...(matched ? { serviceId: matched.id, serviceName: matched.name } : (!state.serviceId && singleService ? { serviceId: singleService.id, serviceName: singleService.name } : {})),
    ...(requestedDay ? { requestedDay } : {}),
    ...(requestedDaypart !== undefined ? { requestedDaypart } : {}),
    ...(requestedTime !== undefined ? { requestedTime } : {}),
  });

  const details = extractCustomerDetails(speech);
  if (details.customerName || details.customerEmail || details.customerPhone) {
    setCustomerDetails(state.callSid, state.companyId, details);
  }

  return { services, matchedService: matched };
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

  const selectedService = state.serviceId
    ? services.find(service => service.id === state.serviceId) ?? null
    : (services.length === 1 ? services[0] : null);
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

          const iso = start.toISOString();
          if (isSlotHeldByAnother(callSid, state.companyId, resource.id, iso)) continue;

          candidates.push({
            start,
            end,
            iso,
            label: slotLabel(start, timeZone),
            resourceId: resource.id,
            serviceId: selectedService?.id ?? null,
          });
        }
      }
    }

    // A specific day should never spill into later days. For a general/soonest
    // request, stop once enough useful choices have been found.
    if (requested) break;
    if (candidates.length >= 12) break;
  }

  const unique = Array.from(new Map(
    candidates.map(slot => [`${slot.resourceId}:${slot.iso}`, slot]),
  ).values());

  unique.sort((a, b) => {
    if (preferredMinutes == null) return a.start.getTime() - b.start.getTime();
    const pa = localParts(a.start, timeZone);
    const pb = localParts(b.start, timeZone);
    const da = Math.abs(pa.hour * 60 + pa.minute - preferredMinutes);
    const db = Math.abs(pb.hour * 60 + pb.minute - preferredMinutes);
    return da - db || a.start.getTime() - b.start.getTime();
  });

  return { slots: unique.slice(0, 12), timeZone };
}

function selectedSlot(speech: string, slots: BookingSlotState[], timeZone: string): BookingSlotState | null {
  const visible = slots.slice(0, 3);
  if (visible.length === 1 && /\b(yes|yeah|yep|sure|okay|ok|works|perfect|good|that works)\b/i.test(speech)) return visible[0];
  if (/\b(first|one|1)\b/i.test(speech)) return visible[0] ?? null;
  if (/\b(second|two|2)\b/i.test(speech)) return visible[1] ?? null;
  if (/\b(third|three|3)\b/i.test(speech)) return visible[2] ?? null;

  const normalized = speech.toLowerCase();
  for (const slot of visible) {
    const start = new Date(slot.iso);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).formatToParts(start);
    const weekday = parts.find(part => part.type === "weekday")?.value?.toLowerCase() ?? "";
    const hour = parts.find(part => part.type === "hour")?.value ?? "";
    const minute = parts.find(part => part.type === "minute")?.value ?? "00";
    const period = parts.find(part => part.type === "dayPeriod")?.value?.toLowerCase() ?? "";
    if (weekday && normalized.includes(weekday) && normalized.includes(hour)) return slot;
    if (normalized.includes(`${hour}:${minute}`) || normalized.includes(`${hour} ${period}`) || normalized.includes(`${hour}${period}`)) return slot;
  }
  return null;
}

function startAvailabilityCheck(callSid: string, state: LiveBookingState): PendingCheck {
  const check: PendingCheck = {
    callSid,
    companyId: state.companyId,
    stateVersion: state.updatedAt,
    expiresAt: Date.now() + 60_000,
  };
  pendingChecks.set(callSid, check);

  void findAvailability(callSid, state)
    .then(result => {
      const current = pendingChecks.get(callSid);
      if (current === check) current.result = result;
    })
    .catch((error: any) => {
      const current = pendingChecks.get(callSid);
      if (current === check) current.error = error?.message || "Availability lookup failed";
      logger.error({ callSid, companyId: state.companyId, err: error?.message }, "State-driven availability lookup failed");
    });
  return check;
}

router.post("/twilio/booking-availability-result", async (req: any, res): Promise<void> => {
  const callSid = String(req.query.callSid ?? req.body?.CallSid ?? "");
  const check = pendingChecks.get(callSid);
  if (!callSid || !check) {
    res.type("text/xml").send(gatherResponse(req, "I had trouble checking that. What day works best for you?"));
    return;
  }
  if (check.error) {
    pendingChecks.delete(callSid);
    res.type("text/xml").send(gatherResponse(req, "I couldn't reach the calendar just now. What other day works for you?"));
    return;
  }
  if (!check.result) {
    const state = peekBookingState(callSid);
    res.type("text/xml").send(workingResponse(req, callSid, false, state?.requestedDay ?? null));
    return;
  }

  pendingChecks.delete(callSid);
  const state = peekBookingState(callSid);
  if (!state || state.companyId !== check.companyId || state.updatedAt !== check.stateVersion) {
    // Preference changed while the old lookup was running. Never speak stale slots.
    if (state) startAvailabilityCheck(callSid, state);
    res.type("text/xml").send(workingResponse(req, callSid, false, state?.requestedDay ?? null));
    return;
  }

  const { slots, timeZone } = check.result;
  setAvailabilityResult(callSid, state.companyId, slots);
  if (!slots.length) {
    const requested = state.requestedDay && !SOONEST.test(state.requestedDay) ? ` on ${state.requestedDay}` : "";
    res.type("text/xml").send(gatherResponse(req, `I don't have an opening${requested}. Would you like me to check another day?`));
    return;
  }

  logger.info({
    callSid,
    companyId: state.companyId,
    service: state.serviceName,
    requestedDay: state.requestedDay,
    requestedDaypart: state.requestedDaypart,
    requestedTime: state.requestedTime,
    slots: slots.slice(0, 3).map(slot => slot.iso),
  }, "Offered state-driven real calendar availability");

  res.type("text/xml").send(gatherResponse(req, spokenOptions(slots, timeZone, state.requestedDay)));
});

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech || RESCHEDULE_OR_CANCEL.test(speech)) {
    next();
    return;
  }

  try {
    const call = await resolveCall(req, callSid);
    if (!call) {
      next();
      return;
    }

    const existing = peekBookingState(callSid);
    const hasIntent = BOOKING_INTENT.test(speech) || SOONEST.test(speech);
    if (!existing && !hasIntent) {
      next();
      return;
    }

    let state = getBookingState(callSid, call.companyId);
    if (!state.customerPhone && call.log?.fromNumber && call.log.fromNumber !== "Anonymous") {
      state = setCustomerDetails(callSid, call.companyId, { customerPhone: call.log.fromNumber });
    }

    const before = {
      serviceId: state.serviceId,
      requestedDay: state.requestedDay,
      requestedDaypart: state.requestedDaypart,
      requestedTime: state.requestedTime,
    };
    const { services } = await updateStateFromSpeech(state, speech);
    state = getBookingState(callSid, call.companyId);

    const schedulingChanged =
      before.serviceId !== state.serviceId ||
      before.requestedDay !== state.requestedDay ||
      before.requestedDaypart !== state.requestedDaypart ||
      before.requestedTime !== state.requestedTime;

    // Once a slot is selected, unrelated information belongs to the normal AI
    // conversation. We only step back into calendar search if the caller changes
    // service/date/time.
    if (state.selectedSlot && !schedulingChanged) {
      req.body.SpeechResult = `${speech}. ${bookingStatePrompt(state)} Continue naturally. Collect only missing required customer or service-specific information. Do not ask for the phone number again; ask whether to use caller ID if confirmation is needed. Do not create the appointment until the caller has confirmed the selected slot and required details.`;
      next();
      return;
    }

    if (state.offeredSlots.length && !schedulingChanged) {
      const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, state.companyId));
      const timeZone = settings?.timezone || "America/Toronto";
      const chosen = selectedSlot(speech, state.offeredSlots, timeZone);
      if (chosen) {
        try {
          state = holdBookingSlot(callSid, state.companyId, chosen);
        } catch {
          // A different caller grabbed/held it between offer and selection.
          setAvailabilityResult(callSid, state.companyId, []);
          startAvailabilityCheck(callSid, state);
          res.type("text/xml").send(workingResponse(req, callSid, true, state.requestedDay));
          return;
        }
        req.body.SpeechResult = `${speech}. The caller explicitly selected ${chosen.label}. Exact appointment start=${chosen.iso}. ${bookingStatePrompt(state)} The slot is temporarily held for this caller. Preserve the service/date/time already known. Next collect only the missing required details, then summarize once before creating the appointment.`;
        logger.info({ callSid, selected: chosen.iso, service: state.serviceName }, "Caller selected and temporarily held offered slot");
        next();
        return;
      }

      if (REJECT_OFFER.test(speech)) {
        const remaining = state.offeredSlots.slice(Math.min(3, state.offeredSlots.length));
        if (remaining.length) {
          setAvailabilityResult(callSid, state.companyId, remaining);
          res.type("text/xml").send(gatherResponse(req, `No problem. ${spokenOptions(remaining.map(slot => ({ ...slot, start: new Date(slot.iso), end: new Date(slot.iso) })), timeZone, state.requestedDay)}`));
          return;
        }
        setAvailabilityResult(callSid, state.companyId, []);
        res.type("text/xml").send(gatherResponse(req, "No problem. Would later that day work, or should I check another day?"));
        return;
      }

      // Caller may have volunteered name/email while deciding. We saved anything
      // recognizable above; do not lose it, but still ask for the missing slot choice.
      res.type("text/xml").send(gatherResponse(req, spokenOptions(
        state.offeredSlots.slice(0, 3).map(slot => ({ ...slot, start: new Date(slot.iso), end: new Date(slot.iso) })),
        timeZone,
        state.requestedDay,
      )));
      return;
    }

    // A changed scheduling field invalidates old offers automatically in the state
    // manager. If we now have enough to search, run a fresh lookup and preserve the
    // rest of the state.
    if (schedulingChanged && state.serviceId !== null && (state.requestedDay || SOONEST.test(speech))) {
      const check = startAvailabilityCheck(callSid, state);
      logger.info({ callSid, companyId: state.companyId, stateVersion: check.stateVersion }, "Caller changed one scheduling field; refreshing availability only");
      res.type("text/xml").send(workingResponse(req, callSid, true, state.requestedDay));
      return;
    }

    // Minimum-information policy: service first only when it is genuinely unknown.
    if (!state.serviceId && services.length > 1) {
      res.type("text/xml").send(gatherResponse(req, "Absolutely. What would you like the appointment for?"));
      return;
    }

    // If no services are configured, retain the old safe 60-minute fallback rather
    // than blocking booking entirely. If exactly one is configured it was selected
    // automatically by updateStateFromSpeech().
    if (!state.requestedDay && !SOONEST.test(speech)) {
      res.type("text/xml").send(gatherResponse(req, "Sure. What day works best for you?"));
      return;
    }

    if (SOONEST.test(speech) && !state.requestedDay) {
      setSchedulingPreference(callSid, state.companyId, { requestedDay: "soonest" });
      state = getBookingState(callSid, state.companyId);
    }

    const check = startAvailabilityCheck(callSid, state);
    logger.info({
      callSid,
      companyId: state.companyId,
      service: state.serviceName,
      requestedDay: state.requestedDay,
      requestedDaypart: state.requestedDaypart,
      requestedTime: state.requestedTime,
      stateVersion: check.stateVersion,
    }, "Started state-driven booking availability lookup");
    res.type("text/xml").send(workingResponse(req, callSid, true, state.requestedDay));
  } catch (error: any) {
    logger.error({ callSid, err: error?.message }, "Booking orchestrator failed; falling back to general AI");
    next();
  }
});

setInterval(() => {
  const now = Date.now();
  expireBookingStates(now);
  for (const [callSid, check] of pendingChecks) {
    if (check.expiresAt <= now) pendingChecks.delete(callSid);
  }
}, 60_000).unref();

export default router;
