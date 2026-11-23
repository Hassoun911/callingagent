import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { aiOfferForPlan, AI_CREDITS_LAUNCH_READY, readAiCreditBalance } from "../lib/ai-credit-wallet";

const router: IRouter = Router();

// Company users may only see their own wallet. The wallet is read-only while
// AI metering, provider cost attribution and Stripe top-ups are uncertified.
router.get("/ai-credits/status", async (req, res): Promise<void> => {
  if (!req.user || (req.user.role !== "company_admin" && req.user.role !== "super_admin")) {
    res.status(403).json({ error:"Company administrator access required" }); return;
  }
  const requested=Number(req.query.companyId || req.user.companyId);
  if (!Number.isSafeInteger(requested) || requested <= 0 ||
      (req.user.role !== "super_admin" && req.user.companyId !== requested)) {
    res.status(403).json({ error:"Company not accessible" }); return;
  }
  try {
    const [subscription, wallet] = await Promise.all([
      pool.query<{ plan_slug:string; status:string; last_payment_status:string }>(
        "SELECT plan_slug,status,last_payment_status FROM ca_stripe_subscriptions WHERE company_id=$1",[requested],
      ),
      readAiCreditBalance(requested),
    ]);
    const paid=subscription.rows[0]?.status==="active" &&
      subscription.rows[0]?.last_payment_status==="paid";
    const offer=aiOfferForPlan(subscription.rows[0]?.plan_slug || null);
    res.set("Cache-Control","no-store");
    res.json({
      companyId:requested,offer,
      aiAccessAvailable: AI_CREDITS_LAUNCH_READY && paid && offer==="phone_pro",
      creditsBalanceCents:wallet,
      creditTopUpsAvailable:false,
      includedCreditCents:null,
      currency:"CAD",
      note:"AI credits and entitlement enforcement are not certified for public usage or purchases.",
    });
  } catch(err:any) {
    req.log.error({ error:err?.message },"AI wallet status unavailable");
    res.status(503).json({ error:"AI wallet status unavailable" });
  }
});

export default router;
