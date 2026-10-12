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
    const { areaCode, contains, country = "CA", tollFree, city } = query.data as any;

    // Enforce the administrative region, not just the locality name.
    const province = typeof req.query.province === "string" ? req.query.province.trim().toUpperCase() : "";
    const provinceCodes: Record<string, string[]> = {
      CA: ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"],
      US: ["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC"]
    };
    if (!tollFree && city && (!province || !provinceCodes[country]?.includes(province))) {
      res.status(400).json({ error: "Select a valid province/state when searching by city." });
      return;
    }
    const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
    const codeMatches = (region: string | null | undefined) => normalize(region) === province.toLowerCase();
    const format = (n: any) => ({
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
    });
    let formatted: ReturnType<typeof format>[] = [];
    if (tollFree) {
      // Query all seven NANP toll-free prefixes independently. Twilio's default
      // 20-result sample cannot represent complete prefix coverage.
      const prefixes = ["800", "833", "844", "855", "866", "877", "888"];
      const requestedPrefix = typeof req.query.tollFreePrefix === "string" ? req.query.tollFreePrefix : "";
      if (requestedPrefix && !prefixes.includes(requestedPrefix)) {
        res.status(400).json({ error: "Invalid toll-free prefix." });
        return;
      }
      const selected = requestedPrefix ? [requestedPrefix] : prefixes;
      const batches = await Promise.all(selected.map(async prefix => {
        try {
          const params: any = { areaCode: Number(prefix), limit: 1000, pageSize: 100 };
          if (contains) params.contains = contains;
          return (await client.availablePhoneNumbers(country).tollFree.list(params)).map(format)
            .filter(n => n.phoneNumber?.replace(/^\\+1/, "").startsWith(prefix));
        } catch (err) {
          req.log.warn({ err, prefix, country }, "Toll-free prefix search failed");
          return [];
        }
      }));
      formatted = [...new Map(batches.flat().map(n => [n.phoneNumber, n])).values()]
        .sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber));
    } else {
      // Apply the same exact-match → nearby → region fallback to any locality or area code.
      const targetCity = (city || "").trim();
      const ontarioPlaces: Record<string, [number, number]> = {
        Windsor:[42.3149,-83.0364], LaSalle:[42.2167,-83.0667], Tecumseh:[42.3128,-82.8869],
        Amherstburg:[42.1014,-83.1131], Lakeshore:[42.2967,-82.7150], Essex:[42.1731,-82.8198],
        Harrow:[42.0378,-82.9167], Kingsville:[42.0363,-82.7394], Leamington:[42.0532,-82.5998],
        Tilbury:[42.2620,-82.4320], Chatham:[42.4048,-82.1910], Blenheim:[42.3350,-81.9971],
        Wallaceburg:[42.5930,-82.3890], Sarnia:[42.9745,-82.4066], Strathroy:[42.9551,-81.6223],
        London:[42.9849,-81.2453], "St. Thomas":[42.7792,-81.1927], Woodstock:[43.1315,-80.7466],
        Ingersoll:[43.0397,-80.8820], Brantford:[43.1394,-80.2644], Kitchener:[43.4516,-80.4925],
        Waterloo:[43.4643,-80.5204], Cambridge:[43.3616,-80.3144], Hamilton:[43.2557,-79.8711],
        Toronto:[43.6532,-79.3832], Barrie:[44.3894,-79.6903], Orillia:[44.6087,-79.4207],
        Midland:[44.7495,-79.8922], Guelph:[43.5448,-80.2482], Niagara:[43.0896,-79.0849],
        "Niagara Falls":[43.0896,-79.0849], "St. Catharines":[43.1594,-79.2469], Oakville:[43.4675,-79.6877],
        Mississauga:[43.5890,-79.6441], Burlington:[43.3255,-79.7990], Oshawa:[43.8971,-78.8658],
        Kingston:[44.2312,-76.4860], Ottawa:[45.4215,-75.6972], Peterborough:[44.3091,-78.3197],
        Belleville:[44.1628,-77.3832], Sudbury:[46.4917,-80.9930], NorthBay:[46.3091,-79.4608],
        "North Bay":[46.3091,-79.4608], "Sault Ste. Marie":[46.5219,-84.3461]
      };
      const coordinate = (name: string | null | undefined) =>
        Object.entries(ontarioPlaces).find(([key]) => normalize(key) === normalize(name))?.[1];
      const origin = country === "CA" && province === "ON" ? coordinate(targetCity) : undefined;
      const distance = (a: number[], b: number[]) => {
        const radians = (v: number) => v * Math.PI / 180;
        const dLat = radians(b[0] - a[0]), dLon = radians(b[1] - a[1]);
        const v = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a[0])) *
          Math.cos(radians(b[0])) * Math.sin(dLon / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
      };
      const unique = new Map<string, ReturnType<typeof format>>();
      const add = (items: any[]) => {
        for (const n of items.map(format)) {
          if (province && !codeMatches(n.region)) continue;
          if (normalize(n.isoCountry) !== normalize(country)) continue;
          unique.set(n.phoneNumber, n);
        }
      };
      const find = async (params: any) => {
        try {
          add(await client.availablePhoneNumbers(country).local.list(params));
        } catch (err) {
          req.log.warn({ err, params }, "Twilio locality inventory request failed");
        }
      };
      // Allow Twilio auto-pagination instead of restricting each locality to 100 results.
      // The provider controls the maximum results and request duration.
      const base: any = { limit: 1000, pageSize: 100 };
      if (province) base.inRegion = province;
      if (contains) base.contains = contains;

      // Both fields are independent preferences; if both are provided, try their intersection first.
      if (targetCity) await find({ ...base, inLocality: targetCity, ...(areaCode ? { areaCode } : {}) });
      if (areaCode && (!targetCity || ![...unique.values()].length))
        await find({ ...base, areaCode });
      if (targetCity && ![...unique.values()].some(n => normalize(n.locality) === normalize(targetCity)))
        await find({ ...base, inLocality: targetCity });

      const exactCity = targetCity && [...unique.values()].some(n => normalize(n.locality) === normalize(targetCity));
      const exactCode = areaCode && [...unique.values()].some(n => n.phoneNumber?.replace(/^\\+1/, "").startsWith(areaCode));
      if (!exactCity && !exactCode) {
        // Search nearby named cities in order if known, avoiding the provider's 100-item
        // province-wide cap obscuring closer localities.
        if (origin) {
          const near = Object.entries(ontarioPlaces)
            .filter(([place]) => normalize(place) !== normalize(targetCity))
            .sort((a,b) => distance(origin,a[1])-distance(origin,b[1]));
          for (const [place] of near) {
            await find({ ...base, inLocality: place });
          }
        }
        await find(base);
      }
      const matches = [...unique.values()];
      const byPreference = (n: ReturnType<typeof format>) => {
        if (targetCity && normalize(n.locality) === normalize(targetCity)) return -2;
        if (areaCode && n.phoneNumber?.replace(/^\\+1/, "").startsWith(areaCode)) return -1;
        const pos = origin && coordinate(n.locality);
        return pos && origin ? distance(origin, pos) : Number.POSITIVE_INFINITY;
      };
      formatted = matches.sort((a,b) =>
        byPreference(a) - byPreference(b) || a.phoneNumber.localeCompare(b.phoneNumber)
      );
    }

    res.json(SearchAvailableNumbersResponse.parse(formatted));
  } catch (err: any) {
    req.log.error({ err }, "Failed to search available numbers");
    res.status(500).json({ error: err.message || "Failed to search numbers" });
  }
});

// Import an existing Twilio number into CallingAgent
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

  // Check if already imported before touching Twilio webhooks
  const existing = await db.select().from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.number, number));
  if (existing.length > 0) {
    res.status(409).json({ error: `${number} is already provisioned in CallingAgent.` });
    return;
  }

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
    aiVoice: data.aiVoice ?? null,
    aiVoiceEngine: data.aiVoiceEngine ?? null,
    aiElevenLabsVoiceId: data.aiElevenLabsVoiceId ?? null,
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
  if (body.aiVoiceEngine !== undefined) updateData.aiVoiceEngine = body.aiVoiceEngine ?? null;
  if (body.aiElevenLabsVoiceId !== undefined) updateData.aiElevenLabsVoiceId = body.aiElevenLabsVoiceId ?? null;
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
