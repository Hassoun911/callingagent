import { Router, type IRouter } from "express";

const router: IRouter = Router();

const TWILIO_LABELS: Record<string, { label: string; unit: string }> = {
  "calls":                    { label: "All Voice Calls",       unit: "minutes" },
  "calls-inbound":            { label: "Inbound Calls",         unit: "minutes" },
  "calls-outbound":           { label: "Outbound Calls",        unit: "minutes" },
  "calls-client":             { label: "Client Calls",          unit: "minutes" },
  "phonenumbers":             { label: "Phone Numbers",         unit: "numbers"  },
  "phonenumbers-local":       { label: "Local Numbers",         unit: "numbers"  },
  "phonenumbers-tollfree":    { label: "Toll-Free Numbers",     unit: "numbers"  },
  "recordings":               { label: "Recordings",            unit: "minutes" },
  "recordingstorage":         { label: "Recording Storage",     unit: "minutes" },
  "transcriptions":           { label: "Transcriptions",        unit: "transcriptions" },
  "sms":                      { label: "SMS (Total)",           unit: "messages" },
  "sms-inbound":              { label: "Inbound SMS",           unit: "messages" },
  "sms-outbound":             { label: "Outbound SMS",          unit: "messages" },
  "tts":                      { label: "Text-to-Speech",        unit: "characters" },
  "voice-insights":           { label: "Voice Insights",        unit: "calls"   },
};

router.get("/costs", async (req, res): Promise<void> => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // ── Twilio Usage Records (ThisMonth) ──────────────────────────────────────
  let twilio: any = null;
  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const r = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Usage/Records/ThisMonth.json?PageSize=200`,
      { headers: { Authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (r.ok) {
      const body = await r.json() as any;
      const records: any[] = body.usage_records ?? [];
      const currency = records[0]?.price_unit ?? "USD";

      const breakdown = records
        .filter((rec: any) => parseFloat(rec.price ?? "0") > 0)
        .map((rec: any) => ({
          category:    rec.category as string,
          label:       TWILIO_LABELS[rec.category]?.label ?? rec.category,
          cost:        parseFloat(rec.price ?? "0"),
          usage:       rec.usage as string,
          usageUnit:   TWILIO_LABELS[rec.category]?.unit ?? (rec.usage_unit as string ?? ""),
          count:       rec.count as string,
        }))
        .sort((a: any, b: any) => b.cost - a.cost);

      const totalCost = breakdown.reduce((s: number, r: any) => s + r.cost, 0);
      twilio = { totalCost, currency, period, breakdown, available: true };
    } else {
      twilio = { available: false, error: `Twilio API ${r.status}` };
    }
  } catch (err: any) {
    req.log.warn({ err: err?.message }, "Failed to fetch Twilio costs");
    twilio = { available: false, error: "Could not reach Twilio API" };
  }

  // ── OpenAI Organization Costs API ─────────────────────────────────────────
  let openai: any = null;
  // Admin key is required for the org costs API. Regular project keys return 403.
  const openaiKey = process.env.OPENAI_ADMIN_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
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

        openai = {
          totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
          currency: "USD",
          period,
          breakdown,
          available: true,
        };
      } else {
        const status = r.status;
        openai = {
          available: false,
          error: status === 401 || status === 403
            ? "Admin API key required — visit platform.openai.com/settings/organization/billing for totals"
            : `OpenAI API returned ${status}`,
        };
      }
    } catch (err: any) {
      req.log.warn({ err: err?.message }, "Failed to fetch OpenAI costs");
      openai = { available: false, error: "Could not reach OpenAI API" };
    }
  } else {
    openai = { available: false, error: "No OpenAI API key configured" };
  }

  res.json({ twilio, openai, period });
});

export default router;
