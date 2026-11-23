import { Router, type IRouter } from "express";
import { getTelnyxCpsRecentHours } from "../lib/telnyx-cps-guard";

const router: IRouter = Router();

// Admin-only operational metric. The counters represent application attempts,
// not Telnyx's accepted outbound attempts, the monthly 95th percentile, or bills.
router.get("/billing/usage/telnyx-cps", async (req, res): Promise<void> => {
  if (!req.isAuthenticated?.() || req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Super administrator required" });
    return;
  }
  const raw = req.query.hours;
  if (raw !== undefined && (typeof raw !== "string" || !/^\d{1,3}$/.test(raw))) {
    res.status(400).json({ error: "hours must be an integer from 1 to 720" });
    return;
  }
  const hours = raw === undefined ? 24 : Number(raw);
  if (hours < 1 || hours > 720) {
    res.status(400).json({ error: "hours must be an integer from 1 to 720" });
    return;
  }
  try {
    const data = await getTelnyxCpsRecentHours(hours);
    res.set("Cache-Control", "no-store");
    res.json({ ...data, billingVerified: false });
  } catch (error: any) {
    req.log.error({ error: error?.message }, "Telnyx CPS metrics unavailable");
    res.status(503).json({ error: "Telnyx CPS metrics unavailable" });
  }
});

export default router;
