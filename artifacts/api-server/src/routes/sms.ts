import { Router, type IRouter } from "express";
import { desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, phoneNumbersTable, smsMessagesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/sms", async (req, res): Promise<void> => {
  const phoneNumberId = req.query.phoneNumberId ? Number(req.query.phoneNumberId) : undefined;
  const direction = req.query.direction as string | undefined;
  const search = req.query.search as string | undefined;
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
    })
    .from(smsMessagesTable)
    .leftJoin(phoneNumbersTable, eq(smsMessagesTable.phoneNumberId, phoneNumbersTable.id))
    .where(
      sql`${phoneNumberId ? eq(smsMessagesTable.phoneNumberId, phoneNumberId) : sql`1=1`}
      AND ${direction ? eq(smsMessagesTable.direction, direction) : sql`1=1`}
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

export default router;
