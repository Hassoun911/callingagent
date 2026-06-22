import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, phoneNumbersTable } from "@workspace/db";
import { getCompanyScope } from "../lib/scope";
import {
  ListPhoneNumbersResponse,
  GetPhoneNumberResponse,
  GetPhoneNumberParams,
  ProvisionPhoneNumberBody,
  UpdatePhoneNumberParams,
  UpdatePhoneNumberBody,
  UpdatePhoneNumberResponse,
  ReleasePhoneNumberParams,
  SearchAvailableNumbersQueryParams,
  SearchAvailableNumbersResponse,
  TestCallParams,
  TestCallBody,
  TestCallResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";
import twilio from "twilio";

const router: IRouter = Router();

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Twilio credentials not configured");
  }
  return twilio(accountSid, authToken);
}

function getBaseUrl(req: any): string {
  const domain = process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DOMAINS?.split(",")[0];
  if (domain) return `https://${domain}`;
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/phone-numbers", async (req, res): Promise<void> => {
  const companyId = getCompanyScope(req);
  let numbers = await db.select().from(phoneNumbersTable).orderBy(desc(phoneNumbersTable.createdAt));
  if (companyId !== null) {
    numbers = numbers.filter(n => n.companyId === companyId);
  }
  res.json(ListPhoneNumbersResponse.parse(numbers.map(n => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
  }))));
});

router.get("/phone-numbers/search", async (req, res): Promise<void> => {
  const query = SearchAvailableNumbersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  try {
    const client = getTwilioClient();
    const { areaCode, contains, country = "US", tollFree, city } = query.data as any;

    let numbers: any[] = [];

    if (tollFree) {
      const searchParams: any = { limit: 20 };
      if (city) searchParams.inLocality = city;
      const result = await client.availablePhoneNumbers(country).tollFree.list(searchParams);
      numbers = result;
    } else {
      const searchParams: any = { limit: 20 };
      if (areaCode) searchParams.areaCode = areaCode;
      if (contains) searchParams.contains = contains;
      if (city) searchParams.inLocality = city;

      const result = await client.availablePhoneNumbers(country).local.list(searchParams);
      numbers = result;
    }

    let formatted = numbers.map((n: any) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality || null,
      region: n.region || null,
      postalCode: n.postalCode || null,
      isoCountry: n.isoCountry,
      capabilities: {
        voice: n.capabilities?.voice ?? false,
        sms: n.capabilities?.SMS ?? false,
        mms: n.capabilities?.MMS ?? false,
      },
    }));

    // Twilio's inLocality filter is unreliable (especially for Canada) — enforce it client-side
    if (city) {
      const cityLower = city.toLowerCase().trim();
      formatted = formatted.filter(n =>
        n.locality?.toLowerCase().includes(cityLower)
      );
      // If strict filter yields nothing, widen: fetch more numbers without limit and retry filter
      if (formatted.length === 0 && !tollFree) {
        const wider: any = { limit: 50 };
        if (areaCode) wider.areaCode = areaCode;
        const widerResult = await client.availablePhoneNumbers(country).local.list(wider);
        formatted = widerResult
          .filter((n: any) => n.locality?.toLowerCase().includes(cityLower))
          .map((n: any) => ({
            phoneNumber: n.phoneNumber,
            friendlyName: n.friendlyName,
            locality: n.locality || null,
            region: n.region || null,
            postalCode: n.postalCode || null,
            isoCountry: n.isoCountry,
            capabilities: {
              voice: n.capabilities?.voice ?? false,
              sms: n.capabilities?.SMS ?? false,
              mms: n.capabilities?.MMS ?? false,
            },
          }));
      }
    }

    res.json(SearchAvailableNumbersResponse.parse(formatted));
  } catch (err: any) {
    req.log.error({ err }, "Failed to search available numbers");
    res.status(500).json({ error: err.message || "Failed to search numbers" });
  }
});

