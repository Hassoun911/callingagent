import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable } from "@workspace/db";
import { getCompanyScope } from "../lib/scope";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const START = "[CALLINGAGENT_BOOKING_FLOW_START]";
const END = "[CALLINGAGENT_BOOKING_FLOW_END]";

type BookingFlowMode = "availability_first" | "caller_preference_first";

function removeExistingBlock(prompt: string): string {
  const start = prompt.indexOf(START);
  const end = prompt.indexOf(END);
  if (start === -1 || end === -1 || end < start) return prompt.trim();
  return `${prompt.slice(0, start)}${prompt.slice(end + END.length)}`.trim();
}

function detectMode(prompt: string | null): BookingFlowMode {
  if (prompt?.includes("BOOKING_FLOW_MODE=availability_first")) return "availability_first";
  return "caller_preference_first";
}

function bookingBlock(mode: BookingFlowMode): string {
  const modeInstruction = mode === "availability_first"
    ? `AVAILABILITY-FIRST MODE: As soon as the caller clearly wants an appointment, say naturally, "Absolutely. Let me check our availability for you." Ask only for the service and any details needed to determine duration, then check the real calendar and offer available appointment options. Do not first ask the caller to choose a time unless they volunteer one. Only describe a slot as available after the calendar check succeeds.`
    : `CALLER-PREFERENCE-FIRST MODE: As soon as the caller clearly wants an appointment, ask what date and time they prefer. After they answer, say naturally, "Let me check whether that time is available." Check the real calendar for that exact requested slot. If available, proceed; if unavailable, apologize briefly and offer or ask about another available time.`;

  return `${START}
BOOKING_FLOW_MODE=${mode}
${modeInstruction}
For every mode: never claim an appointment is booked, confirmed, reserved, or available until the real calendar operation succeeds. If you offer one or more available slots, STOP and ask the caller which exact slot they want. Never call the booking tool for an offered slot until the caller explicitly accepts that exact date and time. Words such as "soonest", "earliest", "ASAP", "first available", "next available", "as soon as you can", "whatever you have first", or "book me the soonest" ALWAYS mean search the real calendar from the earliest valid slot forward and OFFER the earliest choices. These phrases are NEVER a same-day request and NEVER permission to book automatically. Only treat the request as same-day when the caller explicitly says "today", "this afternoon", "tonight", "right now", or gives today's date. Never invent a year or infer an old year from examples in the prompt; use the live current date/time supplied by the scheduling system. For an explicit same-day request, do not guarantee service or create a confirmed appointment unless the real calendar check returns a valid same-day slot and the caller explicitly accepts it; otherwise collect the service address/location, vehicle and service details, callback number, and preferred time, then say that someone from the team will get back to them shortly. Use the phone line's configured timezone, defaulting to America/Toronto Eastern Time, and never mention UTC to callers.
${END}`;
}

async function getNumberForRequest(req: any, id: number) {
  const [number] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, id));
  if (!number) return { error: 404 as const, message: "Phone number not found" };
  const companyId = getCompanyScope(req);
  if (companyId !== null && number.companyId !== companyId) {
    return { error: 403 as const, message: "Access denied" };
  }
  return { number };
}

export async function refreshStoredBookingFlowPrompts(): Promise<void> {
  try {
    const numbers = await db.select().from(phoneNumbersTable);
    let updated = 0;
    for (const number of numbers) {
      if (!number.aiSystemPrompt?.includes(START)) continue;
      const mode = detectMode(number.aiSystemPrompt);
      const basePrompt = removeExistingBlock(number.aiSystemPrompt);
      const aiSystemPrompt = `${basePrompt}${basePrompt ? "\n\n" : ""}${bookingBlock(mode)}`;
      if (aiSystemPrompt === number.aiSystemPrompt) continue;
      await db.update(phoneNumbersTable)
        .set({ aiSystemPrompt, updatedAt: new Date() })
        .where(eq(phoneNumbersTable.id, number.id));
      updated++;
    }
    if (updated) logger.info({ updated }, "Refreshed stored booking-flow instructions");
  } catch (error: any) {
    logger.warn({ err: error?.message }, "Could not refresh stored booking-flow instructions");
  }
}

router.get("/phone-numbers/:id/booking-flow", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid phone number" }); return; }
  const result = await getNumberForRequest(req, id);
  if ("error" in result) { res.status(result.error).json({ error: result.message }); return; }
  res.json({ mode: detectMode(result.number.aiSystemPrompt), defaultMode: "caller_preference_first" });
});

router.patch("/phone-numbers/:id/booking-flow", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const mode = req.body?.mode as BookingFlowMode;
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Invalid phone number" }); return; }
  if (!(["availability_first", "caller_preference_first"] as string[]).includes(mode)) {
    res.status(400).json({ error: "Choose a valid booking flow" });
    return;
  }

  const result = await getNumberForRequest(req, id);
  if ("error" in result) { res.status(result.error).json({ error: result.message }); return; }

  const basePrompt = removeExistingBlock(result.number.aiSystemPrompt ?? "");
  const aiSystemPrompt = `${basePrompt}${basePrompt ? "\n\n" : ""}${bookingBlock(mode)}`;
  await db.update(phoneNumbersTable)
    .set({ aiSystemPrompt, updatedAt: new Date() })
    .where(eq(phoneNumbersTable.id, id));

  res.json({ ok: true, mode });
});

export default router;
