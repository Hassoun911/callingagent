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
const NEW_APPOINTMENT = /\b(book|booking|appointment|schedule|availability|available)\b/i;
const RESCHEDULE_OR_CANCEL = /\b(reschedule|cancel|change my appointment|move my appointment)\b/i;
const EXPLICIT_TIME = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tonight|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\b/i;
const REJECT_OFFER = /\b(no|nope|nah|not that|not those|another|different|something else|other option|other time|another spot|another time|later one|find me another)\b/i;

type Slot = { start: Date; end: Date; resourceId: number; serviceId: number | null; label: string; iso: string };
type PendingOffer = { companyId: number; slots: Slot[]; expiresAt: number };
type AvailabilityResult = { slots: Slot[]; timeZone: string };
type PendingCheck = {
  companyId: number;
  speech: string;
  expiresAt: number;
  result?: AvailabilityResult;
  error?: string;
};

const pendingOffers = new Map<string, PendingOffer>();
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

function workingResponse(req: any, callSid: string, firstPass: boolean): string {
  const nextUrl = `${baseUrl(req)}/api/twilio/availability-result?callSid=${encodeURIComponent(callSid)}`;
  const soundUrl = `${baseUrl(req)}/api/twilio/working-sound.wav`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${firstPass ? `<Say voice="${FALLBACK_VOICE}">Of course, let me check availability.</Say>` : ""}\n  <Play>${soundUrl}</Play>\n  <Redirect method="POST">${nextUrl.replace(/&/g, "&amp;")}</Redirect>\n</Response>`;
}

function buildWorkingSound(): Buffer {
  // 1.65 seconds, 8 kHz, 16-bit mono PCM WAV. A quiet office-style typing
  // texture keeps the caller aware the request is actively processing without
  // using copyrighted audio assets or adding another external dependency.
  const sampleRate = 8000;
  const durationSeconds = 1.65;
  const samples = Math.floor(sampleRate * durationSeconds);
  const pcm = Buffer.alloc(samples * 2);
  const clicks = [0.08, 0.19, 0.31, 0.44, 0.57, 0.72, 0.84, 0.99, 1.12, 1.27, 1.41, 1.54];

  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    let value = 0;
    for (let c = 0; c < clicks.length; c++) {
      const dt = t - clicks[c];
      if (dt >= 0 && dt < 0.045) {
        const envelope = Math.exp(-dt * 72);
        const tone = Math.sin(2 * Math.PI * (760 + (c % 4) * 115) * dt);
        const snap = Math.sin(2 * Math.PI * 1900 * dt) * 0.28;
        value += (tone + snap) * envelope * 0.23;
      }
    }
    // Very low room noise so gaps between clicks never sound like a dropped call.
    value += Math.sin(2 * Math.PI * 92 * t) * 0.006;
    const sample = Math.max(-1, Math.min(1, value));
    pcm.writeInt16LE(Math.round(sample * 32767), i * 2);
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

router.get("/twilio/working-sound.wav", (_req, res): void => {
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Length", workingSound.length);
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.send(workingSound);
});

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

async function findSoonest(companyId: number, speech: string): Promise<AvailabilityResult> {
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

function startAvailabilityCheck(callSid: string, companyId: number, speech: string): void {
  const state: PendingCheck = {
    companyId,
    speech,
    expiresAt: Date.now() + 60_000,
  };
  pendingChecks.set(callSid, state);

  void findSoonest(companyId, speech)
    .then(result => {
      const current = pendingChecks.get(callSid);
      if (current === state) current.result = result;
    })
    .catch((error: any) => {
      const current = pendingChecks.get(callSid);
      if (current === state) current.error = error?.message || "Availability lookup failed";
      logger.error({ callSid, companyId, err: error?.message }, "Background availability lookup failed");
    });
}

router.post("/twilio/availability-result", async (req: any, res): Promise<void> => {
  const callSid = String(req.query.callSid ?? req.body?.CallSid ?? "");
  if (!callSid) {
    res.type("text/xml").send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="${FALLBACK_VOICE}">I had trouble checking availability. What day works best for you?</Say></Response>`);
    return;
  }

  const check = pendingChecks.get(callSid);
  if (!check) {
    res.type("text/xml").send(gatherResponse(req, "I had trouble checking availability. What day works best for you?", callSid));
    return;
  }

  if (check.error) {
    pendingChecks.delete(callSid);
    res.type("text/xml").send(gatherResponse(req, "I had trouble checking availability just now. What day works best for you?", callSid));
    return;
  }

  if (!check.result) {
    // The DB/API work is still running. Give the caller another short audible
    // processing cue instead of dead air, then check again.
    res.type("text/xml").send(workingResponse(req, callSid, false));
    return;
  }

  const { slots, timeZone } = check.result;
  pendingChecks.delete(callSid);

  if (!slots.length) {
    res.type("text/xml").send(gatherResponse(req, "I don't see an open spot right now. Give me another day that works for you, or I can have the team follow up.", callSid));
    return;
  }

  pendingOffers.set(callSid, { companyId: check.companyId, slots, expiresAt: Date.now() + 10 * 60_000 });
  logger.info({ callSid, companyId: check.companyId, slots: slots.slice(0, 3).map(s => s.iso) }, "Offered real calendar availability after audible background check");
  res.type("text/xml").send(gatherResponse(req, spokenOptions(slots, timeZone), callSid));
});

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
          res.type("text/xml").send(gatherResponse(req, `Sure. ${spokenOptions(remaining, timeZone)}`, callSid));
          return;
        }
        pendingOffers.delete(callSid);
        res.type("text/xml").send(gatherResponse(req, "Those are the next openings I have. Tell me a different day and I can check that instead.", callSid));
        return;
      }

      res.type("text/xml").send(gatherResponse(req, spokenOptions(pending.slots, timeZone), callSid));
      return;
    }

    const genericNewAppointment = NEW_APPOINTMENT.test(speech) && !RESCHEDULE_OR_CANCEL.test(speech) && !EXPLICIT_TIME.test(speech);
    if (SOONEST.test(speech) || genericNewAppointment) {
      startAvailabilityCheck(callSid, call.companyId, speech);
      logger.info({ callSid, companyId: call.companyId, speech: speech.slice(0, 100) }, "Started background availability lookup with audible processing cue");
      res.type("text/xml").send(workingResponse(req, callSid, true));
      return;
    }

    if (BOOKING_WORDS.test(speech)) {
      req.body.SpeechResult = `${speech}. [Scheduling context for internal use only: current Eastern local date/time is ${nowText}. Keep spoken replies natural and short. Never create dead air by telling the caller to hold, wait, give you a minute, or wait while you check. Do not read the current day, date, year, timezone, ISO timestamp, or calendar mechanics aloud. When real availability is known, go directly to the available day and time. If you need one missing detail, ask exactly one useful question. If the caller rejects a slot, simply offer another available slot without repeating the checking explanation. Never infer a past year. Never book a time the caller has not explicitly accepted.]`;
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
  for (const [sid, check] of pendingChecks) if (check.expiresAt <= now) pendingChecks.delete(sid);
}, 60_000).unref();

export default router;
