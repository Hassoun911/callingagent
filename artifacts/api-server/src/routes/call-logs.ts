import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, callLogsTable } from "@workspace/db";
import {
  ListCallLogsResponse,
  ListCallLogsQueryParams,
  GetCallLogResponse,
  GetCallLogParams,
  GetRecordingUrlParams,
  GetRecordingUrlResponse,
} from "@workspace/api-zod";
import twilio from "twilio";

const router: IRouter = Router();

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");
  return twilio(accountSid, authToken);
}

router.get("/call-logs", async (req, res): Promise<void> => {
  const query = ListCallLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { phoneNumberId, direction, status, limit = 50 } = query.data;

  let logs = await db.select().from(callLogsTable).orderBy(desc(callLogsTable.createdAt)).limit(limit);

  if (phoneNumberId) logs = logs.filter(l => l.phoneNumberId === phoneNumberId);
  if (direction) logs = logs.filter(l => l.direction === direction);
  if (status) logs = logs.filter(l => l.status === status);

  res.json(ListCallLogsResponse.parse(logs.map(l => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
  }))));
});

router.get("/call-logs/:id", async (req, res): Promise<void> => {
  const params = GetCallLogParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.id, params.data.id));
  if (!log) {
    res.status(404).json({ error: "Call log not found" });
    return;
  }

  res.json(GetCallLogResponse.parse({ ...log, createdAt: log.createdAt.toISOString() }));
});

router.get("/call-logs/:id/recording", async (req, res): Promise<void> => {
  const params = GetRecordingUrlParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [log] = await db.select().from(callLogsTable).where(eq(callLogsTable.id, params.data.id));
  if (!log) {
    res.status(404).json({ error: "Call log not found" });
    return;
  }

  if (!log.recordingSid && !log.recordingUrl) {
    res.status(404).json({ error: "No recording available for this call" });
    return;
  }

  // Build authenticated Twilio recording URL
  let url = log.recordingUrl || "";
  if (log.recordingSid) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (accountSid && authToken) {
      url = `https://${accountSid}:${authToken}@api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${log.recordingSid}.mp3`;
    }
  }

  res.json(GetRecordingUrlResponse.parse({ url, expiresAt: null }));
});

export default router;
