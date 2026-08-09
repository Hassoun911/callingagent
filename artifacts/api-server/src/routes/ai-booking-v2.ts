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
const SOONEST = /\b(soonest|earliest|first\s+(?:available|opening|slot|appointment|one)|next\s+(?:available|opening|slot|appointment)|as\s+soon\s+as\s+(?:possible|you\s+can|you\s+have)|soon\s+as\s+(?:possible|you\s+can)|whatever\s+(?:is|you\s+have)\s+(?:first|soonest|earliest)|whatever\s+comes\s+first|first\s+thing\s+available|book\s+me\s+(?:the\s+)?(?:soonest|earliest)|any\s+time\s+(?:soon|available)|asap)\b/i;
const BOOKING_WORDS = /\b(book|booking|appointment|schedule|availability|available|slot|service|tire|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|soonest|earliest|asap)\b/i;
const REJECT_OFFER = /\b(no|nope|nah|not that|not those|another|different|something else|other option|other time|another spot|another time|later one|find me another)\b/i;

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

function shortSlotLabel(start: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
}

function spokenOptions(slots: Slot[], timeZone: string): string {
  const visible = slots.slice(0, 3);
  const labels = visible.map(s => shortSlotLabel(s.start, timeZone));
  if (labels.length === 1) return `I have ${labels[0]} available. Does that work?`;
  if (labels.length === 2) return `I have ${labels[0]} or ${labels[1]}. Which works better?`;
  return `I have ${labels[0]}, ${labels[1]}, or ${labels[2]}. Which one works for you?`;
}

function gatherResponse(req: any, text: string, callSid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  <Say voice="${FALLBACK_VOICE}">${xml(text)}</Say>\n  <Gather input="speech" timeout="10" speechTimeout="auto" speechModel="experimental_conversations" language="en-US" action="${baseUrl(req)}/api/twilio/ai-gather" method="POST"></Gather>\n  <Redirect method="POST">${baseUrl(req)}/api/twilio/ai-continue?callSid=${encodeURIComponent(callSid)}</Redirect>\n</Response>`;
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

  for (let offset = 0; offset <= horizon && candidates.length < 24; offset++) {
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

          if (timeOff.some(t => t.resourceId === resource.id && overlaps(occupiedStart, occupiedEnd, t.startTime, t.endTime))) continue;
          if (appointments.some(a => {
            if (a.resourceId != null && a.resourceId !== resource.id) return false;
            const appointmentEnd = a.endTime ?? new Date(a.startTime.getTime() + durationMinutes * 60_000);
            return overlaps(occupiedStart, occupiedEnd, a.startTime, appointmentEnd);
          })) continue;

          candidates.push({ start, end, resourceId: resource.id, serviceId: selectedService?.id ?? null, label: slotLabel(start, timeZone), iso: start.toISOString() });
          if (candidates.length >= 24) break;
        }
      }
    }
  }

  const unique = Array.from(new Map(candidates.sort((a, b) => a.start.getTime() - b.start.getTime()).map(slot => [slot.start.toISOString(), slot])).values());
  return { slots: unique.slice(0, 12), timeZone };
}

function selectedSlot(speech: string, slots: Slot[], timeZone: string): Slot | null {
  const normalized = speech.toLowerCase();
  const visible = slots.slice(0, 3);
  if (visible.length === 1 && /\b(yes|yeah|yep|sure|okay|ok|works|perfect|good)\b/i.test(speech)) return visible[0];
  if (/\b(first|one|1)\b/i.test(speech)) return visible[0] ?? null;
  if (/\b(second|two|2)\b/i.test(speech)) return visible[1] ?? null;
  if (/\b(third|three|3)\b/i.test(speech)) return visible[2] ?? null;

  for (const slot of visible) {
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
    const call = await resolveCall(req, callSid);
    if (!call) {
      logger.warn({ callSid, to: req.body?.To, speech: speech.slice(0, 120) }, "Could not resolve company for live booking turn");
      next();
      return;
    }

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
    }).format(new Date());

    const pending = pendingOffers.get(callSid);
    if (pending && pending.expiresAt > Date.now()) {
      const chosen = selectedSlot(speech, pending.slots, timeZone);
      if (chosen) {
        pendingOffers.delete(callSid);
        req.body.SpeechResult = `${speech}. I explicitly choose and confirm ${chosen.label}. Use this exact appointment start time: ${chosen.iso}. Current Eastern local time is ${nowText}. Do not substitute another date or year.`;
        logger.info({ callSid, selected: chosen.iso }, "Caller selected offered availability slot");
        next();
        return;
      }

      if (REJECT_OFFER.test(speech)) {
        const remaining = pending.slots.slice(Math.min(3, pending.slots.length));
        if (remaining.length) {
          pendingOffers.set(callSid, { ...pending, slots: remaining, expiresAt: Date.now() + 10 * 60_000 });
          const response = `Sure. ${spokenOptions(remaining, timeZone)}`;
          res.type("text/xml").send(gatherResponse(req, response, callSid));
          return;
        }
        pendingOffers.delete(callSid);
        res.type("text/xml").send(gatherResponse(req, "Those are the next openings I have. If you want, tell me a different day and I can check that instead.", callSid));
        return;
      }

      res.type("text/xml").send(gatherResponse(req, spokenOptions(pending.slots, timeZone), callSid));
      return;
    }

    if (SOONEST.test(speech)) {
      const { slots } = await findSoonest(call.companyId, speech);
      if (!slots.length) {
        res.type("text/xml").send(gatherResponse(req, "I checked availability, but I don't see an open spot right now. You can give me another day, or I can have the team follow up.", callSid));
        return;
      }

      pendingOffers.set(callSid, { companyId: call.companyId, slots, expiresAt: Date.now() + 10 * 60_000 });
      const offer = `Let me check availability. ${spokenOptions(slots, timeZone)}`;
      logger.info({ callSid, companyId: call.companyId, slots: slots.slice(0, 3).map(s => s.iso) }, "Offered real calendar availability to caller");
      res.type("text/xml").send(gatherResponse(req, offer, callSid));
      return;
    }

    if (BOOKING_WORDS.test(speech)) {
      req.body.SpeechResult = `${speech}. [Scheduling context for internal use only: current Eastern local date/time is ${nowText}. Keep spoken replies natural and short. Say only "Let me check availability" before checking; do not read the current day, date, year, or timezone aloud. When offering an opening, say the day and time only unless the caller asks for the date. If the caller rejects a slot, simply offer another available slot without repeating that you are checking the calendar. Never infer a past year. Never book a time the caller has not explicitly accepted.]`;
    }

    next();
  } catch (error: any) {
    logger.error({ callSid, err: error?.message }, "AI booking availability middleware failed; falling back to existing flow");
    next();
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [sid, offer] of pendingOffers) if (offer.expiresAt <= now) pendingOffers.delete(sid);
}, 60_000).unref();

export default router;
