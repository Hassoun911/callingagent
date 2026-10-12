import { Router, type IRouter } from "express";
import { createPublicKey, verify } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable } from "@workspace/db";

const router: IRouter = Router();
const seen = new Map<string, number>();
const keepSeconds = 300;

function isSigned(req: any): boolean {
  const key = process.env.TELNYX_PUBLIC_KEY;
  const raw: Buffer | undefined = req.rawBody;
  const stamp = req.get("telnyx-timestamp");
  const sig = req.get("telnyx-signature-ed25519");
  if (!key || !raw || !stamp || !sig || !/^\\d+$/.test(stamp)) return false;
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
  if (!response.ok) throw new Error("Telnyx call command " + name + " failed (" + response.status + ")");
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
  // Fast acknowledgment prevents carrier retries while Call Control runs.
  res.status(200).json({ received: true });
  try {
    if (type === "call.initiated" && payload?.direction === "incoming") {
      await action(id, "answer");
    } else if (type === "call.answered" && payload?.direction === "incoming") {
      const destination = payload?.to;
      const [line] = typeof destination === "string"
        ? await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, destination))
        : [];
      const forwardTo = line?.forwardTo;
      if (forwardTo && /^\\+[1-9]\\d{7,14}$/.test(forwardTo)) {
        await action(id, "transfer", { to: forwardTo });
      } else {
        await action(id, "speak", {
          payload: "Thank you for calling. This line has not yet been configured for call forwarding. Please contact the administrator.",
          voice: "female", language: "en-US",
        });
      }
    } else if (type === "call.speak.ended") {
      // Only terminate the unconfigured-number greeting, not transferred calls.
      const destination = payload?.to;
      const [line] = typeof destination === "string"
        ? await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, destination))
        : [];
      if (!line?.forwardTo) await action(id, "hangup");
    }
  } catch (error: any) {
    req.log.error({ type, message: error?.message }, "Telnyx voice event processing failed");
  }
});

export default router;
