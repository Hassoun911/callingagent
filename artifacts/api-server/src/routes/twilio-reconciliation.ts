import { Router, type IRouter } from "express";
import { reconcileTwilioBatch } from "../lib/twilio-reconciliation-worker";
import { ensureTwilioReconciliationTables, readTwilioCheckpoint, type TwilioResource } from "../lib/twilio-reconciliation-store";

const router: IRouter = Router();
const active = new Set<string>();
// Manual, super-admin-only batch endpoint. Never exposed to company admins.
// A production scheduler can invoke this safely after integration tests.
router.post("/billing/reconciliation/twilio/run", async (req, res): Promise<void> => {
  if (!req.isAuthenticated?.() || req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Super administrator required" }); return;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    res.status(503).json({ error: "Twilio credentials unavailable" }); return;
  }
  const month = req.body?.month;
  const resource = req.body?.resource as TwilioResource;
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      (resource !== "Calls" && resource !== "Messages")) {
    res.status(400).json({ error: "Valid month and Calls or Messages resource required" }); return;
  }
  const key = accountSid + ":" + month + ":" + resource;
  if (active.has(key)) { res.status(409).json({ error: "Reconciliation batch already running" }); return; }
  active.add(key);
  try {
    const outcome = await reconcileTwilioBatch({ accountSid, authToken, month, resource, maxPages: 2 });
    res.set("Cache-Control", "no-store");
    res.json({ month, resource, ...outcome, invoiceVerified: false });
  } catch (e: any) {
    req.log.error({ message: e?.message, month, resource }, "Twilio reconciliation batch failed");
    res.status(503).json({ error: "Twilio reconciliation batch failed; progress retained" });
  } finally { active.delete(key); }
});
router.get("/billing/reconciliation/twilio/status", async (req, res): Promise<void> => {
  if (!req.isAuthenticated?.() || req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Super administrator required" }); return;
  }
  const month = req.query.month;
  const resource = req.query.resource;
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      (resource !== "Calls" && resource !== "Messages")) {
    res.status(400).json({ error: "Invalid month or resource" }); return;
  }
  if (!process.env.TWILIO_ACCOUNT_SID) { res.status(503).json({ error: "Twilio unavailable" }); return; }
  try {
    await ensureTwilioReconciliationTables();
    const checkpoint = await readTwilioCheckpoint(process.env.TWILIO_ACCOUNT_SID, month, resource);
    res.set("Cache-Control", "no-store");
    res.json({ month, resource, status: checkpoint?.status ?? "not_started",
      pages: checkpoint?.page_count ?? 0, updatedAt: checkpoint?.updated_at ?? null,
      complete: checkpoint?.status === "complete", invoiceVerified: false });
  } catch (e: any) {
    req.log.error({ message: e?.message }, "Twilio reconciliation status unavailable");
    res.status(503).json({ error: "Reconciliation status unavailable" });
  }
});
export default router;
