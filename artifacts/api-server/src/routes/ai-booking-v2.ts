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

const router: IRouter = Router();
const FALLBACK_VOICE = "Google.en-US-Neural2-F";
const SOONEST = /\b(soonest|earliest|first available|as soon as possible|asap|next available|whatever is soonest)\b/i;
const BOOKING_WORDS = /\b(book|booking|appointment|schedule|availability|available|slot|service|tire|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

type Slot = { start: Date; end: Date; resourceId: number; serviceId: number | null; label: string; iso: string };
type PendingOffer = { companyId: number; slots: Slot[]; expiresAt: number };
const pendingOffers = new Map<string, PendingOffer>();

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
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  return { year: value("year"), month: value("month"), day: value("day"), hour: value("hour"), minute: value("minute"), second: value("second") };
}

function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - date.getTime();
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
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function spokenOptions(slots: Slot[], timeZone: string): string {
  const labels = slots.map(s => new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(s.start));
  if (labels.length === 1) return `The soonest opening I have is ${labels[0]}. Does that work for you?`;
  if (labels.length === 2) return `The soonest openings I have are ${labels[0]} or ${labels[1]}. Which one works better for you?`;
  return `The soonest openings I have are ${labels[0]}, ${labels[1]}, or ${labels[2]}. Which one would you like?`;
}

async function resolveCall(callSid: string) {
  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, callSid));
  if (!log?.phoneNumberId) return null;
  const [phone] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, log.phoneNumberId));
  if (!phone?.companyId) return null;
  return { log, phone, companyId: phone.companyId };
}

async function findSoonest(companyId: number, speech: string): Promise<{ slots: Slot[]; timeZone: string }> {
  const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, companyId));
  const timeZone = settings?.timezone || "America/Toronto";
  if (settings && settings.enabled === false) return { slots: [], timeZone };

  const [resources, availability, timeOff, services, appointments] = await Promise.all([
    db.select().from(bookingResourcesTable).where(and(eq(bookingResourcesTable.companyId, companyId), eq(bookingResourcesTable.active, true))),
    db.select().from(bookingAvailabilityTable).where(and(eq(bookingAvailabilityTable.companyId, companyId), eq(bookingAvailabilityTable.active, true))),
    db.select().from(bookingTimeOffTable).where(eq(bookingTimeOffTable.companyId, companyId)),
    db.select().from(bookingServicesTable).where(and(eq(bookingServicesTable.companyId, companyId), eq(bookingServicesTable.active, true))),
    db.select().from(appointmentsTable).where(and(eq(appointmentsTable.companyId, companyId), ne(appointmentsTable.status, "cancelled"))),
  ]);

  if (!resources.length || !availability.length) return { slots: [], timeZone };

  const words = speech.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2);
  const scoredServices = services.map(service => ({
    service,
    score: words.filter(word => `${service.name} ${service.description ?? ""}`.toLowerCase().includes(word)).length,
  })).sort((a, b) => b.score - a.score || a.service.durationMinutes - b.service.durationMinutes);
  const selectedService = scoredServices[0]?.service ?? null;
  const durationMinutes = selectedService?.durationMinutes ?? 60;
  const before = selectedService?.bufferBeforeMinutes ?? 0;
  const after = selectedService?.bufferAfterMinutes ?? 0;
  const interval = Math.max(5, settings?.slotIntervalMinutes ?? 30);
  const minNotice = Math.max(0, settings?.minimumNoticeMinutes ?? 60);
  const horizon = Math.min(90, Math.max(1, settings?.maximumAdvanceDays ?? 90));
  const now = new Date();
  const earliest = new Date(now.getTime() + minNotice * 60_000);
  const today = localParts(now, timeZone);
  const candidates: Slot[] = [];

  for (let offset = 0; offset <= horizon && candidates.length < 12; offset++) {
    const date = addCalendarDays(today.year, today.month, today.day, offset);
    const dayOfWeek = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();

    for (const resource of resources) {
      const windows = availability.filter(a => a.resourceId === resource.id && a.dayOfWeek === dayOfWeek);
      for (const window of windows) {
        const [startHour, startMinute] = parseClock(window.startTime);
        const [endHour, endMinute] = parseClock(window.endTime);
        const windowStart = zonedToUtc(date.year, date.month, date.day, startHour, startMinute, timeZone);
        const windowEnd = zonedToUtc(date.year, date.month, date.day, endHour, endMinute, timeZone);

        for (let start = new Date(windowStart); start.getTime() + durationMinutes * 60_000 <= windowEnd.getTime(); start = new Date(start.getTime() + interval * 60_000)) {
          if (start < earliest) continue;
          const end = new Date(start.getTime() + durationMinutes * 60_000);
          const occupiedStart = new Date(start.getTime() - before * 60_000);
          const occupiedEnd = new Date(end.getTime() + after * 60_000);

          const blockedByTimeOff = timeOff.some(t => t.resourceId === resource.id && overlaps(occupiedStart, occupiedEnd, t.startTime, t.endTime));
          if (blockedByTimeOff) continue;

          const blockedByAppointment = appointments.some(a => {
            if (a.resourceId != null && a.resourceId !== resource.id) return false;
            const appointmentEnd = a.endTime ?? new Date(a.startTime.getTime() + durationMinutes * 60_000);
            return overlaps(occupiedStart, occupiedEnd, a.startTime, appointmentEnd);
          });
          if (blockedByAppointment) continue;

          candidates.push({
            start,
            end,
            resourceId: resource.id,
            serviceId: selectedService?.id ?? null,
            label: slotLabel(start, timeZone),
            iso: start.toISOString(),
          });
          if (candidates.length >= 12) break;
        }
      }
    }
  }

  const unique = Array.from(new Map(candidates.sort((a, b) => a.start.getTime() - b.start.getTime()).map(slot => [slot.start.toISOString(), slot])).values());
  return { slots: unique.slice(0, 3), timeZone };
}

