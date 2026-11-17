import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

/** Read-only company billing overview. Subscription fees are NOT provider expenses. */
const router: IRouter = Router();
router.get("/billing/company-overview", async (req, res): Promise<void> => {
  if (!req.user || !["super_admin", "company_admin"].includes(req.user.role)) {
    res.status(403).json({ error: "Company billing access required" }); return;
  }
  const requested = req.query.companyId == null ? null : Number(req.query.companyId);
  if (requested !== null && (!Number.isSafeInteger(requested) || requested <= 0)) {
    res.status(400).json({ error: "Invalid company ID" }); return;
  }
  const ownId = Number(req.user.companyId);
  if (req.user.role === "company_admin" &&
      (!Number.isSafeInteger(ownId) || ownId <= 0 || (requested !== null && requested !== ownId))) {
    res.status(403).json({ error: "Cannot access another company's billing" }); return;
  }
  const companyId = req.user.role === "company_admin" ? ownId : requested;
  try {
    const result = await pool.query(`
      SELECT c.id AS "companyId", c.name AS "companyName",
        s.plan_slug AS "subscribedPlan", s.status AS "subscriptionStatus",
        s.current_period_end AS "currentPeriodEnd",
        s.last_payment_status AS "lastPaymentStatus",
        p.name AS "packageName", p.price_cents AS "monthlyPriceCents",
        p.monthly_minutes AS "includedMonthlyMinutes",
        p.included_numbers AS "includedNumbers",
        (SELECT count(*)::integer FROM phone_numbers n
         WHERE n.company_id=c.id AND n.is_active IS TRUE) AS "activeNumbers"
      FROM companies c
      LEFT JOIN ca_stripe_subscriptions s ON s.company_id=c.id
      LEFT JOIN ca_plans p ON p.slug=s.plan_slug
      WHERE ($1::integer IS NULL OR c.id=$1)
      ORDER BY c.name, c.id
      LIMIT 500`, [companyId]);
    res.set("Cache-Control", "private, no-store");
    res.json({
      currency: "CAD",
      period: "subscription-specific",
      companies: result.rows.map(row => ({
        ...row,
        monthlyPriceCents: row.packageName == null ? null : row.monthlyPriceCents,
        includedMonthlyMinutes: row.packageName == null ? null : row.includedMonthlyMinutes,
        includedNumbers: row.packageName == null ? null : row.includedNumbers,
        providerCostsVerified: false,
        invoiceTotalCents: null,
        usageReconciled: false,
        note: "Subscription catalog data only. No provider costs, overages or customer invoice calculated."
      }))
    });
  } catch (error: any) {
    req.log.error({ message: error?.message }, "Company billing overview unavailable");
    res.status(503).json({ error: "Company billing overview unavailable" });
  }
});
export default router;
