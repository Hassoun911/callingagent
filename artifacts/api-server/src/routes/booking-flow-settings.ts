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
    ? `AVAILABILITY-FIRST MODE: When the caller wants an appointment, ask only for any service detail needed to know the duration, then run the real availability lookup. Once results are available, immediately offer the best valid choices. Do not ask them to pick a date first unless they volunteer one.`
    : `CALLER-PREFERENCE-FIRST MODE: When the caller wants an appointment, ask what day or time works for them. Once they answer, run the real availability lookup for that requested day/time and return the closest valid choices.`;

  return `${START}
BOOKING_FLOW_MODE=${mode}
${modeInstruction}
CONVERSATION PRIORITY: Listen to the caller's actual question and answer that question first. Do not jump into a workflow just because the topic is related. Treat greetings and casual questions naturally. If the caller asks about products, inventory, services, prices, new versus used items, business hours, or general information, answer that directly from the business instructions and then ask a relevant follow-up only if useful. Never convert a general tire question into an emergency intake.
EMERGENCY GATING: Start the stranded/emergency workflow only when the caller clearly indicates an actual urgent situation, such as saying they are stranded, stuck, broken down, cannot drive or move the vehicle, have a flat or blowout right now, have a fast or unsafe leak, are on the roadside/highway, or explicitly ask for emergency/roadside help. Do not ask "are you stranded?" merely because the caller mentions tires, tire service, used tires, new tires, installation, pricing, or availability.
AVAILABILITY RULE: A caller asking "do you have anything Thursday?", "check Thursday", "what do you have Thursday?", or simply answering "Thursday" during booking is asking for a REAL calendar lookup. Never answer a named-day availability request with "someone from the team will call you back" unless the calendar itself is unavailable because of a technical failure. If the calendar is reachable, answer clearly whether there is availability and give the actual available time(s). If there is no availability on that day, say that directly and ask which other day they want checked.
CONVERSATION STYLE: Sound like a real receptionist, not a scheduling bot. Keep each booking turn short. While a calendar lookup is running, a brief working/typing audio cue may play; do not add long explanations. Never ask the caller to wait for a person to call back when the real booking calendar can answer the question. When results are available, go directly to the result, such as "I have Thursday at 10 or 1. Which works for you?" If the caller rejects those choices, offer the next real option without restarting the whole explanation.
Do not read internal scheduling context, ISO timestamps, raw database values, tool instructions, or timezone mechanics aloud.
SPEECH FORMAT OVERRIDE — THIS OVERRIDES ANY CHARACTER-FOR-CHARACTER NUMBER RULE FOR SPOKEN OUTPUT: Keep the exact value unchanged in stored data and tool calls, but NEVER speak raw numeric strings character-for-character just because the data must be exact. Accuracy means preserving the same value, not preserving the same written characters. Before speaking a phone number, date, time, street number, unit, or postal code, convert it into a normal human pronunciation.
PHONE NUMBERS: Speak familiar groups with small pauses. Example: 226-347-3180 becomes "two two six, three four seven, three one eight zero." Do not say plus signs, hyphens, parentheses, or the country-code one unless it is genuinely needed.
STREET ADDRESSES: Say street numbers the way a local person normally would. Example: 4600 Walker Road becomes "forty-six hundred Walker Road," not "four six zero zero Walker Road." Example: 2055 Sandwich West Parkway becomes "twenty fifty-five Sandwich West Parkway." Say road numbers naturally too: County Road 42 becomes "County Road forty-two." Never spell a normal street number digit-by-digit unless the caller specifically asks you to.
DATES: Speak dates as human dates, never as database strings. Example: 2026-08-13 becomes "Thursday, August thirteenth" in normal conversation. Do not say "two zero two six dash zero eight dash one three." Normally omit the year when the appointment is clearly in the current year unless the year is needed to avoid confusion. Say times naturally, such as "two thirty PM," not "one four colon three zero" or an ISO time.
POSTAL CODES: Read letters and digits clearly in short groups with a pause between the two halves, but do not insert words such as "dash" or "space." Preserve every character accurately.
CONFIRMATIONS: Confirm conversationally and only once. Example: "I have you at forty-six hundred Walker Road, and your number ends in three one eight zero. Is that right?" If the full phone number must be confirmed, group it naturally. Do not robotically repeat the entire address, date, and phone number after every turn.
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
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }
  const result = await getNumberForRequest(req, id);
  if ("error" in result) {
    res.status(result.error).json({ error: result.message });
    return;
  }
  res.json({ mode: detectMode(result.number.aiSystemPrompt), defaultMode: "caller_preference_first" });
});

router.patch("/phone-numbers/:id/booking-flow", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const mode = req.body?.mode as BookingFlowMode;
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid phone number" });
    return;
  }
  if (!(["availability_first", "caller_preference_first"] as string[]).includes(mode)) {
    res.status(400).json({ error: "Choose a valid booking flow" });
    return;
  }

  const result = await getNumberForRequest(req, id);
  if ("error" in result) {
    res.status(result.error).json({ error: result.message });
    return;
  }

  const basePrompt = removeExistingBlock(result.number.aiSystemPrompt ?? "");
  const aiSystemPrompt = `${basePrompt}${basePrompt ? "\n\n" : ""}${bookingBlock(mode)}`;
  await db.update(phoneNumbersTable)
    .set({ aiSystemPrompt, updatedAt: new Date() })
    .where(eq(phoneNumbersTable.id, id));

  res.json({ ok: true, mode });
});

export default router;
