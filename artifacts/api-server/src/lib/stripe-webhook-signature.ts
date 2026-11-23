import crypto from "node:crypto";

/**
 * Verify Stripe's v1 HMAC signature over the exact raw request bytes.
 * Multiple v1 signatures are supported for endpoint-secret rotation.
 * A caller must never accept parsed/serialized JSON in place of raw body.
 */
export function verifyStripeWebhookSignature(
  raw: Buffer, signatureHeader: string, signingSecret: string,
  nowSeconds: number = Date.now()/1000,
): boolean {
  if (!Buffer.isBuffer(raw) || !signingSecret ||
      typeof signatureHeader !== "string" || signatureHeader.length > 4096 ||
      !Number.isFinite(nowSeconds)) return false;
  const fields=signatureHeader.split(",").map(part=>part.trim());
  const timestamps=fields.filter(part=>part.startsWith("t=")).map(part=>part.slice(2));
  if (timestamps.length!==1 || !/^\d{10,13}$/.test(timestamps[0]))return false;
  const timestamp=Number(timestamps[0]);
  if(!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds-timestamp)>300)return false;
  const signatures=fields.filter(part=>part.startsWith("v1=")).map(part=>part.slice(3));
  if(!signatures.length)return false;
  const signatureBase=Buffer.concat([Buffer.from(String(timestamp)+"."),raw]);
  const expected=crypto.createHmac("sha256",signingSecret).update(signatureBase).digest();
  return signatures.some(hex=>{
    if(!/^[a-fA-F0-9]{64}$/.test(hex))return false;
    return crypto.timingSafeEqual(Buffer.from(hex,"hex"),expected);
  });
}
