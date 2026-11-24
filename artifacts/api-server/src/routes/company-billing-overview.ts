import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

/** Read-only company billing overview. Subscription fees are NOT provider expenses. */
const router: IRouter = Router();
async function ensureOnboardingTable() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_company_billing_onboarding (
    company_id integer PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
    proposed_plan_slug text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by integer
  )`);
}
// This is an internal, non-billable plan selection. Stripe remains the only
// source of truth for active paid subscriptions.
router.put("/billing/company-onboarding/:companyId", async (req, res): Promise<void> => {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Platform administrator required" }); return;
  }
  const companyId = Number(req.params.companyId);
  const plan = req.body?.planSlug;
  if (!Number.isSafeInteger(companyId) || companyId <= 0 ||
      (plan !== null && (typeof plan !== "string" || !/^[a-z0-9-]{2,40}$/.test(plan)))) {
    res.status(400).json({ error: "Invalid company or plan" }); return;
  }
  try {
    await ensureOnboardingTable();
    const company = await pool.query("SELECT id FROM companies WHERE id=$1", [companyId]);
    if (!company.rowCount) { res.status(404).json({ error: "Company not found" }); return; }
    const active = await pool.query(
      "SELECT 1 FROM ca_stripe_subscriptions WHERE company_id=$1 AND status NOT IN ('canceled','incomplete_expired')",
      [companyId]);
    if (active.rowCount) { res.status(409).json({ error: "Company has a Stripe subscription; manage it through Stripe billing" }); return; }
    if (plan === null) {
      await pool.query("DELETE FROM ca_company_billing_onboarding WHERE company_id=$1", [companyId]);
      res.json({ companyId, proposedPlan: null, billingEnabled: false }); return;
    }
    const found = await pool.query(
      "SELECT slug FROM ca_plans WHERE slug=$1 AND is_enabled=true", [plan]);
    if (!found.rowCount) { res.status(400).json({ error: "Plan is not available" }); return; }
    await pool.query(`INSERT INTO ca_company_billing_onboarding(company_id,proposed_plan_slug)
      VALUES($1,$2) ON CONFLICT(company_id) DO UPDATE SET
      proposed_plan_slug=excluded.proposed_plan_slug,updated_at=now()`, [companyId,plan]);
    res.set("Cache-Control", "no-store");
    res.json({ companyId, proposedPlan: plan, billingEnabled: false, paymentTaken: false });
  } catch (err: any) {
    req.log.error({ message: err?.message }, "Company billing onboarding failed");
    res.status(503).json({ error: "Company billing onboarding unavailable" });
  }
});

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
    await ensureOnboardingTable();
    const result = await pool.query(`
      SELECT c.id AS "companyId", c.name AS "companyName",
        s.plan_slug AS "subscribedPlan", s.status AS "subscriptionStatus",
        s.current_period_end AS "currentPeriodEnd",
        s.last_payment_status AS "lastPaymentStatus",
        onboarding.proposed_plan_slug AS "proposedPlan",
        draft_plan.name AS "proposedPlanName",
        p.name AS "packageName", p.price_cents AS "monthlyPriceCents",
        p.monthly_minutes AS "includedMonthlyMinutes",
        p.included_numbers AS "includedNumbers",
        (SELECT count(*)::integer FROM phone_numbers n
         WHERE n.company_id=c.id AND n.is_active IS TRUE) AS "activeNumbers"
      FROM companies c
      LEFT JOIN ca_stripe_subscriptions s ON s.company_id=c.id
      LEFT JOIN ca_plans p ON p.slug=s.plan_slug
      LEFT JOIN ca_company_billing_onboarding onboarding ON onboarding.company_id=c.id
      LEFT JOIN ca_plans draft_plan ON draft_plan.slug=onboarding.proposed_plan_slug
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
/**
 * Pure read-only product map for the dual-service dashboard.
 * Important: a legacy number or AI answer mode is NOT evidence of a
 * purchased Stripe subscription. Existing line routing is never mutated.
 */
router.get("/billing/service-status", async (req, res): Promise<void> => {
  if (!req.user || !["super_admin","company_admin"].includes(req.user.role)) {
    res.status(403).json({error:"Company service access required"});return;
  }
  const requested=req.query.companyId==null?null:Number(req.query.companyId);
  if(requested!==null&&(!Number.isSafeInteger(requested)||requested<=0)){
    res.status(400).json({error:"Invalid company ID"});return;
  }
  const ownId=Number(req.user.companyId);
  if(req.user.role==="company_admin"&&(!Number.isSafeInteger(ownId)||ownId<=0||
    (requested!==null&&requested!==ownId))){
    res.status(403).json({error:"Cannot access another company's services"});return;
  }
  const companyId=req.user.role==="company_admin"?ownId:requested;
  try {
    const records=await pool.query(`
      SELECT c.id AS "companyId",c.name AS "companyName",
        COALESCE(n.assigned,0)::integer AS "assignedNumbers",
        COALESCE(n.active,0)::integer AS "activeNumbers",
        COALESCE(n.ai_configured,0)::integer AS "aiConfiguredNumbers",
        s.plan_slug AS "phonePlan",s.status AS "phoneSubscriptionStatus",
        s.last_payment_status AS "phonePaymentStatus"
      FROM companies c
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS assigned,
          count(*) FILTER (WHERE is_active IS TRUE)::integer AS active,
          count(*) FILTER (WHERE is_active IS TRUE AND answer_mode='ai_voice')::integer AS ai_configured
        FROM phone_numbers WHERE company_id=c.id
      ) n ON TRUE
      LEFT JOIN LATERAL (
        SELECT plan_slug,status,last_payment_status
        FROM ca_stripe_subscriptions
        WHERE company_id=c.id
        ORDER BY updated_at DESC, stripe_subscription_id DESC LIMIT 1
      ) s ON TRUE
      WHERE ($1::integer IS NULL OR c.id=$1)
      ORDER BY c.name,c.id LIMIT 500
    `,[companyId]);
    res.set("Cache-Control","private, no-store");
    res.json({readOnly:true,currency:"CAD",companies:records.rows.map(row=>{
      const verifiedPaidPhone=row.phoneSubscriptionStatus==="active"&&row.phonePaymentStatus==="paid";
      const legacyVoip=row.activeNumbers>0&&!verifiedPaidPhone;
      return {
        ...row,
        businessPhone:{
          state:verifiedPaidPhone?"paid":legacyVoip?"existing_service":row.phoneSubscriptionStatus?"subscription_review":"not_assigned",
          paid:verifiedPaidPhone,existingService:row.activeNumbers>0,
          activeNumbers:row.activeNumbers,assignedNumbers:row.assignedNumbers,
          plan:verifiedPaidPhone?row.phonePlan:null,
        },
        aiReceptionist:{
          // AI voice routing predates paid AI plans. It stays configured.
          state:row.aiConfiguredNumbers>0?"existing_configuration":"not_purchased",
          paid:false,existingConfiguration:row.aiConfiguredNumbers>0,
          configuredNumbers:row.aiConfiguredNumbers,
          purchaseVerification:"No separate paid AI subscription ledger is connected yet",
        },
        note:"Read-only service classification. Existing VoIP routing and AI answer modes are unchanged; configured AI voice does not prove a purchased AI plan.",
      };
    })});
  } catch(error:any) {
    req.log.error({message:error?.message},"Dual service overview unavailable");
    res.status(503).json({error:"Company service status temporarily unavailable"});
  }
});

export default router;
