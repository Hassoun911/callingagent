import { eq } from "drizzle-orm";
import { db, companiesTable, phoneNumbersTable } from "@workspace/db";
import { logger } from "./logger";

/** One-time operator-requested recovery. Never places a purchase order. */
export async function recoverConfirmedTelnyxOrder(): Promise<void> {
  const orderId = process.env.TELNYX_RECOVER_ORDER_ID;
  const phoneNumber = process.env.TELNYX_RECOVER_PHONE_NUMBER;
  const companyId = Number(process.env.TELNYX_RECOVER_COMPANY_ID);
  if (!orderId || !phoneNumber) return;
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^\+[1-9]\d{7,14}$/.test(phoneNumber) ||
      !Number.isSafeInteger(companyId) || companyId <= 0) {
    logger.error("Telnyx recovery settings invalid; not making changes");
    return;
  }
  const apiKey = process.env.TELNYX_API_KEY;
  if (!apiKey) { logger.error("Telnyx recovery missing API key"); return; }
  try {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company) { logger.error({ companyId }, "Telnyx recovery company does not exist"); return; }
    const headers = { Authorization: "Bearer " + apiKey, Accept: "application/json" };
    const orderResult = await fetch("https://api.telnyx.com/v2/number_orders/" + encodeURIComponent(orderId), {
      headers, signal: AbortSignal.timeout(12000),
    });
    if (!orderResult.ok) { logger.error({ status: orderResult.status }, "Telnyx recovery order verification failed"); return; }
    const orderPayload: any = await orderResult.json();
    if (!["success", "completed", "complete"].includes(String(orderPayload.data?.status).toLowerCase())) {
      logger.warn({ status: orderPayload.data?.status }, "Telnyx recovery order not completed"); return;
    }
    const numberResult = await fetch("https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=" + encodeURIComponent(phoneNumber), {
      headers, signal: AbortSignal.timeout(12000),
    });
    if (!numberResult.ok) { logger.error({ status: numberResult.status }, "Telnyx recovery ownership lookup failed"); return; }
    const numbers: any = await numberResult.json();
    if (!(Array.isArray(numbers.data) && numbers.data.some((n: any) => n.phone_number === phoneNumber))) {
      logger.warn("Telnyx recovery ownership not confirmed"); return;
    }
    const ownedNumber = numbers.data.find((n: any) => n.phone_number === phoneNumber);
    const connectionId = process.env.TELNYX_CONNECTION_ID;
    const messagingProfileId = process.env.TELNYX_MESSAGING_PROFILE_ID;
    const [existing] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, phoneNumber));
    if (existing && existing.companyId !== companyId) {
      logger.error("Telnyx recovery number belongs to another company"); return;
    }
    // Configure carrier services before enabling the purchased line in CallingAgent.
    if (!connectionId || !messagingProfileId) {
      logger.warn("Telnyx voice connection or SMS profile is missing; leaving setup pending"); return;
    }
    const configHeaders = { ...headers, "Content-Type": "application/json" };
    const voiceResult = await fetch("https://api.telnyx.com/v2/phone_numbers/" + encodeURIComponent(ownedNumber.id), {
      method: "PATCH", headers: configHeaders, body: JSON.stringify({ connection_id: connectionId }),
      signal: AbortSignal.timeout(12000),
    });
    if (!voiceResult.ok) { logger.error({ status: voiceResult.status }, "Voice connection assignment failed"); return; }
    const smsResult = await fetch("https://api.telnyx.com/v2/phone_numbers/" + encodeURIComponent(ownedNumber.id) + "/messaging", {
      method: "PATCH", headers: configHeaders, body: JSON.stringify({ messaging_profile_id: messagingProfileId }),
      signal: AbortSignal.timeout(12000),
    });
    if (!smsResult.ok) { logger.error({ status: smsResult.status }, "SMS messaging profile assignment failed"); return; }
    if (!existing) {
      await db.insert(phoneNumbersTable).values({
        number: phoneNumber, companyId, twilioSid: null,
        friendlyName: phoneNumber, callerIdName: company.name,
        answerMode: "forward", isActive: true,
      }).onConflictDoNothing();
    } else if (!existing.isActive) {
      await db.update(phoneNumbersTable).set({ isActive: true }).where(eq(phoneNumbersTable.id, existing.id));
    }
    logger.info({ phoneNumber, companyId }, "Telnyx number enabled in CallingAgent after voice/SMS profile assignment; calls and texts still require live testing");
  } catch (err: any) {
    logger.error({ message: err?.message }, "Telnyx one-time recovery failed");
  }
}