// Import an existing Twilio number into Vanguard.OPS
router.post("/phone-numbers/import", async (req, res): Promise<void> => {
  const { number, friendlyName } = req.body ?? {};
  if (!number || typeof number !== "string") {
    res.status(400).json({ error: "number is required (E.164 format, e.g. +15551234567)" });
    return;
  }

  let client;
  try {
    client = getTwilioClient();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
    return;
  }

  // Look up the number in the Twilio account
  let incomingNumbers: any[];
  try {
    incomingNumbers = await client.incomingPhoneNumbers.list({ phoneNumber: number });
  } catch (err: any) {
    req.log.error({ err }, "Twilio lookup failed");
    res.status(500).json({ error: "Failed to query Twilio: " + (err.message ?? "unknown") });
    return;
  }

  if (!incomingNumbers || incomingNumbers.length === 0) {
    res.status(404).json({ error: `${number} was not found in your Twilio account. Make sure the number is already purchased there before importing.` });
    return;
  }

  const twilioNum = incomingNumbers[0];
  const baseUrl = getBaseUrl(req);

  // Update webhook URLs on the Twilio number to point at our system
  try {
    await client.incomingPhoneNumbers(twilioNum.sid).update({
      voiceUrl: `${baseUrl}/api/twilio/voice`,
      voiceMethod: "POST",
      statusCallback: `${baseUrl}/api/twilio/status`,
      statusCallbackMethod: "POST",
      smsUrl: `${baseUrl}/api/twilio/sms`,
      smsMethod: "POST",
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to update Twilio webhooks on imported number");
    res.status(500).json({ error: "Found number but failed to configure webhooks: " + (err.message ?? "unknown") });
    return;
  }

  // Check if already imported
  const existing = await db.select().from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.number, number));
  if (existing.length > 0) {
    res.status(409).json({ error: `${number} is already in your Vanguard.OPS account.` });
    return;
  }

  const displayName = friendlyName || twilioNum.friendlyName || number;
  const [inserted] = await db.insert(phoneNumbersTable).values({
    number,
    twilioSid: twilioNum.sid,
    friendlyName: displayName,
    callerIdName: displayName,
    answerMode: "forward",
  }).returning();

  res.status(201).json(GetPhoneNumberResponse.parse({
    ...inserted,
    createdAt: inserted.createdAt.toISOString(),
  }));
});

router.post("/phone-numbers", async (req, res): Promise<void> => {
  const parsed = ProvisionPhoneNumberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;
  let twilioSid = data.twilioSid || null;

  // If purchasing from Twilio
  if (!twilioSid && data.number) {
    try {
      const client = getTwilioClient();
      const baseUrl = getBaseUrl(req);
      const purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: data.number,
        voiceUrl: `${baseUrl}/api/twilio/voice`,
        voiceMethod: "POST",
        statusCallback: `${baseUrl}/api/twilio/status`,
        statusCallbackMethod: "POST",
        smsUrl: `${baseUrl}/api/twilio/sms`,
        smsMethod: "POST",
        friendlyName: data.callerIdName,
      });
      twilioSid = purchased.sid;
    } catch (err: any) {
      req.log.error({ err }, "Failed to purchase Twilio number");
      res.status(500).json({ error: err.message || "Failed to purchase number" });
      return;
    }
  }

  const [number] = await db.insert(phoneNumbersTable).values({
    number: data.number,
    twilioSid,
    friendlyName: data.friendlyName,
    callerIdName: data.callerIdName,
    companyId: data.companyId ?? null,
    forwardTo: data.forwardTo ?? null,
    ringCount: data.ringCount ?? 4,
    answerMode: data.answerMode,
    aiSystemPrompt: data.aiSystemPrompt ?? null,
    voicemailGreeting: data.voicemailGreeting ?? null,
  }).returning();

  res.status(201).json(GetPhoneNumberResponse.parse({
    ...number,
    createdAt: number.createdAt.toISOString(),
  }));
});

router.get("/phone-numbers/:id/twilio-status", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [number] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, id));
  if (!number) { res.status(404).json({ error: "Phone number not found" }); return; }
  if (!number.twilioSid) { res.status(404).json({ error: "No Twilio SID for this number" }); return; }

  try {
    const client = getTwilioClient();
    const n = await client.incomingPhoneNumbers(number.twilioSid).fetch();
    res.json({
      sid: n.sid,
      phoneNumber: n.phoneNumber,
      status: "active",
      monthlyRentPrice: (n as any).monthlyRentPrice ?? null,
      voiceUrl: n.voiceUrl ?? null,
      dateCreated: n.dateCreated ? n.dateCreated.toISOString() : null,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to fetch Twilio status");
    res.status(500).json({ error: err.message || "Failed to fetch Twilio status" });
  }
});

