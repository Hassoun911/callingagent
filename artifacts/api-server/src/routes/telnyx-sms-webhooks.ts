import { Router, type IRouter } from "express";
import { createPublicKey, verify } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, phoneNumbersTable, smsMessagesTable } from "@workspace/db";

const router: IRouter = Router();
const recent = new Map<string, number>();
const MAX_AGE_SECONDS = 300;

function verified(req: any): boolean {
  const key = process.env.TELNYX_PUBLIC_KEY?.trim();
  const timestamp = req.get("telnyx-timestamp");
  const signature = req.get("telnyx-signature-ed25519");
  const raw: Buffer | undefined = req.rawBody;
  if (!key || !timestamp || !signature || !raw || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  try {
    const publicBytes = Buffer.from(key, "base64");
    const signatureBytes = Buffer.from(signature, "base64");
    if (publicBytes.length !== 32 || signatureBytes.length !== 64) return false;
    const publicKey = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes]),
      type: "spki", format: "der",
    });
    return verify(null, Buffer.concat([Buffer.from(timestamp + "|"), raw]), publicKey, signatureBytes);
  } catch { return false; }
}

// Incoming Telnyx API v2 messaging events. Twilio hooks are handled independently.
router.post("/telnyx/sms", async (req, res): Promise<void> => {
  if (!process.env.TELNYX_PUBLIC_KEY) { res.status(503).json({ error: "Signing key not configured" }); return; }
  if (!verified(req)) { res.status(401).json({ error: "Invalid webhook signature" }); return; }
  const event = req.body?.data;
  const type = event?.event_type;
  const payload = event?.payload;
  if (typeof type !== "string" || !payload || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid event" }); return;
  }
  const eventId = typeof event.id === "string" ? event.id : null;
  const now = Date.now();
  for (const [id, timestamp] of recent) if (now - timestamp > MAX_AGE_SECONDS * 1000) recent.delete(id);
  if (eventId && recent.has(eventId)) { res.json({ received: true, duplicate: true }); return; }

  try {
    if (type === "message.received") {
      const messageId = payload.id;
      const from = payload.from?.phone_number;
      const to = Array.isArray(payload.to) ? payload.to[0]?.phone_number : null;
      if (typeof messageId !== "string" || !messageId || typeof from !== "string" || typeof to !== "string") {
        res.status(400).json({ error: "Missing message identity or address" }); return;
      }
      const [line] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, to));
      if (!line) {
        req.log.warn({ to, messageId }, "Telnyx SMS received for number not registered in CallingAgent");
        res.status(202).json({ received: true, routed: false }); return;
      }
      const media = Array.isArray(payload.media) ? payload.media.map((m: any) => m?.url).filter((u: any): u is string => typeof u === "string") : [];
      // Prefix avoids collisions with the existing Twilio SID column, whose uniqueness protects retries.
      await db.insert(smsMessagesTable).values({
        twilioSid: "telnyx:" + messageId, phoneNumberId: line.id,
        direction: "inbound", from, to,
        body: typeof payload.text === "string" ? payload.text : "",
        status: "received", numMedia: media.length, mediaUrls: media.length ? media : null,
      }).onConflictDoNothing();
    } else if (type === "message.sent" || type === "message.finalized") {
      const messageId = payload.id;
      if (typeof messageId === "string" && messageId) {
        const destinationStatus = Array.isArray(payload.to) ? payload.to[0]?.status : null;
        const status = typeof destinationStatus === "string" ? destinationStatus
          : typeof payload.status === "string" ? payload.status : type === "message.sent" ? "sent" : "finalized";
        await db.update(smsMessagesTable).set({ status, updatedAt: new Date() })
          .where(and(eq(smsMessagesTable.twilioSid, "telnyx:" + messageId), eq(smsMessagesTable.direction, "outbound")));
      }
    }
    if (eventId) recent.set(eventId, now);
    res.json({ received: true });
  } catch (error: any) {
    req.log.error({ eventType: type, message: error?.message }, "Failed to process Telnyx SMS event");
    res.status(500).json({ error: "Message processing failed; retry event" });
  }
});

export default router;
