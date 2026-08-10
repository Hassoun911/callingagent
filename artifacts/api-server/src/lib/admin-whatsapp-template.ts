import twilio from "twilio";
import { logger } from "./logger";

const DEFAULT_ADMIN_CONTENT_SID = "HX53b587342dccf2d5b638c470e1da7ef7";
const TWILIO_WHATSAPP_SANDBOX_NUMBER = "+14155238886";
const DEFAULT_PRODUCTION_WHATSAPP_NUMBER = "+12498000025";

type TemplateContext = {
  companyName?: string | null;
  callerName?: string | null;
  callerPhone?: string | null;
  duration?: string | null;
  callType?: string | null;
  location?: string | null;
  summary?: string | null;
  action?: string | null;
  appointmentTitle?: string | null;
  appointmentDateTime?: string | null;
  status?: string | null;
};

type TwilioContent = {
  variables?: Record<string, string>;
  types?: Record<string, { body?: string }>;
};

let cachedTemplate: TwilioContent | null | undefined;

function normalizeWhatsapp(value: string): string {
  const trimmed = value.trim();
  return trimmed.toLowerCase().startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`;
}

function bareWhatsappNumber(value: string): string {
  const trimmed = value.trim().replace(/^whatsapp:/i, "");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed.startsWith("+") ? trimmed : digits ? `+${digits}` : trimmed;
}

function assertProductionWhatsappSender(value: string): string {
  const sender = value.trim();
  if (!sender) throw new Error("WhatsApp sender is not configured");
  if (bareWhatsappNumber(sender) === TWILIO_WHATSAPP_SANDBOX_NUMBER) {
    throw new Error("Twilio WhatsApp Sandbox cannot be used for production admin notifications.");
  }
  return sender;
}

export function getProductionWhatsappSender(): string {
  const configured = process.env.TWILIO_WHATSAPP_FROM?.trim();

  // +1 249-800-0025 is the approved production WhatsApp sender for this Twilio
  // account. Keep an environment override for future migrations, but never let
  // the legacy sandbox value override the approved production sender.
  if (configured && bareWhatsappNumber(configured) !== TWILIO_WHATSAPP_SANDBOX_NUMBER) {
    return assertProductionWhatsappSender(configured);
  }

  if (configured && bareWhatsappNumber(configured) === TWILIO_WHATSAPP_SANDBOX_NUMBER) {
    logger.warn(
      { configured, productionSender: DEFAULT_PRODUCTION_WHATSAPP_NUMBER },
      "Ignoring Twilio WhatsApp Sandbox sender and using approved production sender",
    );
  }

  return DEFAULT_PRODUCTION_WHATSAPP_NUMBER;
}

function twilioClient(): twilio.Twilio | null {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  return twilio(sid, token);
}

async function loadTemplate(contentSid: string): Promise<TwilioContent | null> {
  if (cachedTemplate !== undefined) return cachedTemplate;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;

  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const response = await fetch(`https://content.twilio.com/v1/Content/${contentSid}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!response.ok) throw new Error(`Content API returned ${response.status}`);
    cachedTemplate = await response.json() as TwilioContent;
    return cachedTemplate;
  } catch (error: any) {
    cachedTemplate = null;
    logger.warn({ err: error?.message, contentSid }, "Could not load Twilio admin WhatsApp template metadata");
    return null;
  }
}

function valueForPlaceholder(body: string, key: string, ctx: TemplateContext): string {
  const marker = `{{${key}}}`;
  const index = body.indexOf(marker);
  const before = index >= 0 ? body.slice(Math.max(0, index - 80), index).toLowerCase() : "";

  if (/date|time|when|appointment time/.test(before)) return ctx.appointmentDateTime || "Not provided";
  if (/duration|length/.test(before)) return ctx.duration || "N/A";
  if (/location|address|where/.test(before)) return ctx.location || "Not provided";
  if (/summary|details|reason|request/.test(before)) return ctx.summary || ctx.appointmentTitle || "No summary available";
  if (/action|next step|follow.?up/.test(before)) return ctx.action || "No action required";
  if (/type|category/.test(before)) return ctx.callType || ctx.status || "General Inquiry";
  if (/customer|caller|name/.test(before)) return ctx.callerName || ctx.callerPhone || "Unknown caller";
  if (/phone|number|contact/.test(before)) return ctx.callerPhone || "Not provided";
  if (/company|business/.test(before)) return ctx.companyName || "CallingAgent customer";
  if (/appointment|service/.test(before)) return ctx.appointmentTitle || ctx.callType || "Appointment";
  if (/status/.test(before)) return ctx.status || "Completed";

  const fallback = [
    ctx.companyName,
    ctx.callerName || ctx.callerPhone,
    ctx.duration,
    ctx.callType || ctx.appointmentTitle,
    ctx.appointmentDateTime || ctx.location,
    ctx.summary,
    ctx.action,
    ctx.status,
  ].filter(Boolean) as string[];
  const numeric = Number(key);
  return fallback[Math.max(0, numeric - 1)] || "N/A";
}

function buildVariables(template: TwilioContent | null, ctx: TemplateContext): string | undefined {
  if (!template) return undefined;
  const textType = template.types?.["twilio/text"];
  const body = textType?.body || "";
  const declared = Object.keys(template.variables || {});
  const found = Array.from(body.matchAll(/\{\{([^}]+)\}\}/g)).map(match => match[1]);
  const keys = Array.from(new Set([...declared, ...found]));
  if (!keys.length) return undefined;

  const variables: Record<string, string> = {};
  for (const key of keys) variables[key] = valueForPlaceholder(body, key, ctx);
  return JSON.stringify(variables);
}

export async function sendAdminWhatsappTemplate(args: {
  to: string;
  from: string;
  context: TemplateContext;
}): Promise<string> {
  const client = twilioClient();
  if (!client) throw new Error("Twilio credentials are not configured");

  // All company admin alerts use one approved CallingAgent production WhatsApp
  // sender. Never fall back to the voice/SMS number supplied by a caller route.
  const sender = getProductionWhatsappSender();
  const contentSid = process.env.TWILIO_ADMIN_ALERT_CONTENT_SID?.trim() || DEFAULT_ADMIN_CONTENT_SID;
  const template = await loadTemplate(contentSid);
  const contentVariables = buildVariables(template, args.context);

  const payload: any = {
    from: normalizeWhatsapp(sender),
    to: normalizeWhatsapp(args.to),
    contentSid,
  };
  if (contentVariables) payload.contentVariables = contentVariables;

  const result = await client.messages.create(payload);
  logger.info({ to: payload.to, from: payload.from, contentSid, sid: result.sid }, "Admin WhatsApp template sent");
  return result.sid;
}

export { DEFAULT_ADMIN_CONTENT_SID, TWILIO_WHATSAPP_SANDBOX_NUMBER, DEFAULT_PRODUCTION_WHATSAPP_NUMBER };
