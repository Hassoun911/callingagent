import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, aiVoiceConfigTable, companiesTable } from "@workspace/db";

const router: IRouter = Router();

function getApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
}

function getBaseUrl(): string {
  return (process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

router.post("/ai-voice/extract-booking-setup", async (req, res): Promise<void> => {
  try {
    const requestedCompanyId = Number(req.body?.companyId);
    const companyId = req.user?.role === "super_admin" ? requestedCompanyId : Number(req.user?.companyId);

    if (!companyId) {
      res.status(400).json({ error: "companyId is required" });
      return;
    }
    if (req.user?.role !== "super_admin" && Number(req.user?.companyId) !== companyId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const [config] = await db.select().from(aiVoiceConfigTable);
    const promptText = String(req.body?.systemPrompt ?? config?.systemPrompt ?? "").trim();
    if (!promptText) {
      res.status(400).json({ error: "The AI system prompt is empty" });
      return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
      res.status(503).json({ error: "OpenAI API key is not configured on Render" });
      return;
    }

    const systemInstruction = `Extract a proposed booking configuration from a business receptionist prompt. Return JSON only with this shape:
{
  "resources": [{"name":"string","resourceType":"staff|technician|barber|chair|room|table|vehicle|agent|other","description":"string","allowRandomAssignment":true}],
  "services": [{"name":"string","description":"string","durationMinutes":30,"bufferBeforeMinutes":0,"bufferAfterMinutes":0}],
  "availability": [{"resourceName":"string","dayOfWeek":0,"startTime":"09:00","endTime":"17:00"}],
  "settings": {"enabled":true,"timezone":"America/Toronto","slotIntervalMinutes":30,"minimumNoticeMinutes":60,"maximumAdvanceDays":90,"allowResourceSelection":true,"allowRandomAssignment":true,"requireApproval":false},
  "warnings": ["string"]
}
Infer only what is supported by the prompt. Do not invent named staff. If no named staff or resources exist, create one generic resource appropriate to the business. Convert stated business hours into availability. Emergency 24/7 service may use 00:00 to 23:59 and minimumNoticeMinutes 0. Use realistic durations only when missing and clearly list those estimates in warnings. Do not treat prices as separate services unless they describe an actual bookable service.`;

    const upstream = await fetch(`${getBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: `Company: ${company.name}\n\nAI receptionist instructions:\n${promptText}` },
        ],
      }),
    });

    const upstreamText = await upstream.text();
    if (!upstream.ok) {
      let detail = upstreamText;
      try {
        const parsedError = JSON.parse(upstreamText);
        detail = parsedError?.error?.message || parsedError?.message || upstreamText;
      } catch {}
      res.status(502).json({ error: `OpenAI analysis failed: ${detail}` });
      return;
    }

    const completion = JSON.parse(upstreamText);
    const raw = completion?.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);

    const resources = Array.isArray(parsed.resources)
      ? parsed.resources.slice(0, 50).map((r: any) => ({
          name: String(r.name || "").trim(),
          resourceType: String(r.resourceType || "staff").trim(),
          description: String(r.description || "").trim(),
          allowRandomAssignment: r.allowRandomAssignment !== false,
        })).filter((r: any) => r.name)
      : [];

    const services = Array.isArray(parsed.services)
      ? parsed.services.slice(0, 100).map((s: any) => ({
          name: String(s.name || "").trim(),
          description: String(s.description || "").trim(),
          durationMinutes: Math.max(5, Math.min(480, Number(s.durationMinutes) || 30)),
          bufferBeforeMinutes: Math.max(0, Math.min(120, Number(s.bufferBeforeMinutes) || 0)),
          bufferAfterMinutes: Math.max(0, Math.min(120, Number(s.bufferAfterMinutes) || 0)),
        })).filter((s: any) => s.name)
      : [];

    const availability = Array.isArray(parsed.availability)
      ? parsed.availability.slice(0, 350).map((a: any) => ({
          resourceName: String(a.resourceName || "").trim(),
          dayOfWeek: Math.max(0, Math.min(6, Number(a.dayOfWeek) || 0)),
          startTime: /^\d{2}:\d{2}$/.test(String(a.startTime)) ? String(a.startTime) : "09:00",
          endTime: /^\d{2}:\d{2}$/.test(String(a.endTime)) ? String(a.endTime) : "17:00",
        })).filter((a: any) => a.resourceName && a.endTime > a.startTime)
      : [];

    const settings = {
      enabled: parsed.settings?.enabled !== false,
      timezone: String(parsed.settings?.timezone || "America/Toronto"),
      slotIntervalMinutes: Math.max(5, Math.min(240, Number(parsed.settings?.slotIntervalMinutes) || 30)),
      minimumNoticeMinutes: Math.max(0, Number(parsed.settings?.minimumNoticeMinutes) || 0),
      maximumAdvanceDays: Math.max(1, Math.min(730, Number(parsed.settings?.maximumAdvanceDays) || 90)),
      allowResourceSelection: parsed.settings?.allowResourceSelection !== false,
      allowRandomAssignment: parsed.settings?.allowRandomAssignment !== false,
      requireApproval: parsed.settings?.requireApproval === true,
    };

    res.json({
      companyId,
      companyName: company.name,
      source: "ai_system_prompt",
      resources,
      services,
      availability,
      settings,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 20) : [],
    });
  } catch (err: any) {
    console.error("Booking setup extraction failed", err);
    res.status(500).json({ error: err?.message ?? "Could not analyze AI settings" });
  }
});

export default router;
