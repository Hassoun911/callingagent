import { Router, type IRouter } from "express";
import { desc, eq, ilike, or, sql, and } from "drizzle-orm";
import { db, phoneNumbersTable, smsMessagesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import twilio from "twilio";

const router: IRouter = Router();

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
  return twilio(accountSid, authToken);
}

router.get("/sms", async (req, res): Promise<void> => {
  const phoneNumberId = req.query.phoneNumberId ? Number(req.query.phoneNumberId) : undefined;
  const direction = req.query.direction as string | undefined;
  const search = req.query.search as string | undefined;
  const contactNumber = req.query.contactNumber as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Number(req.query.offset ?? 0);

  const rows = await db
    .select({
      id: smsMessagesTable.id,
      phoneNumberId: smsMessagesTable.phoneNumberId,
      twilioSid: smsMessagesTable.twilioSid,
      direction: smsMessagesTable.direction,
      from: smsMessagesTable.from,
      to: smsMessagesTable.to,
      body: smsMessagesTable.body,
      status: smsMessagesTable.status,
      numMedia: smsMessagesTable.numMedia,
      mediaUrls: smsMessagesTable.mediaUrls,
      createdAt: smsMessagesTable.createdAt,
      updatedAt: smsMessagesTable.updatedAt,
      lineName: phoneNumbersTable.friendlyName,
      lineNumber: phoneNumbersTable.number,
    })
    .from(smsMessagesTable)
    .leftJoin(phoneNumbersTable, eq(smsMessagesTable.phoneNumberId, phoneNumbersTable.id))
    .where(
      sql`${phoneNumberId ? eq(smsMessagesTable.phoneNumberId, phoneNumberId) : sql`1=1`}
      AND ${direction ? eq(smsMessagesTable.direction, direction) : sql`1=1`}
      AND ${contactNumber ? or(
        eq(smsMessagesTable.from, contactNumber),
        eq(smsMessagesTable.to, contactNumber)
      ) : sql`1=1`}
      AND ${search ? or(
        ilike(smsMessagesTable.from, `%${search}%`),
        ilike(smsMessagesTable.to, `%${search}%`),
        ilike(smsMessagesTable.body, `%${search}%`)
      ) : sql`1=1`}`
    )
    .orderBy(desc(smsMessagesTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  })));
});

router.get("/sms/unread-count", async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(smsMessagesTable)
    .where(eq(smsMessagesTable.direction, "inbound"));

  res.json({ count: row?.count ?? 0 });
});

router.post("/sms/send", async (req, res): Promise<void> => {
  const { from, to, body } = req.body;
  if (!from || !to || !body) {
    res.status(400).json({ error: "from, to, and body are required" });
    return;
  }

  // Look up the phone number row for the "from" number
  const [pn] = await db
    .select()
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.number, from));

  try {
    const client = getTwilioClient();
    const message = await client.messages.create({ from, to, body });

    const [inserted] = await db.insert(smsMessagesTable).values({
      twilioSid: message.sid,
      phoneNumberId: pn?.id ?? null,
      direction: "outbound",
      from,
      to,
      body,
      status: message.status,
      numMedia: 0,
      mediaUrls: null,
    }).returning();

    res.json({
      ...inserted,
      createdAt: inserted.createdAt.toISOString(),
      updatedAt: inserted.updatedAt.toISOString(),
      lineName: pn?.friendlyName ?? null,
      lineNumber: pn?.number ?? null,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to send SMS");
    res.status(500).json({ error: err.message || "Failed to send SMS" });
  }
});

export default router;
