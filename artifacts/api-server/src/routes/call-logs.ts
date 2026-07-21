import { Router, type IRouter } from "express";
import { eq, desc, inArray, and } from "drizzle-orm";
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

async function getAllowedNumberIds(req: any, requestedCompanyId?: number | null): Promise<number[] | null> {
  const scopedCompanyId = getCompanyScope(req);
  const effectiveCompanyId = scopedCompanyId ?? requestedCompanyId ?? null;
  if (effectiveCompanyId === null) return null;

  const rows = await db
    .select({ id: phoneNumbersTable.id })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.companyId, effectiveCompanyId));
  return rows.map((row) => row.id);
}

async function canAccessLog(req: any, phoneNumberId: number | null): Promise<boolean> {
  const allowedNumberIds = await getAllowedNumberIds(req);
  if (allowedNumberIds === null) return true;
  return phoneNumberId !== null && allowedNumberIds.includes(phoneNumberId);
}

router.get("/call-logs", async (req, res): Promise<void> => {
  const query = ListCallLogsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { phoneNumberId, direction, status, limit = 50, companyId: filterCompanyId } = query.data;
  const allowedNumberIds = await getAllowedNumberIds(req, filterCompanyId);

  if (allowedNumberIds !== null && allowedNumberIds.length === 0) {
    res.json([]);
    return;
  }

  const conditions = [];
  if (allowedNumberIds !== null) conditions.push(inArray(callLogsTable.phoneNumberId, allowedNumberIds));
  if (phoneNumberId) {
    if (allowedNumberIds !== null && !allowedNumberIds.includes(phoneNumberId)) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    conditions.push(eq(callLogsTable.phoneNumberId, phoneNumberId));
  }
  if (direction) conditions.push(eq(callLogsTable.direction, direction));
  if (status) conditions.push(eq(callLogsTable.status, status));

  const logs = conditions.length
    ? await db.select().from(callLogsTable).where(and(...conditions)).orderBy(desc(callLogsTable.createdAt)).limit(limit)
    : await db.select().from(callLogsTable).orderBy(desc(callLogsTable.createdAt)).limit(limit);

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
  if (!(await canAccessLog(req, log.phoneNumberId))) {
    res.status(403).json({ error: "Access denied" });
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
  if (!(await canAccessLog(req, log.phoneNumberId))) {
    res.status(403).json({ error: "Access denied" });
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
  const [existing] = await db.select().from(callLogsTable).where(eq(callLogsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessLog(req, existing.phoneNumberId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const { notes } = req.body as { notes: string | null };
  const [updated] = await db
    .update(callLogsTable)
    .set({ notes: notes ?? null, updatedAt: new Date() })
    .where(eq(callLogsTable.id, id))
    .returning();
  res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

router.delete("/call-logs", async (req, res): Promise<void> => {
  const allowedNumberIds = await getAllowedNumberIds(req);
  if (allowedNumberIds === null) {
    await db.delete(callLogsTable);
  } else if (allowedNumberIds.length > 0) {
    await db.delete(callLogsTable).where(inArray(callLogsTable.phoneNumberId, allowedNumberIds));
  }
  res.json({ deleted: true });
});

router.delete("/call-logs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [existing] = await db.select().from(callLogsTable).where(eq(callLogsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!(await canAccessLog(req, existing.phoneNumberId))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  await db.delete(callLogsTable).where(eq(callLogsTable.id, id));
  res.json({ deleted: true });
});

export default router;
