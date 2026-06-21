import { Router, type IRouter } from "express";
import { desc, eq, gte, sql } from "drizzle-orm";
import { db, phoneNumbersTable, callLogsTable, contactsTable, companiesTable } from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentCallsResponse,
  GetRecentCallsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", async (_req, res): Promise<void> => {
  const [phoneStats] = await db.select({
    totalNumbers: sql<number>`count(*)::int`,
    activeNumbers: sql<number>`count(*) filter (where ${phoneNumbersTable.isActive})::int`,
  }).from(phoneNumbersTable);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [callStats] = await db.select({
    totalCalls: sql<number>`count(*)::int`,
    callsToday: sql<number>`count(*) filter (where ${callLogsTable.createdAt} >= ${today.toISOString()})::int`,
    avgDuration: sql<number>`coalesce(avg(${callLogsTable.duration}) filter (where ${callLogsTable.duration} is not null), 0)::int`,
    inboundCalls: sql<number>`count(*) filter (where ${callLogsTable.direction} = 'inbound')::int`,
    outboundCalls: sql<number>`count(*) filter (where ${callLogsTable.direction} = 'outbound')::int`,
    aiAnswered: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'ai_voice')::int`,
    voicemailCount: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'voicemail')::int`,
    forwardedCalls: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'forward')::int`,
  }).from(callLogsTable);

  const [contactCount] = await db.select({
    totalContacts: sql<number>`count(*)::int`,
  }).from(contactsTable);

  const [companyCount] = await db.select({
    totalCompanies: sql<number>`count(*)::int`,
  }).from(companiesTable);

  res.json(GetDashboardStatsResponse.parse({
    totalNumbers: phoneStats?.totalNumbers ?? 0,
    activeNumbers: phoneStats?.activeNumbers ?? 0,
    totalCalls: callStats?.totalCalls ?? 0,
    callsToday: callStats?.callsToday ?? 0,
    avgDuration: callStats?.avgDuration ?? 0,
    inboundCalls: callStats?.inboundCalls ?? 0,
    outboundCalls: callStats?.outboundCalls ?? 0,
    aiAnswered: callStats?.aiAnswered ?? 0,
    voicemailCount: callStats?.voicemailCount ?? 0,
    forwardedCalls: callStats?.forwardedCalls ?? 0,
    totalContacts: contactCount?.totalContacts ?? 0,
    totalCompanies: companyCount?.totalCompanies ?? 0,
  }));
});

router.get("/dashboard/recent-calls", async (req, res): Promise<void> => {
  const query = GetRecentCallsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const limit = query.data.limit ?? 10;
  const logs = await db
    .select({
      id: callLogsTable.id,
      phoneNumberId: callLogsTable.phoneNumberId,
      twilioCallSid: callLogsTable.twilioCallSid,
      direction: callLogsTable.direction,
      status: callLogsTable.status,
      fromNumber: callLogsTable.fromNumber,
      toNumber: callLogsTable.toNumber,
      duration: callLogsTable.duration,
      recordingUrl: callLogsTable.recordingUrl,
      recordingSid: callLogsTable.recordingSid,
      transcription: callLogsTable.transcription,
      contactId: callLogsTable.contactId,
      contactName: callLogsTable.contactName,
      callerIdName: callLogsTable.callerIdName,
      answerMode: callLogsTable.answerMode,
      callerName: callLogsTable.callerName,
      callerEmail: callLogsTable.callerEmail,
      callType: callLogsTable.callType,
      callSummary: callLogsTable.callSummary,
      actionRequired: callLogsTable.actionRequired,
      priority: callLogsTable.priority,
      createdAt: callLogsTable.createdAt,
      companyId: companiesTable.id,
      companyName: companiesTable.name,
      phoneNumber: phoneNumbersTable.number,
      phoneFriendlyName: phoneNumbersTable.friendlyName,
    })
    .from(callLogsTable)
    .leftJoin(phoneNumbersTable, eq(callLogsTable.phoneNumberId, phoneNumbersTable.id))
    .leftJoin(companiesTable, eq(phoneNumbersTable.companyId, companiesTable.id))
    .orderBy(desc(callLogsTable.createdAt))
    .limit(limit);

  res.json(GetRecentCallsResponse.parse(logs.map(l => ({
    ...l,
    createdAt: l.createdAt.toISOString(),
  }))));
});

export default router;
