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
    const [existing] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.number, phoneNumber));
    if (existing) {
      if (existing.companyId !== companyId) logger.error("Telnyx recovery number assigned to a different company");
      else logger.info({ phoneNumber, companyId }, "Telnyx recovery already registered");
      return;
    }
    await db.insert(phoneNumbersTable).values({
      number: phoneNumber, companyId, twilioSid: null,
      friendlyName: phoneNumber, callerIdName: company.name,
      answerMode: "forward", isActive: false,
    }).onConflictDoNothing();
    logger.info({ phoneNumber, companyId }, "Telnyx purchased number safely restored as Setup Required");
  } catch (err: any) {
    logger.error({ message: err?.message }, "Telnyx one-time recovery failed");
  }
}
