import { Router, type IRouter } from "express";
import { db, pool, phoneNumbersTable, aiVoiceConfigTable, companiesTable } from "@workspace/db";

const router: IRouter = Router();

const TWILIO_LABELS: Record<string, { label: string; unit: string }> = {
  "calls":                    { label: "All Voice Calls",       unit: "minutes" },
  "calls-inbound":            { label: "Inbound Calls",         unit: "minutes" },
  "calls-outbound":           { label: "Outbound Calls",        unit: "minutes" },
  "calls-client":             { label: "Client Calls",          unit: "minutes" },
  "phonenumbers":             { label: "Phone Numbers",         unit: "numbers"  },
  "phonenumbers-local":       { label: "Local Numbers",         unit: "numbers"  },
  "phonenumbers-tollfree":    { label: "Toll-Free Numbers",     unit: "numbers"  },
  "phonenumbers-mobile":      { label: "Mobile Numbers",        unit: "numbers"  },
  "phonenumbers-national":    { label: "National Numbers",      unit: "numbers"  },
  "phonenumbers-emergency":   { label: "Emergency Calling",     unit: "numbers"  },
  "recordings":               { label: "Recordings",            unit: "minutes" },
  "recordingstorage":         { label: "Recording Storage",     unit: "minutes" },
  "transcriptions":           { label: "Transcriptions",        unit: "transcriptions" },
  "sms":                      { label: "SMS (Total)",           unit: "messages" },
  "sms-inbound":              { label: "Inbound SMS",           unit: "messages" },
  "sms-outbound":             { label: "Outbound SMS",          unit: "messages" },
  "tts":                      { label: "Text-to-Speech",        unit: "characters" },
  "voice-insights":           { label: "Voice Insights",        unit: "calls"   },
};

// Categories billed as flat monthly fees (not per-use)
const TWILIO_FIXED: Set<string> = new Set([
  "phonenumbers",
  "phonenumbers-local",
  "phonenumbers-tollfree",
  "phonenumbers-mobile",
  "phonenumbers-national",
  "phonenumbers-emergency",
]);

