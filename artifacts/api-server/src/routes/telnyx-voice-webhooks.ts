import { Router, type IRouter } from "express";
import { createPublicKey, verify } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable, companiesTable, callLogsTable } from "@workspace/db";

const router: IRouter = Router();
const seen = new Map<string, number>();
const keepSeconds = 300;

function isSigned(req: any): boolean {
  const key = process.env.TELNYX_PUBLIC_KEY;
  const raw: Buffer | undefined = req.rawBody;
  const stamp = req.get("telnyx-timestamp");
  const sig = req.get("telnyx-signature-ed25519");
  if (!key || !raw || !stamp || !sig || !/^\d+$/.test(stamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(stamp)) > keepSeconds) return false;
  try {
    const bytes = Buffer.from(key, "base64");
    const signature = Buffer.from(sig, "base64");
    if (bytes.length !== 32 || signature.length !== 64) return false;
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), bytes]), format: "der", type: "spki" });
    return verify(null, Buffer.concat([Buffer.from(stamp + "|"), raw]), publicKey, signature);
  } catch { return false; }
}

async function action(id: string, name: string, payload: Record<string, unknown> = {}) {
  const key = process.env.TELNYX_API_KEY;
  if (!key) throw new Error("Telnyx API key is not configured");
  const response = await fetch("https://api.telnyx.com/v2/calls/" + encodeURIComponent(id) + "/actions/" + name, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { const detail = (await response.text()).slice(0, 600); throw new Error("Telnyx call command " + name + " failed (" + response.status + "): " + detail); }
}

// This is a Call Control API v2 webhook, not a Twilio TwiML endpoint.
router.post("/telnyx/voice", async (req, res): Promise<void> => {
  if (!process.env.TELNYX_PUBLIC_KEY) { res.status(503).json({ error: "Telnyx webhook signing key not configured" }); return; }
  if (!isSigned(req)) { res.status(401).json({ error: "Invalid Telnyx webhook signature" }); return; }
  const event = req.body?.data;
  const type = event?.event_type;
  const payload = event?.payload;
  const id = payload?.call_control_id;
  if (typeof type !== "string" || typeof id !== "string" || !id) { res.status(400).end(); return; }

  const eventId = event?.id;
  const now = Date.now();
  for (const [k, time] of seen) if (now - time > keepSeconds * 1000) seen.delete(k);
  if (typeof eventId === "string" && seen.has(eventId)) { res.status(200).json({ received: true, duplicate: true }); return; }
  if (typeof eventId === "string") seen.set(eventId, now);
  req.log.info({ eventType: type, direction: payload?.direction, hasDestination: Boolean(payload?.to) }, "Telnyx voice webhook received");
  // Fast acknowledgment prevents carrier retries while Call Control runs.
  res.status(200).json({ received: true });
  try {
    if (type === "call.initiated" && payload?.direction === "incoming") {
      await action(id, "answer");
    } else if (type === "call.answered" && payload?.direction !== "outgoing") {
      const destination = payload?.to;
      const [line] = typeof destination === "string"
        ? await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, destination))
        : [];
      req.log.info({ foundLine: Boolean(line), active: Boolean(line?.isActive), mode: line?.answerMode }, "Telnyx inbound routing decision");
      if (!line?.isActive) {
        await action(id, "speak", {
          payload: "This number is not currently accepting calls. Please try again later.",
          voice: "female", language: "en-US",
        });
      } else if (line.answerMode === "reject") {
        await action(id, "hangup");
      } else {
        const [company] = line.companyId
          ? await db.select().from(companiesTable).where(eq(companiesTable.id, line.companyId))
          : [];
        const name = company?.name?.trim() || line.callerIdName?.trim() || "our business";
        const defaultVoicemail = "Thank you for calling " + name +
          ". We're sorry we missed your call. Please leave your name, phone number, and a brief message after the tone, and someone from our team will contact you as soon as possible.";
        if (line.answerMode === "forward" && line.forwardTo && /^\\+[1-9]\\d{7,14}$/.test(line.forwardTo)) {
          await action(id, "transfer", { to: line.forwardTo });
        } else {
          // Used for voicemail and as the safe fallback until conversational AI is connected.
          // Do not use the AI conversation opening as a voicemail instruction.
          const greeting = line.voicemailGreeting?.trim() || defaultVoicemail;
          req.log.info({ lineId: line.id, mode: line.answerMode, customVoicemail: Boolean(line.voicemailGreeting?.trim()) }, "Telnyx voicemail greeting selected");
          await action(id, "speak", { payload: greeting, voice: "female", language: "en-US" });
        }
      }
    } else if (type === "call.speak.ended") {
      const destination = payload?.to;
      const [line] = typeof destination === "string"
        ? await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, destination))
        : [];
      if (!line?.isActive || line.answerMode === "reject") return;
      if (line.answerMode === "forward" && line.forwardTo) return;
      // Each voicemail is associated with this specific line; the carrier records the caller after the beep.
      const logSid = "telnyx:" + id;
      const [existing] = await db.select().from(callLogsTable).where(eq(callLogsTable.twilioCallSid, logSid));
      if (!existing && line) {
        await db.insert(callLogsTable).values({
          twilioCallSid: logSid, phoneNumberId: line.id, direction: "inbound",
          status: "voicemail_recording", fromNumber: typeof payload?.from === "string" ? payload.from : "unknown",
          toNumber: line.number, answerMode: "voicemail",
        });
      }
      await action(id, "record_start", {
        format: "mp3", channels: "single", recording_track: "inbound",
        play_beep: true, max_length: 120, timeout_secs: 8,
        transcription: true, transcription_language: "en-US",
        command_id: id + "-voicemail-start",
      });
    } else if (type === "call.recording.saved") {
      const logSid = "telnyx:" + id;
      const urls = payload?.recording_urls;
      const url = urls?.mp3 || urls?.wav || payload?.recording_url;
      await db.update(callLogsTable).set({
        status: "voicemail_saved",
        recordingUrl: typeof url === "string" ? url : null,
        recordingSid: typeof payload?.recording_id === "string" ? payload.recording_id : null,
      }).where(eq(callLogsTable.twilioCallSid, logSid));
      req.log.info({ recordingSaved: true, hasUrl: Boolean(url) }, "Telnyx voicemail saved");
    } else if (type === "call.recording.transcription.saved") {
      const transcript = payload?.transcription_data?.transcript || payload?.transcription;
      if (typeof transcript === "string") {
        await db.update(callLogsTable).set({ transcription: transcript })
          .where(eq(callLogsTable.twilioCallSid, "telnyx:" + id));
      }
    } else if (type === "call.recording.error") {
      req.log.error({ callControlId: id }, "Telnyx voicemail recording failed");
  } catch (error: any) {
    req.log.error({ type, message: error?.message }, "Telnyx voice event processing failed");
  }
});

export default router;
