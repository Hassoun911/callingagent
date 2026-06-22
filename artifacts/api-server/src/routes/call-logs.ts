import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db, callLogsTable, phoneNumbersTable } from "@workspace/db";
import { getCompanyScope } from "../lib/scope";
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

  const { phoneNumberId, direction, status, limit = 50, companyId: filterCompanyId } = query.data;

  // Determine which phone number IDs this user is allowed to see
  const scopedCompanyId = getCompanyScope(req);
  // Super-admin can optionally filter by a specific company via query param
  const effectiveCompanyId = scopedCompanyId ?? filterCompanyId ?? null;

  let allowedNumberIds: number[] | null = null;
  if (effectiveCompanyId !== null) {
    const myNumbers = await db
      .select({ id: phoneNumbersTable.id })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.companyId, effectiveCompanyId));
    allowedNumberIds = myNumbers.map(n => n.id);
  }

  let logs = await db.select().from(callLogsTable).orderBy(desc(callLogsTable.createdAt)).limit(limit);

  if (allowedNumberIds !== null) {
    logs = logs.filter(l => l.phoneNumberId !== null && allowedNumberIds!.includes(l.phoneNumberId));
  }
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
    res.status(404).send("No recording available for this call");
    return;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    res.status(500).send("Twilio credentials not configured");
    return;
  }

  const twilioUrl = log.recordingSid
    ? `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${log.recordingSid}.mp3`
    : log.recordingUrl!;

  const fetchHeaders: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
  };
  if (req.headers.range) fetchHeaders["Range"] = req.headers.range;

  const upstream = await fetch(twilioUrl, { headers: fetchHeaders });

  res.status(upstream.status);
  res.set("Content-Type", upstream.headers.get("content-type") || "audio/mpeg");
  res.set("Accept-Ranges", "bytes");
  res.set("Cache-Control", "private, max-age=3600");
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) res.set("Content-Length", contentLength);
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) res.set("Content-Range", contentRange);

  if (!upstream.body) { res.end(); return; }
  const reader = upstream.body.getReader();
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); return; }
      if (!res.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => res.once("drain", resolve));
      }
    }
  };
  await pump();
});

router.patch("/call-logs/:id/notes", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { notes } = req.body as { notes: string | null };
  const [updated] = await db
    .update(callLogsTable)
    .set({ notes: notes ?? null, updatedAt: new Date() })
    .where(eq(callLogsTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/call-logs", async (req, res): Promise<void> => {
  await db.delete(callLogsTable);
  res.json({ deleted: true });
});

router.delete("/call-logs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [deleted] = await db.delete(callLogsTable).where(eq(callLogsTable.id, id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ deleted: true });
});

export default router;