async function fetchTwilioUsage(accountSid: string, auth: string, phoneNumber?: string) {
  const url = new URL(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records/ThisMonth.json`
  );
  url.searchParams.set("PageSize", "200");
  if (phoneNumber) url.searchParams.set("PhoneNumber", phoneNumber);

  const r = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) return null;
  const body = await r.json() as any;
  return (body.usage_records ?? []) as any[];
}

// Read-only provider inventory verification. A missing Twilio SID in our database
// does not identify a number's carrier. Only exact provider inventory matches do.
function normalizeE164(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 10 ? "+1" + digits : "+" + digits;
}
async function getTwilioInventory(accountSid: string, auth: string): Promise<Set<string> | null> {
  const found = new Set<string>();
  let next: string | null = "https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(accountSid) + "/IncomingPhoneNumbers.json?PageSize=1000";
  try {
    for (let page = 0; next && page < 20; page++) {
      const target = new URL(next, "https://api.twilio.com");
      if (target.hostname !== "api.twilio.com" || target.protocol !== "https:") throw new Error("Unexpected Twilio pagination URL");
      const response = await fetch(target.toString(), { headers: { Authorization: "Basic " + auth }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const data: any = await response.json();
      for (const item of data.incoming_phone_numbers ?? []) if (item.phone_number) found.add(normalizeE164(item.phone_number));
      next = data.next_page_uri ? new URL(data.next_page_uri, "https://api.twilio.com").toString() : null;
    }
    // Fail closed rather than claim exhaustive coverage after reaching the page cap.
    if (next) return null;
    return found;
  } catch { return null; }
}
async function getTelnyxInventory(apiKey: string): Promise<Set<string> | null> {
  const found = new Set<string>();
  try {
    for (let page = 1; page <= 20; page++) {
      const target = new URL("https://api.telnyx.com/v2/phone_numbers");
      target.searchParams.set("page[number]", String(page));
      target.searchParams.set("page[size]", "100");
      const response = await fetch(target, { headers: { Authorization: "Bearer " + apiKey }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) return null;
      const data: any = await response.json();
      const items: any[] = data.data ?? [];
      for (const item of items) if (item.phone_number) found.add(normalizeE164(item.phone_number));
      const totalPages = Number(data.meta?.total_pages ?? 0);
      if ((totalPages && page >= totalPages) || (!totalPages && items.length < 100)) return found;
    }
    return null;
  } catch { return null; }
}

// Twilio's itemized Calls and Messages endpoints expose actual provider price
// fields. These are partial usage evidence, not a complete invoice: they exclude
// monthly number rental and any charges not represented by these records.
async function fetchTwilioItemized(
  accountSid: string, auth: string, resource: "Calls" | "Messages",
  monthStart: string, nextMonth: string
): Promise<{ rows: any[]; complete: boolean; error?: string }> {
  const rows: any[] = [];
  let next: string | null = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/${resource}.json?PageSize=1000`;
  const dateField = resource === "Calls" ? "StartTime" : "DateSent";
  const initial = new URL(next);
  initial.searchParams.set(dateField + ">=", monthStart);
  const lastDay = new Date(Date.parse(nextMonth + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  initial.searchParams.set(dateField + "<=", lastDay);
  next = initial.toString();
  try {
    for (let page = 0; next && page < 20; page++) {
      const url = new URL(next);
      if (url.hostname !== "api.twilio.com" || url.protocol !== "https:") return { rows, complete: false, error: "Invalid pagination URL" };
      const response = await fetch(url, { headers: { Authorization: "Basic " + auth }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) return { rows, complete: false, error: "Provider returned " + response.status };
      const body: any = await response.json();
      rows.push(...(resource === "Calls" ? body.calls ?? [] : body.messages ?? []));
      next = body.next_page_uri ? new URL(body.next_page_uri, "https://api.twilio.com").toString() : null;
    }
    return { rows, complete: !next, error: next ? "Pagination limit reached" : undefined };
  } catch { return { rows, complete: false, error: "Provider request failed" }; }
}

let twilioItemizedCache: { key: string; at: number; data: any } | null = null;
async function buildTwilioAttribution(
  accountSid: string, auth: string,
  inventory: Set<string> | null,
  savedLines: Array<{ number: string; companyId: number | null }>
) {
  if (!inventory) return { available: false, reason: "Twilio inventory unavailable" };
  const now = new Date();
  const cacheKey = accountSid + ":" + now.getUTCFullYear() + "-" + now.getUTCMonth();
  if (twilioItemizedCache?.key === cacheKey && Date.now() - twilioItemizedCache.at < 5 * 60 * 1000) return twilioItemizedCache.data;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthStart = start.toISOString().slice(0, 10);
  const nextMonth = end.toISOString().slice(0, 10);
  const [calls, messages] = await Promise.all([
    fetchTwilioItemized(accountSid, auth, "Calls", monthStart, nextMonth),
    fetchTwilioItemized(accountSid, auth, "Messages", monthStart, nextMonth),
  ]);
  const numberOwners = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const line of savedLines) {
    const number = normalizeE164(line.number);
    if (!inventory.has(number) || line.companyId == null) continue;
    if (numberOwners.has(number) && numberOwners.get(number) !== line.companyId) ambiguous.add(number);
    else numberOwners.set(number, line.companyId);
  }
  for (const number of ambiguous) numberOwners.delete(number);
  const companyCosts = new Map<number, { calls: number; messages: number; callRecords: number; messageRecords: number }>();
  let unattributedRecords = 0;
  let unpricedRecords = 0;
  let conflictingRecords = 0;
  let currency: string | null = null;
  let outOfPeriodRecords = 0;
  let missingTimestampRecords = 0;
  const seen = new Set<string>();
  const accumulate = (record: any, type: "calls" | "messages") => {
    const recordDate = type === "calls" ? record.start_time : (record.date_sent ?? record.date_created);
    const timestamp = recordDate ? Date.parse(String(recordDate)) : NaN;
    if (!Number.isFinite(timestamp)) { missingTimestampRecords++; return; }
    if (timestamp < start.getTime() || timestamp >= end.getTime()) { outOfPeriodRecords++; return; }
    const sid = String(record.sid ?? "");
    if (sid) {
      const unique = type + ":" + sid;
      if (seen.has(unique)) return;
      seen.add(unique);
    }
    const from = normalizeE164(String(record.from ?? ""));
    const to = normalizeE164(String(record.to ?? ""));
    const a = numberOwners.get(from);
    const b = numberOwners.get(to);
    if (a != null && b != null && a !== b) { conflictingRecords++; return; }
    const companyId = a ?? b;
    if (companyId == null) { unattributedRecords++; return; }
    const price = record.price;
    const unit = String(record.price_unit ?? "").toUpperCase();
    if (price == null || !Number.isFinite(Number(price)) || !unit) { unpricedRecords++; return; }
    if (currency && currency !== unit) { conflictingRecords++; return; }
    currency = unit;
    const entry = companyCosts.get(companyId) ?? { calls: 0, messages: 0, callRecords: 0, messageRecords: 0 };
    // Twilio itemized prices are commonly negative for debits; cost is magnitude.
    entry[type] += Math.abs(Number(price));
    if (type === "calls") entry.callRecords++;
    else entry.messageRecords++;
    companyCosts.set(companyId, entry);
  };
  for (const call of calls.rows) accumulate(call, "calls");
  for (const message of messages.rows) accumulate(message, "messages");
  const result = {
    available: true,
    period: monthStart.slice(0, 7),
    currency,
    complete: calls.complete && messages.complete,
    invoiceReconciled: false,
    excluded: "Phone number rentals, taxes, other provider fees, and unmatched/unpriced records",
    callRecords: calls.rows.length,
    messageRecords: messages.rows.length,
    unattributedRecords, unpricedRecords, conflictingRecords, outOfPeriodRecords, missingTimestampRecords,
    errors: [calls.error, messages.error].filter(Boolean),
    // Fail closed: never display partial monetary attribution when the provider
    // returned incomplete pages or ignored date filters.
    companies: (calls.complete && messages.complete && outOfPeriodRecords === 0)
      ? Array.from(companyCosts.entries()).map(([companyId, cost]) => ({
      companyId, ...cost, knownUsageCost: Math.round((cost.calls + cost.messages) * 1e6) / 1e6,
      status: "partial_itemized_usage_not_invoice",
    })) : [],
    attributionSuppressed: !(calls.complete && messages.complete && outOfPeriodRecords === 0),
  };
  if (result.complete) twilioItemizedCache = { key: cacheKey, at: Date.now(), data: result };
  return result;
}

// Cache successful organization billing reads across dashboard refreshes.
// Do not cache authentication failures. This reduces duplicate calls and
// preserves the last verified amount when the provider temporarily throttles.
let openaiCostsCache: { key: string; value: any; fetchedAt: number } | null = null;
const OPENAI_COSTS_CACHE_MS = 15 * 60 * 1000;

router.patch("/costs/openai-credit", async (req, res): Promise<void> => {
  const { balance } = req.body;
  if (typeof balance !== "number" || isNaN(balance) || balance < 0) {
    res.status(400).json({ error: "balance must be a non-negative number" });
    return;
  }
  const [existing] = await db.select().from(aiVoiceConfigTable);
  if (!existing) {
    const [created] = await db.insert(aiVoiceConfigTable).values({ openaiCreditBalance: balance, openaiCreditUpdatedAt: new Date() }).returning();
    res.json({ openaiCreditBalance: created.openaiCreditBalance, openaiCreditUpdatedAt: created.openaiCreditUpdatedAt });
    return;
  }
  const { eq } = await import("drizzle-orm");
  const [updated] = await db.update(aiVoiceConfigTable)
    .set({ openaiCreditBalance: balance, openaiCreditUpdatedAt: new Date() })
    .where(eq(aiVoiceConfigTable.id, existing.id))
    .returning();
  res.json({ openaiCreditBalance: updated.openaiCreditBalance, openaiCreditUpdatedAt: updated.openaiCreditUpdatedAt });
});

router.get("/costs", async (req, res): Promise<void> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [aiConfig] = await db.select().from(aiVoiceConfigTable);

  // ── Twilio Usage Records ───────────────────────────────────────────────────
  let twilio: any = null;
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    // Fetch provisioned numbers + companies from DB in parallel with overall usage
    const [overallRecords, numbers, companies] = await Promise.all([
      fetchTwilioUsage(accountSid!, auth),
      db.select().from(phoneNumbersTable),
      db.select().from(companiesTable),
    ]);
    const companyMap = new Map(companies.map(c => [c.id, c.name]));

    if (overallRecords) {
      const currency = overallRecords[0]?.price_unit ?? "USD";

      const breakdown = overallRecords
        .filter((rec: any) => parseFloat(rec.price ?? "0") > 0)
        .map((rec: any) => ({
          category:  rec.category as string,
          label:     TWILIO_LABELS[rec.category]?.label ?? rec.category,
          cost:      parseFloat(rec.price ?? "0"),
          usage:     rec.usage as string,
          usageUnit: TWILIO_LABELS[rec.category]?.unit ?? (rec.usage_unit as string ?? ""),
          count:     rec.count as string,
          isFixed:   TWILIO_FIXED.has(rec.category as string),
        }))
        .sort((a: any, b: any) => b.cost - a.cost);

      const totalCost = breakdown.reduce((s: number, r: any) => s + r.cost, 0);

      // Twilio Usage/Records/ThisMonth is an account-level summary. Its
      // PhoneNumber query parameter does NOT provide reliable per-number billing.
      // Never repeat the account total for each line/company.
      // Per-line costs require independently attributed provider call/message
      // records and verified phone-number rental fees.
      const perNumber = numbers.map(num => ({
        phoneNumber: num.number,
        friendlyName: num.friendlyName,
        companyId: num.companyId ?? null,
        companyName: num.companyId ? (companyMap.get(num.companyId) ?? null) : null,
        cost: null,
        breakdown: [],
        costStatus: "unattributed",
        costNote: "Account-level Twilio usage cannot be assigned to this number without verified itemized records.",
      }));

      twilio = { totalCost, currency, period, breakdown, perNumber, available: true, attributionStatus: "account_only", attributionNote: "Per-number and per-company costs are not verified and must not be summed or presented as billed amounts." };
    } else {
      twilio = { available: false, error: "Twilio API error" };
    }
  } catch (err: any) {
    req.log.warn({ err: err?.message }, "Failed to fetch Twilio costs");
    twilio = { available: false, error: "Could not reach Twilio API" };
  }

  // ── OpenAI Organization Costs API ─────────────────────────────────────────
  let openai: any = null;
  const openaiKey = process.env.OPENAI_API_KEY_ADMIN ?? process.env.OPENAI_ADMIN_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const cacheKey = period + ":" + openaiKey.slice(-12);
      if (openaiCostsCache?.key === cacheKey && Date.now() - openaiCostsCache.fetchedAt < OPENAI_COSTS_CACHE_MS) {
        openai = { ...openaiCostsCache.value, cached: true, lastVerifiedAt: new Date(openaiCostsCache.fetchedAt).toISOString() };
      } else {
      const startTime = Math.floor(new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000);
      const endTime   = Math.floor(now.getTime() / 1000);

      const r = await fetch(
        `https://api.openai.com/v1/organization/costs?start_time=${startTime}&end_time=${endTime}&limit=180`,
        {
          headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (r.ok) {
        const body = await r.json() as any;
        const buckets: any[] = body.data ?? [];
        let totalCost = 0;
        const modelMap: Record<string, number> = {};

        for (const bucket of buckets) {
          for (const result of (bucket.results ?? [])) {
            const cost = result.amount?.value ?? 0;
            totalCost += cost;
            const model = result.snapshot_id ?? "unknown";
            modelMap[model] = (modelMap[model] ?? 0) + cost;
          }
        }

        const breakdown = Object.entries(modelMap)
          .map(([model, cost]) => ({ model, cost }))
          .sort((a, b) => b.cost - a.cost);

        const viaProxy = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL);
        openai = {
          totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
          currency: "USD",
          period,
          breakdown,
          available: true,
          viaProxy,
        };
        openaiCostsCache = { key: cacheKey, value: openai, fetchedAt: Date.now() };
      } else {
        const status = r.status;
        const stale = status === 429 && openaiCostsCache?.key === cacheKey ? openaiCostsCache : null;
        openai = stale
          ? { ...stale.value, cached: true, stale: true, lastVerifiedAt: new Date(stale.fetchedAt).toISOString(),
              warning: "OpenAI billing temporarily rate-limited (429). Showing last verified result." }
          : { available: false, error: status === 429
              ? "OpenAI billing rate-limited (429). Try again later."
              : status === 401 || status === 403
                ? "Admin API key required — visit platform.openai.com/settings/organization/billing for totals"
                : `OpenAI API returned ${status}` };
      }
      }
    } catch (err: any) {
      req.log.warn({ err: err?.message }, "Failed to fetch OpenAI costs");
      openai = { available: false, error: "Could not reach OpenAI API" };
    }
  } else {
    openai = { available: false, error: "No OpenAI API key configured" };
  }

  // Telnyx has a separate carrier ledger. Do not fabricate charges from public
  // rate cards, or classify Telnyx inventory searches as purchased numbers.
  // Only confirmed Twilio SID-backed lines can be attributed to Twilio.
  const savedLines = await db.select().from(phoneNumbersTable);
  const [twilioInventory, telnyxInventory] = await Promise.all([
    accountSid && authToken ? getTwilioInventory(accountSid, Buffer.from(accountSid + ":" + authToken).toString("base64")) : Promise.resolve(null),
    process.env.TELNYX_API_KEY ? getTelnyxInventory(process.env.TELNYX_API_KEY) : Promise.resolve(null),
  ]);
  const inventoryStatus = savedLines.map(n => {
    const number = normalizeE164(n.number);
    const inTwilio = twilioInventory?.has(number) ?? false;
    const inTelnyx = telnyxInventory?.has(number) ?? false;
    const provider = inTwilio && inTelnyx ? "conflict" : inTwilio ? "twilio" : inTelnyx ? "telnyx" : "unverified";
    return { phoneNumber: n.number, friendlyName: n.friendlyName, companyId: n.companyId,
      provider, verified: provider === "twilio" || provider === "telnyx",
      cost: null, breakdown: [], status: provider === "conflict" ? "Matched multiple provider inventories — manual review required"
        : provider === "unverified" ? "Provider not verified in available inventories"
        : "Provider verified; monetary charges not yet attributed" };
  });
  const telnyxLines = inventoryStatus.filter(n => !n.verified || n.provider === "conflict");
  // Signed provider call.cost webhooks provide billed seconds, not a verified
  // monthly monetary invoice. Keep these distinct so account totals are never
  // represented as paid/settled charges or as an enforceable minute balance.
  let telnyxCallCostEvidence: {
    signedLegEvents:number; attributedLegEvents:number; billedSeconds:number;
    missingDurationEvents:number; latestReceivedAt:string|null;
    verifiedMoneyTotal:false; billingStatus:string;
  } | null = null;
  try {
    const events=await pool.query(`
      SELECT COUNT(*)::integer AS signed_leg_events,
        COUNT(*) FILTER (WHERE company_id IS NOT NULL)::integer AS attributed_leg_events,
        COALESCE(SUM(billed_duration_secs),0)::bigint AS billed_seconds,
        COUNT(*) FILTER (WHERE billed_duration_secs IS NULL)::integer AS missing_duration_events,
        MAX(received_at) AS latest_received_at
      FROM ca_telnyx_cost_legs
      WHERE occurred_at >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    `);
    const row=events.rows[0];
    telnyxCallCostEvidence={
      signedLegEvents:Number(row.signed_leg_events),
      attributedLegEvents:Number(row.attributed_leg_events),
      billedSeconds:Number(row.billed_seconds),
      missingDurationEvents:Number(row.missing_duration_events),
      latestReceivedAt:row.latest_received_at?new Date(row.latest_received_at).toISOString():null,
      verifiedMoneyTotal:false,
      billingStatus:"Signed carrier leg evidence only; no verified monthly money total."
    };
  }catch(error:any){
    req.log.warn({message:error?.message},"Telnyx call-cost evidence read failed");
  }
  const telnyx = {
    callCostEvidence:telnyxCallCostEvidence,
    available: Boolean(process.env.TELNYX_API_KEY),
    totalCost: null,
    currency: "USD",
    amountStatus: "unverified",
    error: process.env.TELNYX_API_KEY
      ? "Live Telnyx billing totals are not connected. See Telnyx Portal → Reporting → Monthly Charges."
      : "Telnyx API key is not configured.",
    inventoryVerification: {
      twilioInventoryAvailable: twilioInventory !== null,
      telnyxInventoryAvailable: telnyxInventory !== null,
      verifiedTwilio: inventoryStatus.filter(n => n.provider === "twilio").length,
      verifiedTelnyx: inventoryStatus.filter(n => n.provider === "telnyx").length,
      conflicts: inventoryStatus.filter(n => n.provider === "conflict").length,
      unverified: inventoryStatus.filter(n => n.provider === "unverified").length,
    },
    perNumber: telnyxLines
  };
  // Itemized evidence is reported separately from the invoice total.
  // Do not substitute it for a verified company invoice or margin calculation.
  let twilioItemized: any = { available: false, reason: "Twilio credentials not configured" };
  if (accountSid && authToken) {
    try {
      twilioItemized = await buildTwilioAttribution(
        accountSid, Buffer.from(accountSid + ":" + authToken).toString("base64"),
        twilioInventory, savedLines.map(n => ({ number: n.number, companyId: n.companyId }))
      );
    } catch (error: any) {
      req.log.warn({ message: error?.message }, "Twilio itemized attribution failed");
      twilioItemized = { available: false, reason: "Itemized provider data unavailable" };
    }
  }
  const providerTotals = {
    twilio: twilio?.available ? { totalCost: twilio.totalCost, currency: twilio.currency, verified: true } : null,
    telnyx: { totalCost: null, currency: "USD", verified: false },
    combined: null,
    note: "Combined total unavailable until both providers' actual billing is verified; currencies are not mixed."
  };

  res.json({
    telnyx,
    twilioItemized,
    providerTotals,
    twilio,
    openai,
    period,
    openaiCreditBalance: aiConfig?.openaiCreditBalance ?? null,
    openaiCreditUpdatedAt: aiConfig?.openaiCreditUpdatedAt ?? null,
  });
});

export default router;
