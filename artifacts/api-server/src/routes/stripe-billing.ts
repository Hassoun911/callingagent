import crypto from "crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();
const prices: Record<string, string> = {
  payg: "price_1UXTBYK5sDJyhAaePgEaz4K3",
  starter: "price_1UXTBaK5sDJyhAae0rWx2ULM",
  business: "price_1UXTBcK5sDJyhAaeRTIzd0tX",
  plus: "price_1UXTBdK5sDJyhAaef4tMLWJW",
  pro: "price_1UXTBfK5sDJyhAaeZIKCCcG2",
};
const expectedCents: Record<string,number> = {payg:900,starter:1900,business:3900,plus:6900,pro:11900};
const supported = new Set(["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.paid", "invoice.payment_failed"]);
const billingEnabled = () => process.env.CALLINGAGENT_STRIPE_CHECKOUT_ENABLED === "true";
const stripeKey = () => process.env.CALLINGAGENT_STRIPE_SECRET_KEY || "";
async function stripeRequest(path: string, params: URLSearchParams) {
  const key = stripeKey();
  if (!key) throw new Error("Stripe secret key not configured");
  const response = await fetch("https://api.stripe.com/v1/" + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
    signal: AbortSignal.timeout(15000),
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error("Stripe rejected request: " + String(data?.error?.type || response.status));
  return data;
}
export async function ensureStripeBillingSchema() {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_stripe_subscriptions (
    company_id integer PRIMARY KEY, stripe_customer_id text NOT NULL,
    stripe_subscription_id text UNIQUE NOT NULL, plan_slug text NOT NULL,
    status text NOT NULL, current_period_end timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_stripe_events (
    event_id text PRIMARY KEY, received_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_stripe_checkout_intents (
    session_id text PRIMARY KEY, company_id integer NOT NULL, plan_slug text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), subscription_id text
  )`);
  await pool.query(`ALTER TABLE ca_stripe_subscriptions ADD COLUMN IF NOT EXISTS last_event_created bigint NOT NULL DEFAULT 0`);
}
// Only authenticated company administrators can start their own company's checkout.
// The kill switch is deliberately OFF until provisioning and usage enforcement are certified.
router.post("/billing/checkout", async (req, res) => {
  if (!billingEnabled()) { res.status(503).json({ error: "Subscription checkout is not available yet." }); return; }
  if (req.user?.role !== "company_admin" || !Number.isInteger(req.user.companyId)) {
    res.status(403).json({ error: "Company administrator access required" }); return;
  }
  const slug = String(req.body?.plan || "");
  const priceId = prices[slug];
  if (!priceId) { res.status(400).json({ error: "Unknown package" }); return; }
  try {
    const available = await pool.query("SELECT price_cents,is_enabled,is_published,checkout_enabled FROM ca_plans WHERE slug=$1", [slug]);
    if (!available.rows[0]?.is_enabled || !available.rows[0]?.is_published || !available.rows[0]?.checkout_enabled || Number(available.rows[0]?.price_cents) !== expectedCents[slug]) { res.status(403).json({error:"Plan unavailable for checkout"}); return; }
    const existing = await pool.query("SELECT stripe_customer_id,status FROM ca_stripe_subscriptions WHERE company_id=$1", [req.user.companyId]);
    if (existing.rows[0] && !["canceled","incomplete_expired"].includes(existing.rows[0].status)) {
      res.status(409).json({error:"This company already has a subscription. Use the billing portal for changes."}); return;
    }
    const companyId = String(req.user.companyId);
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      client_reference_id: companyId,
      "metadata[company_id]": companyId,
      "metadata[plan_slug]": slug,
      "subscription_data[metadata][company_id]": companyId,
      "subscription_data[metadata][plan_slug]": slug,
      success_url: "https://callingagent.ca/?billing=return",
      cancel_url: "https://callingagent.ca/?billing=cancel",
    });
    if (existing.rows[0]?.stripe_customer_id) params.set("customer", existing.rows[0].stripe_customer_id);
    const session = await stripeRequest("checkout/sessions", params);
    if (!session?.id || !session?.url) throw new Error("Stripe checkout session has no URL");
    await pool.query("INSERT INTO ca_stripe_checkout_intents(session_id,company_id,plan_slug) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [session.id, req.user.companyId,slug]);
    res.json({ url: session.url });
  } catch (err: any) {
    req.log.error({ error: err.message }, "Stripe checkout failed");
    res.status(502).json({ error: "Checkout could not be started" });
  }
});
// Company-only subscription reporting; never rely on the public package query
// to decide whether a company has paid entitlements.
router.get("/billing/status", async (req, res) => {
  if (!req.user || !["company_admin","company_user","company_read_only"].includes(req.user.role) || !Number.isInteger(req.user.companyId)) {
    res.status(403).json({error:"Company access required"}); return;
  }
  try {
    const result = await pool.query("SELECT plan_slug,status,current_period_end,updated_at FROM ca_stripe_subscriptions WHERE company_id=$1",[req.user.companyId]);
    const row=result.rows[0] || null;
    res.set("Cache-Control","no-store");
    res.json({ subscription:row ? {
      plan:row.plan_slug,status:row.status,currentPeriodEnd:row.current_period_end,
      updatedAt:row.updated_at
    } : null,checkoutEnabled:billingEnabled() });
  } catch(err:any) {
    req.log.error({error:err.message},"Failed to retrieve company billing status");
    res.status(503).json({error:"Billing status unavailable"});
  }
});
router.post("/billing/portal", async (req, res) => {
  if (req.user?.role !== "company_admin" || !Number.isInteger(req.user.companyId)) {
    res.status(403).json({error:"Company administrator access required"}); return;
  }
  try {
    const result=await pool.query("SELECT stripe_customer_id FROM ca_stripe_subscriptions WHERE company_id=$1",[req.user.companyId]);
    if(!result.rowCount){res.status(404).json({error:"No Stripe subscription found for this company"});return;}
    const params=new URLSearchParams({customer:result.rows[0].stripe_customer_id,return_url:"https://callingagent.ca/"});
    const session=await stripeRequest("billing_portal/sessions",params);
    if(!session?.url)throw Error("Stripe portal URL unavailable");
    res.json({url:session.url});
  }catch(err:any){
    req.log.error({error:err.message},"Failed to create company billing portal session");
    res.status(502).json({error:"Billing portal unavailable"});
  }
});
function verifySignature(raw: Buffer, header: string, secret: string) {
  const chunks = Object.fromEntries(header.split(",").map(item => item.trim().split("=", 2)));
  const timestamp = Number(chunks.t);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + "." + raw.toString("utf8")).digest("hex");
  return header.split(",").some(part => {
    const value = part.trim().startsWith("v1=") ? part.trim().slice(3) : "";
    return /^[a-f0-9]{64}$/.test(value) && crypto.timingSafeEqual(Buffer.from(value, "hex"), Buffer.from(expected, "hex"));
  });
}
// Billing events update an internal status ledger only. They never provision, suspend,
// purchase or release a phone number; that requires separately certified enforcement.
function subscriptionPriceId(subscription: any): string | null {
  return subscription?.items?.data?.[0]?.price?.id || null;
}
async function applyStripeEvent(event: any): Promise<void> {
  const kind = String(event.type || "");
  const object = event?.data?.object;
  if (!object?.id) return;
  if (kind === "checkout.session.completed") {
    if (object.mode !== "subscription" || !object.subscription || !object.customer) return;
    const pending = await pool.query("SELECT company_id,plan_slug,subscription_id FROM ca_stripe_checkout_intents WHERE session_id=$1", [object.id]);
    const intent = pending.rows[0];
    if (!intent || (intent.subscription_id && intent.subscription_id !== object.subscription)) return;
    const expected = prices[String(intent.plan_slug)];
    if (!expected) return;
    // Retrieve the subscription directly from Stripe rather than trust browser redirects or client metadata.
    const key = stripeKey();
    if (!key) throw new Error("Stripe secret key unavailable for subscription verification");
    const response = await fetch("https://api.stripe.com/v1/subscriptions/" + encodeURIComponent(object.subscription) + "?expand[]=items.data.price", {
      headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error("Unable to verify subscription with Stripe");
    const sub: any = await response.json();
    if (sub.customer !== object.customer || subscriptionPriceId(sub) !== expected) throw new Error("Checkout subscription did not match selected plan");
    await pool.query(`INSERT INTO ca_stripe_subscriptions(company_id,stripe_customer_id,stripe_subscription_id,plan_slug,status,current_period_end,last_event_created)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(company_id) DO UPDATE SET
      stripe_customer_id=EXCLUDED.stripe_customer_id,
      stripe_subscription_id=EXCLUDED.stripe_subscription_id,
      plan_slug=EXCLUDED.plan_slug,status=EXCLUDED.status,current_period_end=EXCLUDED.current_period_end,
      last_event_created=EXCLUDED.last_event_created,updated_at=now()`, [
      intent.company_id,sub.customer,sub.id,intent.plan_slug,sub.status,
      Number.isFinite(sub.current_period_end) ? new Date(sub.current_period_end*1000) : null,
      event.created || 0,
    ]);
    await pool.query("UPDATE ca_stripe_checkout_intents SET subscription_id=$2 WHERE session_id=$1", [object.id,sub.id]);
    return;
  }
  if (kind.startsWith("customer.subscription.")) {
    const current = await pool.query("SELECT company_id,last_event_created FROM ca_stripe_subscriptions WHERE stripe_subscription_id=$1", [object.id]);
    if (!current.rowCount || Number(current.rows[0].last_event_created) > Number(event.created || 0)) return;
    const nextSlug = Object.entries(prices).find(([,id])=>id===subscriptionPriceId(object))?.[0];
    if (!nextSlug) return;
    await pool.query(`UPDATE ca_stripe_subscriptions SET status=$2,plan_slug=$3,current_period_end=$4,
      last_event_created=$5,updated_at=now()
      WHERE stripe_subscription_id=$1 AND last_event_created<=$5`,[
      object.id,object.status,nextSlug,
      Number.isFinite(object.current_period_end) ? new Date(object.current_period_end*1000) : null,
      event.created || 0,
    ]);
  }
}

router.post("/billing/stripe-webhook", async (req, res) => {
  const secret = process.env.CALLINGAGENT_STRIPE_WEBHOOK_SECRET;
  const raw = (req as typeof req & {rawBody?: Buffer}).rawBody;
  if (!secret || !raw || !verifySignature(raw, String(req.headers["stripe-signature"] || ""), secret)) {
    res.status(400).json({error:"Invalid signature"}); return;
  }
  try {
    const event = JSON.parse(raw.toString("utf8"));
    if (typeof event.id !== "string" || !supported.has(event.type) || event.livemode !== true) {
      res.json({received:true}); return;
    }
    const prior = await pool.query("SELECT event_id FROM ca_stripe_events WHERE event_id=$1", [event.id]);
    if (!prior.rowCount) {
      await applyStripeEvent(event);
      await pool.query("INSERT INTO ca_stripe_events(event_id) VALUES($1) ON CONFLICT DO NOTHING", [event.id]);
    }
    req.log.info({ eventType:event.type, eventId:event.id }, "Verified Stripe billing event processed");
    res.json({received:true});
  } catch (err: any) {
    req.log.error({error:err.message}, "Stripe webhook processing failed");
    res.status(500).json({error:"Webhook failed"});
  }
});
export default router;
