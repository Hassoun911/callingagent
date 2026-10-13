import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, companiesTable, phoneNumbersTable } from "@workspace/db";
import { getCompanyScope } from "../lib/scope";
import { initiateCompanyClickToCall } from "./telnyx-voice-webhooks";

const router: IRouter = Router();
function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  const number = digits.length === 10 ? "+1" + digits :
    digits.length >= 11 && digits.length <= 15 ? "+" + digits : "";
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : null;
}

router.post("/companies/:id/call-out", async (req, res): Promise<void> => {
  if (!req.isAuthenticated?.() || !req.user) { res.status(401).json({ error: "Sign in to place an outbound call" }); return; }
  const companyId = Number(req.params.id);
  const scope = getCompanyScope(req);
  if (!Number.isInteger(companyId) || companyId < 1 || (scope !== null && scope !== companyId)) {
    res.status(403).json({ error: "Company is not accessible" }); return;
  }
  const agent = normalizePhone(req.body?.agentPhone);
  const target = normalizePhone(req.body?.destination);
  const lineId = Number(req.body?.phoneNumberId);
  if (!agent || !target || !Number.isInteger(lineId)) {
    res.status(400).json({ error: "Provide a valid agent phone, destination, and company line" }); return;
  }
  if (agent === target) { res.status(400).json({ error: "Your phone and destination must be different" }); return; }
  try {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId));
    const [line] = await db.select().from(phoneNumbersTable).where(and(eq(phoneNumbersTable.id, lineId), eq(phoneNumbersTable.companyId, companyId)));
    if (!company || !line || !line.isActive || line.twilioSid) {
      res.status(400).json({ error: "Choose an active Telnyx number belonging to this company" }); return;
    }
    if (agent === line.number || target === line.number) {
      res.status(400).json({ error: "Neither dialing leg can equal the company's own number" }); return;
    }
    const id = await initiateCompanyClickToCall(companyId, agent, target, line.number, line.ringCount || 4);
    res.status(202).json({ status: "agent_call_initiated", callControlId: id, displayedCallerId: line.number,
      message: "Answer your phone and press 1; CallingAgent will then dial the destination." });
  } catch (err: any) {
    req.log.error({ companyId, error: err?.message }, "Company call-out failed");
    res.status(502).json({ error: err?.message || "Could not start outbound call" });
  }
});

export default router;