router.get("/phone-numbers/:id", async (req, res): Promise<void> => {
  const params = GetPhoneNumberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [number] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, params.data.id));
  if (!number) {
    res.status(404).json({ error: "Phone number not found" });
    return;
  }

  const companyId = getCompanyScope(req);
  if (companyId !== null && number.companyId !== companyId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  res.json(GetPhoneNumberResponse.parse({ ...number, createdAt: number.createdAt.toISOString() }));
});

router.patch("/phone-numbers/:id", async (req, res): Promise<void> => {
  const params = UpdatePhoneNumberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdatePhoneNumberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  const body = parsed.data;
  if (body.friendlyName != null) updateData.friendlyName = body.friendlyName;
  if (body.callerIdName != null) updateData.callerIdName = body.callerIdName;
  if (body.companyId !== undefined) updateData.companyId = body.companyId;
  if (body.forwardTo !== undefined) updateData.forwardTo = body.forwardTo;
  if (body.ringCount != null) updateData.ringCount = body.ringCount;
  if (body.answerMode != null) updateData.answerMode = body.answerMode;
  if (body.aiSystemPrompt !== undefined) updateData.aiSystemPrompt = body.aiSystemPrompt;
  if (body.aiVoice !== undefined) updateData.aiVoice = body.aiVoice ?? null;
  if (body.aiLanguage !== undefined) updateData.aiLanguage = body.aiLanguage ?? null;
  if (body.aiGreeting !== undefined) updateData.aiGreeting = body.aiGreeting ?? null;
  if (body.aiSpeakingStyle !== undefined) updateData.aiSpeakingStyle = body.aiSpeakingStyle ?? null;
  if (body.voicemailGreeting !== undefined) updateData.voicemailGreeting = body.voicemailGreeting;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.forwardCallerId != null) updateData.forwardCallerId = body.forwardCallerId;
  if (body.callerExperience != null) updateData.callerExperience = body.callerExperience;
  if (body.callScreen !== undefined) updateData.callScreen = body.callScreen ?? false;
  if (body.callScreenFallback != null) updateData.callScreenFallback = body.callScreenFallback;
  if (body.forwardNoAnswerAction != null) updateData.forwardNoAnswerAction = body.forwardNoAnswerAction;
  if ("holdMessage" in body) updateData.holdMessage = body.holdMessage ?? null;
  if ("notificationEmail" in body) updateData.notificationEmail = body.notificationEmail || null;

  const [updated] = await db.update(phoneNumbersTable)
    .set(updateData)
    .where(eq(phoneNumbersTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Phone number not found" });
    return;
  }

  // Update Twilio caller ID name if changed
  if (updated.twilioSid && (body.callerIdName || body.friendlyName)) {
    try {
      const client = getTwilioClient();
      await client.incomingPhoneNumbers(updated.twilioSid).update({
        friendlyName: updated.callerIdName,
      });
    } catch (err) {
      req.log.warn({ err }, "Failed to update Twilio caller ID");
    }
  }

  res.json(UpdatePhoneNumberResponse.parse({ ...updated, createdAt: updated.createdAt.toISOString() }));
});

router.delete("/phone-numbers/:id", async (req, res): Promise<void> => {
  const params = ReleasePhoneNumberParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [number] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, params.data.id));
  if (!number) {
    res.status(404).json({ error: "Phone number not found" });
    return;
  }

  // Release from Twilio
  if (number.twilioSid) {
    try {
      const client = getTwilioClient();
      await client.incomingPhoneNumbers(number.twilioSid).remove();
    } catch (err) {
      req.log.warn({ err }, "Failed to release Twilio number");
    }
  }

  await db.delete(phoneNumbersTable).where(eq(phoneNumbersTable.id, params.data.id));
  res.sendStatus(204);
});

router.post("/phone-numbers/:id/test-call", async (req, res): Promise<void> => {
  const params = TestCallParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = TestCallBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [number] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, params.data.id));
  if (!number) {
    res.status(404).json({ error: "Phone number not found" });
    return;
  }

  try {
    const client = getTwilioClient();
    const call = await client.calls.create({
      from: number.number,
      to: parsed.data.toNumber,
      twiml: "<Response><Say>This is a test call from your call center. Everything is working correctly.</Say></Response>",
    });

    res.json(TestCallResponse.parse({ callSid: call.sid, status: call.status }));
  } catch (err: any) {
    req.log.error({ err }, "Failed to place test call");
    res.status(500).json({ error: err.message || "Failed to place call" });
  }
});

export default router;
