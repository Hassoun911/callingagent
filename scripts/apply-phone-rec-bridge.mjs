import fs from "node:fs";

const path = "artifacts/api-server/src/routes/twilio-webhooks.ts";
let s = fs.readFileSync(path, "utf8");

const marker = "PHONE_REC_BRIDGE_APPLIED";
if (s.includes(marker)) {
  console.log("Phone Rec bridge already applied");
  process.exit(0);
}

function replaceOnce(oldText, newText, label) {
  if (!s.includes(oldText)) throw new Error(`Phone Rec bridge patch anchor missing: ${label}`);
  s = s.replace(oldText, newText);
}

replaceOnce(
  'import { sendBookingNotifications, sendRescheduleNotifications, sendCancellationNotifications } from "../lib/notifications";\n',
  'import { sendBookingNotifications, sendRescheduleNotifications, sendCancellationNotifications } from "../lib/notifications";\nimport { findPhoneRecRule, buildPhoneRecSystemPrompt } from "./phone-rec-bridge";\n\n// PHONE_REC_BRIDGE_APPLIED\n',
  "bridge import",
);

replaceOnce(
  '  companyName: string | null;\n}\n',
  '  companyName: string | null;\n  callerNumber: string | null;\n  phoneRecAllowBooking: boolean;\n  phoneRecRuleSource: string | null;\n}\n',
  "conversation state fields",
);

const lookupAnchor = `  const [phoneNumber] = await db.select().from(phoneNumbersTable)\n    .where(sql\`REPLACE(\${phoneNumbersTable.number}, ' ', '') = \${toNormalized}\`);\n`;
replaceOnce(
  lookupAnchor,
  lookupAnchor + `\n  // Phone Rec can override the line's default mode for a specific caller.\n  // Exact caller rules win; the app's unknown-caller rule is the fallback.\n  const phoneRecRule = phoneNumber ? await findPhoneRecRule(To, From) : null;\n  const phoneRecPayload = phoneRecRule?.payload ?? null;\n  const phoneRecMode = String(phoneRecPayload?.mode ?? "off").toLowerCase();\n  const configuredAnswerMode = phoneNumber?.answerMode ?? "forward";\n  const answerMode = phoneRecMode === "message"\n    ? "voicemail"\n    : (phoneRecMode === "script" || phoneRecMode === "conversation")\n      ? "ai_voice"\n      : configuredAnswerMode;\n  const phoneRecGreeting = String(phoneRecPayload?.script ?? phoneRecPayload?.business?.greeting ?? "").trim();\n`,
  "Phone Rec rule lookup",
);

replaceOnce(
  '    answerMode: phoneNumber?.answerMode ?? "forward",\n',
  '    answerMode,\n',
  "call log effective answer mode",
);

replaceOnce(
  '  const answerMode = phoneNumber?.answerMode ?? "forward";\n  const ringCount = phoneNumber?.ringCount ?? 4;\n',
  '  const ringCount = phoneNumber?.ringCount ?? 4;\n',
  "remove duplicate answerMode declaration",
);

replaceOnce(
  '  } else if (answerMode === "voicemail") {\n    const greeting = phoneNumber?.voicemailGreeting ?? "Please leave a message after the tone.";\n',
  '  } else if (answerMode === "voicemail") {\n    const greeting = phoneRecGreeting || phoneNumber?.voicemailGreeting || "Please leave a message after the tone.";\n',
  "Phone Rec message greeting",
);

replaceOnce(
  '    const greetingText = phoneNumber?.aiGreeting?.trim() || aiConfig?.greeting?.trim() || "Hello, thank you for calling. How can I help you today?";\n',
  '    const greetingText = phoneRecGreeting || phoneNumber?.aiGreeting?.trim() || aiConfig?.greeting?.trim() || "Hello, thank you for calling. How can I help you today?";\n',
  "Phone Rec AI greeting",
);

replaceOnce(
  `    const rawPrompt = phoneNumber?.aiSystemPrompt || aiConfig?.systemPrompt\n      || "You are a professional phone agent. Speak naturally and conversationally. Keep responses to 1-3 sentences. Ask one question at a time.";\n    const basePrompt = resolvePromptTemplate(rawPrompt, { companyName, phoneNumber: To, callerNumber: From });\n`,
  `    const rawPrompt = phoneNumber?.aiSystemPrompt || aiConfig?.systemPrompt\n      || "You are a professional phone agent. Speak naturally and conversationally. Keep responses to 1-3 sentences. Ask one question at a time.";\n    const resolvedBasePrompt = resolvePromptTemplate(rawPrompt, { companyName, phoneNumber: To, callerNumber: From });\n    const basePrompt = phoneRecPayload\n      ? buildPhoneRecSystemPrompt(phoneRecPayload, resolvedBasePrompt)\n      : resolvedBasePrompt;\n`,
  "Phone Rec system prompt",
);

replaceOnce(
  '    const greetingForHistory = aiConfig?.greeting?.trim() || DEFAULT_GREETING;\n',
  '    const greetingForHistory = greetingText;\n',
  "greeting history",
);

replaceOnce(
  '      fromNumber: phoneNumber?.number ?? null,\n      companyName: companyName ?? null,\n',
  '      fromNumber: phoneNumber?.number ?? null,\n      companyName: companyName ?? null,\n      callerNumber: From ?? null,\n      phoneRecAllowBooking: phoneRecPayload?.allow_booking !== false,\n      phoneRecRuleSource: phoneRecRule?.source ?? null,\n',
  "conversation Phone Rec permissions",
);

replaceOnce(
  '    const callerPhone = conv.fromNumber ?? "unknown";\n',
  '    const callerPhone = conv.callerNumber ?? "unknown";\n',
  "caller phone identity",
);

s = s.replace(
  "You can book, reschedule, and cancel appointments. When a caller wants to book: collect their name, preferred date/time, and purpose, then call book_appointment. When they want to reschedule or cancel: first call find_appointments to see their existing appointments, then call reschedule_appointment or cancel_appointment. Always confirm the action verbally after completing it.",
  "Appointment tools are available only when the caller-specific Phone Rec rule allows booking. If the Phone Rec instructions say booking is disabled, do not book, reschedule, or cancel appointments. When booking is allowed and requested: collect the caller name, preferred date/time, and purpose, then use the appointment tools and confirm the action verbally.",
);

s = s.replaceAll('      tools: aiTools,\n      tool_choice: "auto",\n', '      tools: conv.phoneRecAllowBooking ? aiTools : undefined,\n      tool_choice: conv.phoneRecAllowBooking ? "auto" : undefined,\n');
s = s.replaceAll('              tools: aiTools,\n              tool_choice: "auto",\n', '              tools: conv.phoneRecAllowBooking ? aiTools : undefined,\n              tool_choice: conv.phoneRecAllowBooking ? "auto" : undefined,\n');

for (const required of [
  "findPhoneRecRule(To, From)",
  "buildPhoneRecSystemPrompt(phoneRecPayload",
  "phoneRecAllowBooking",
  "callerNumber: From ?? null",
  "const callerPhone = conv.callerNumber",
  "const phoneRecGreeting",
  "answerMode,",
]) {
  if (!s.includes(required)) throw new Error(`Phone Rec bridge verification failed: ${required}`);
}

fs.writeFileSync(path, s);
console.log("CallingAgent Twilio voice route now applies Phone Rec per-caller AI rules");
