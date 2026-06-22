import { Router, type IRouter } from "express";
import { desc, eq, gte, sql, inArray } from "drizzle-orm";
import { getCompanyScope } from "../lib/scope";
import {
  db,
  phoneNumbersTable,
  callLogsTable,
  contactsTable,
  companiesTable,
  campaignsTable,
  campaignCallLogsTable,
  campaignContactsTable,
} from "@workspace/db";
import {
  GetDashboardStatsResponse,
  GetRecentCallsResponse,
  GetRecentCallsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/stats", async (req, res): Promise<void> => {
  const companyId = getCompanyScope(req);

  // Resolve which phone number IDs to scope to
  let scopedNumberIds: number[] | null = null;
  if (companyId !== null) {
    const myNumbers = await db
      .select({ id: phoneNumbersTable.id })
      .from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.companyId, companyId));
    scopedNumberIds = myNumbers.map(n => n.id);
  }

  const phoneNumbersQuery = companyId !== null
    ? db.select({
        totalNumbers: sql<number>`count(*)::int`,
        activeNumbers: sql<number>`count(*) filter (where ${phoneNumbersTable.isActive})::int`,
      }).from(phoneNumbersTable).where(eq(phoneNumbersTable.companyId, companyId))
    : db.select({
        totalNumbers: sql<number>`count(*)::int`,
        activeNumbers: sql<number>`count(*) filter (where ${phoneNumbersTable.isActive})::int`,
      }).from(phoneNumbersTable);

  const [phoneStats] = await phoneNumbersQuery;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const callLogsQuery = scopedNumberIds !== null && scopedNumberIds.length > 0
    ? db.select({
        totalCalls: sql<number>`count(*)::int`,
        callsToday: sql<number>`count(*) filter (where ${callLogsTable.createdAt} >= ${today.toISOString()})::int`,
        avgDuration: sql<number>`coalesce(avg(${callLogsTable.duration}) filter (where ${callLogsTable.duration} is not null), 0)::int`,
        inboundCalls: sql<number>`count(*) filter (where ${callLogsTable.direction} = 'inbound')::int`,
        outboundCalls: sql<number>`count(*) filter (where ${callLogsTable.direction} = 'outbound')::int`,
        aiAnswered: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'ai_voice')::int`,
        voicemailCount: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'voicemail')::int`,
        forwardedCalls: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'forward')::int`,
      }).from(callLogsTable).where(inArray(callLogsTable.phoneNumberId, scopedNumberIds))
    : scopedNumberIds !== null
      ? db.select({
          totalCalls: sql<number>`0::int`,
          callsToday: sql<number>`0::int`,
          avgDuration: sql<number>`0::int`,
          inboundCalls: sql<number>`0::int`,
          outboundCalls: sql<number>`0::int`,
          aiAnswered: sql<number>`0::int`,
          voicemailCount: sql<number>`0::int`,
          forwardedCalls: sql<number>`0::int`,
        }).from(callLogsTable).limit(1)
      : db.select({
          totalCalls: sql<number>`count(*)::int`,
          callsToday: sql<number>`count(*) filter (where ${callLogsTable.createdAt} >= ${today.toISOString()})::int`,
          avgDuration: sql<number>`coalesce(avg(${callLogsTable.duration}) filter (where ${callLogsTable.duration} is not null), 0)::int`,
          inboundCalls: sql<number>`count(*) filter (where ${callLogsTable.direction} = 'inbound')::int`,
          outboundCalls: sql<number>`count(*) filter (where ${callLogsTable.direction} = 'outbound')::int`,
          aiAnswered: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'ai_voice')::int`,
          voicemailCount: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'voicemail')::int`,
          forwardedCalls: sql<number>`count(*) filter (where ${callLogsTable.answerMode} = 'forward')::int`,
        }).from(callLogsTable);

  const [callStats] = await callLogsQuery;

  const contactsQuery = companyId !== null
    ? db.select({ totalContacts: sql<number>`count(*)::int` }).from(contactsTable).where(eq(contactsTable.companyId, companyId))
    : db.select({ totalContacts: sql<number>`count(*)::int` }).from(contactsTable);
  const [contactCount] = await contactsQuery;

  const [companyCount] = companyId !== null
    ? [{ totalCompanies: 1 }]
    : await db.select({ totalCompanies: sql<number>`count(*)::int` }).from(companiesTable);

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

  // Regular inbound/outbound call logs (joined with phone number + company)
  const regularLogs = await db
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
      campaignId: sql<null>`null`,
      campaignName: sql<null>`null`,
      campaignContactName: sql<null>`null`,
    })
    .from(callLogsTable)
    .leftJoin(phoneNumbersTable, eq(callLogsTable.phoneNumberId, phoneNumbersTable.id))
    .leftJoin(companiesTable, eq(phoneNumbersTable.companyId, companiesTable.id))
    .orderBy(desc(callLogsTable.createdAt))
    .limit(limit);

  // Campaign outbound call logs (joined with campaign + contact + from phone number)
  const campaignLogs = await db
    .select({
      id: campaignCallLogsTable.id,
      phoneNumberId: sql<null>`null`,
      twilioCallSid: campaignCallLogsTable.twilioCallSid,
      direction: sql<string>`'outbound'`,
      status: campaignCallLogsTable.callStatus,
      fromNumber: phoneNumbersTable.number,
      toNumber: campaignContactsTable.phone,
      duration: campaignCallLogsTable.callDuration,
      recordingUrl: campaignCallLogsTable.recordingUrl,
      recordingSid: campaignCallLogsTable.recordingSid,
      transcription: campaignCallLogsTable.transcription,
      contactId: campaignCallLogsTable.contactId,
      contactName: campaignContactsTable.name,
      callerIdName: sql<null>`null`,
      answerMode: sql<null>`null`,
      callerName: campaignContactsTable.name,
      callerEmail: sql<null>`null`,
      callType: sql<string>`'Campaign Call'`,
      callSummary: campaignCallLogsTable.callSummary,
      actionRequired: sql<null>`null`,
      priority: sql<null>`null`,
      createdAt: campaignCallLogsTable.calledAt,
      companyId: sql<null>`null`,
      companyName: sql<null>`null`,
      phoneNumber: phoneNumbersTable.number,
      phoneFriendlyName: phoneNumbersTable.friendlyName,
      campaignId: campaignsTable.id,
      campaignName: campaignsTable.name,
      campaignContactName: campaignContactsTable.name,
    })
    .from(campaignCallLogsTable)
    .innerJoin(campaignContactsTable, eq(campaignCallLogsTable.contactId, campaignContactsTable.id))
    .innerJoin(campaignsTable, eq(campaignCallLogsTable.campaignId, campaignsTable.id))
    .leftJoin(phoneNumbersTable, eq(campaignsTable.fromPhoneNumberId, phoneNumbersTable.id))
    .orderBy(desc(campaignCallLogsTable.calledAt))
    .limit(limit);

  // Merge, sort by date, take top N
  const merged = [...regularLogs, ...campaignLogs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  res.json(GetRecentCallsResponse.parse(merged.map(l => ({
    ...l,
    createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
  }))));
});

export default router;
