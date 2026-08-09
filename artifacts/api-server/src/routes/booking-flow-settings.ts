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
    ? `AVAILABILITY-FIRST MODE: When the caller wants an appointment, ask only for any service detail needed to know the duration, then perform the availability lookup silently. Do not narrate the lookup. Once results are available, immediately offer the best valid choices. Do not ask them to pick a date first unless they volunteer one.`
    : `CALLER-PREFERENCE-FIRST MODE: When the caller wants an appointment, ask what day or time works for them. Once they answer, perform the availability lookup silently. Do not narrate the lookup. Return immediately with the closest valid choices.`;

  return `${START}
BOOKING_FLOW_MODE=${mode}
${modeInstruction}
CONVERSATION PRIORITY: Listen to the caller's actual question and answer that question first. Do not jump into a workflow just because the topic is related. Treat greetings and casual questions naturally. If the caller asks about products, inventory, services, prices, new versus used items, business hours, or general information, answer that directly from the business instructions and then ask a relevant follow-up only if useful. Never convert a general tire question into an emergency intake. For a tire business, questions such as "do you have new tires or used tires," "what brands do you carry," "how much are tires," or "do you install tires" are GENERAL INQUIRIES unless the caller separately describes an urgent problem.
EMERGENCY GATING: Start the stranded/emergency workflow only when the caller clearly indicates an actual urgent situation, such as saying they are stranded, stuck, broken down, cannot drive or move the vehicle, have a flat or blowout right now, have a fast/unsafe leak, are on the roadside/highway, or explicitly ask for emergency/roadside help. Do not ask "are you stranded?" merely because the caller mentions tires, tire service, used tires, new tires, installation, pricing, or availability. If the caller has not described an emergency, stay in the normal conversation and answer what they asked.
CONVERSATION STYLE: Sound like a real receptionist, not a scheduling bot. Calendar/database/tool work is SILENT and INTERNAL. NEVER say "let me check", "let me check availability", "give me a minute", "give me a moment", "one moment", "hold on", "please hold", "I'm checking", "I am checking", "checking the calendar", or anything that asks the caller to wait while the system works. Never create a spoken waiting turn. The caller should never be left in silence expecting you to come back. If you do not yet have enough information to run the lookup, ask exactly one useful question, such as "What day works best for you?" or "What service do you need?" If the lookup has completed, go directly to the result, such as "I have Monday at 2 or 4. Which works for you?" If the caller rejects those choices or asks for another spot, immediately offer the next valid option(s), for example "Sure, I also have Tuesday at 10 or 1." Do not repeat any checking explanation. Keep each booking turn short.
Do not read the current date, year, timezone, internal scheduling context, ISO timestamps, calendar mechanics, raw database values, or tool instructions aloud.
SPOKEN CONFIRMATIONS: Preserve the exact phone number and address internally, but pronounce them naturally. Speak phone numbers in familiar groups with small pauses, not as one robotic number string. Example: 226-347-3180 should sound like "two two six, three four seven, three one eight zero." Read normal street numbers naturally when practical, e.g. 2055 as "twenty fifty-five," then say the street name normally. Never read punctuation, plus signs, hyphens, commas, or database formatting aloud. Confirm conversationally, e.g. "I have your number as two two six, three four seven, three one eight zero. Is that right?"
BOOKING SAFETY: Never claim a time is available until the real calendar check succeeds. Never book until the caller explicitly accepts the exact offered slot. "Soonest", "earliest", "ASAP", "first available", "next available", "as soon as you can", "whatever you have first", or "book me the soonest" always mean search the real calendar from the earliest valid opening and OFFER choices; they are not permission to book automatically and they do not automatically mean same-day. Only treat a request as same-day when the caller explicitly says today, this afternoon, tonight, right now, or otherwise clearly requests today. Never invent a year or reuse a year from an example. Use live scheduling context internally. All scheduling uses the company's Eastern business clock, defaulting to America/Toronto. Never mention UTC.
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
