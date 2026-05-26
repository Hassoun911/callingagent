import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, phoneNumbersTable } from "@workspace/db";
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
  const numbers = await db.select().from(phoneNumbersTable).orderBy(desc(phoneNumbersTable.createdAt));
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
        statusCallback: `${baseUrl}/api/twilio/status`,
        voiceMethod: "POST",
        statusCallbackMethod: "POST",
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
  if (body.voicemailGreeting !== undefined) updateData.voicemailGreeting = body.voicemailGreeting;
  if (body.isActive != null) updateData.isActive = body.isActive;
  if (body.forwardCallerId != null) updateData.forwardCallerId = body.forwardCallerId;
  if (body.callScreen !== undefined) updateData.callScreen = body.callScreen ?? false;
  if (body.callScreenFallback != null) updateData.callScreenFallback = body.callScreenFallback;
  if ("holdMessage" in body) updateData.holdMessage = body.holdMessage ?? null;

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