function selectedSlot(speech: string, slots: Slot[], timeZone: string): Slot | null {
  const normalized = speech.toLowerCase();
  if (slots.length === 1 && /\b(yes|yeah|yep|sure|okay|ok|works|perfect|good)\b/i.test(speech)) return slots[0];
  if (/\b(first|one|1)\b/i.test(speech)) return slots[0] ?? null;
  if (/\b(second|two|2)\b/i.test(speech)) return slots[1] ?? null;
  if (/\b(third|three|3)\b/i.test(speech)) return slots[2] ?? null;

  for (const slot of slots) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(slot.start);
    const weekday = parts.find(p => p.type === "weekday")?.value?.toLowerCase() ?? "";
    const hour = parts.find(p => p.type === "hour")?.value ?? "";
    const minute = parts.find(p => p.type === "minute")?.value ?? "00";
    const period = parts.find(p => p.type === "dayPeriod")?.value?.toLowerCase() ?? "";
    if (weekday && normalized.includes(weekday) && normalized.includes(hour)) return slot;
    if (normalized.includes(`${hour}:${minute}`) || normalized.includes(`${hour} ${period}`) || normalized.includes(`${hour}${period}`)) return slot;
  }
  return null;
}

router.use("/twilio/ai-gather", async (req: any, res: any, next: any) => {
  const callSid = String(req.body?.CallSid ?? "");
  const speech = String(req.body?.SpeechResult ?? "").trim();
  if (!callSid || !speech) { next(); return; }

  try {
    const call = await resolveCall(callSid);
    if (!call) { next(); return; }

    const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, call.companyId));
    const timeZone = settings?.timezone || "America/Toronto";
    const nowText = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date());

    const pending = pendingOffers.get(callSid);
    if (pending && pending.expiresAt > Date.now()) {
      const chosen = selectedSlot(speech, pending.slots, timeZone);
      if (!chosen) {
        const offer = spokenOptions(pending.slots, timeZone);
        res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(`I want to make sure I book the right time. ${offer}`)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n  <Redirect method="POST">${baseUrl(req)}/api/twilio/ai-continue?callSid=${encodeURIComponent(callSid)}</Redirect>\n</Response>`);
        return;
      }

      pendingOffers.delete(callSid);
      req.body.SpeechResult = `${speech}. I explicitly choose and confirm ${chosen.label}. Use this exact appointment start time: ${chosen.iso}. Current local time is ${nowText}. Do not substitute another date or year.`;
      logger.info({ callSid, selected: chosen.iso }, "Caller selected offered availability slot");
      next();
      return;
    }

    if (SOONEST.test(speech)) {
      const { slots } = await findSoonest(call.companyId, speech);
      if (!slots.length) {
        res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml("I don't see an open appointment slot on the configured calendar right now. I can take your details and have the team contact you to arrange the soonest time.")}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n  <Hangup/>\n</Response>`);
        return;
      }

      pendingOffers.set(callSid, { companyId: call.companyId, slots, expiresAt: Date.now() + 10 * 60_000 });
      const offer = spokenOptions(slots, timeZone);
      logger.info({ callSid, slots: slots.map(s => s.iso) }, "Offered real calendar availability to caller");
      res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(offer)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n  <Redirect method="POST">${baseUrl(req)}/api/twilio/ai-continue?callSid=${encodeURIComponent(callSid)}</Redirect>\n</Response>`);
      return;
    }

    if (BOOKING_WORDS.test(speech)) {
      req.body.SpeechResult = `${speech}. [Reliable scheduling context: the current local date/time is ${nowText}. Never infer a past year. Never book a time the caller has not explicitly accepted.]`;
    }

    next();
  } catch (error: any) {
    logger.error({ callSid, err: error?.message }, "AI booking v2 middleware failed; falling back to existing flow");
    next();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [sid, offer] of pendingOffers) if (offer.expiresAt <= now) pendingOffers.delete(sid);
}, 60_000).unref();

export default router;
