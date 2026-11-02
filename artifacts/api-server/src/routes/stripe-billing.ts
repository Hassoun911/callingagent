import crypto from "crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";

const router: IRouter = Router();
const stripeAccount = "acct_1UXSv6K5sDJyhAae";
const prices: Record<string, string> = {
  payg: "price_1UXTBYK5sDJyhAaePgEaz4K3",
  starter: "price_1UXTBaK5sDJyhAae0rWx2ULM",
  business: "price_1UXTBcK5sDJyhAaeRTIzd0tX",
  plus: "price_1UXTBdK5sDJyhAaef4tMLWJW",
  pro: "price_1UXTBfK5sDJyhAaeZIKCCcG2",
};
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
    const available = await pool.query("SELECT price_cents,is_enabled,is_published FROM ca_plans WHERE slug=$1", [slug]);
    if (!available.rows[0]?.is_enabled || !available.rows[0]?.is_published) { res.status(403).json({error:"Plan unavailable"}); return; }
    const existing = await pool.query("SELECT stripe_customer_id FROM ca_stripe_subscriptions WHERE company_id=$1", [req.user.companyId]);
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
    res.json({ url: session.url });
  } catch (err: any) {
    req.log.error({ error: err.message }, "Stripe checkout failed");
    res.status(502).json({ error: "Checkout could not be started" });
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
// Event storage is an audit ledger, not entitlement activation; that remains gated.
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
    await pool.query("INSERT INTO ca_stripe_events(event_id) VALUES($1) ON CONFLICT DO NOTHING", [event.id]);
    req.log.info({ eventType:event.type, eventId:event.id }, "Verified Stripe billing event received");
    res.json({received:true});
  } catch (err: any) {
    req.log.error({error:err.message}, "Stripe webhook processing failed");
    res.status(500).json({error:"Webhook failed"});
  }
});
export default router;
