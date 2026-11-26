import { pool } from "@workspace/db";

/** The $0.85/min pricing is a proposal, NOT validated production cost. */
export const INBOUND_AI_TOPUPS_CERTIFIED =
  process.env.CALLINGAGENT_INBOUND_AI_TOPUPS_CERTIFIED === "true" &&
  process.env.CALLINGAGENT_INBOUND_AI_RESERVATIONS_ENABLED === "true";

export const PROPOSED_INBOUND_TOPUPS = {
  50: 4250,
  100: 8500,
} as const;

export function validateInboundTopupMinutes(value:unknown): 50 | 100 | null {
  return value === 50 || value === 100 ? value : null;
}

export async function ensureInboundAiTopupSchema():Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_inbound_ai_topup_intents (
    session_id text PRIMARY KEY,
    company_id integer NOT NULL REFERENCES companies(id),
    period_start timestamptz NOT NULL,
    minutes integer NOT NULL CHECK(minutes IN (50,100)),
    subtotal_cents integer NOT NULL CHECK(subtotal_cents > 0),
    stripe_customer_id text NOT NULL,
    stripe_payment_intent_id text UNIQUE,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','refunded')),
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_paid_at timestamptz
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS ca_inbound_ai_topup_company_period_idx ON ca_inbound_ai_topup_intents(company_id,period_start,status)");
}

/**
 * Called ONLY by the already signature-verified, idempotent, transactional
 * Stripe webhook. Payment mode is never accepted based on redirect/metadata
 * alone. Missing or unregistered sessions are not valid funding evidence.
 *
 * This function needs the original pg client from Stripe event's transaction.
 */
export async function fulfillVerifiedIncomingAiTopup(
  sessionId:string,
  client:{query:(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>},
  stripeKey:string,
):Promise<"ignored"|"credited"> {
  if(!INBOUND_AI_TOPUPS_CERTIFIED)return "ignored";
  if(!/^cs_(live|test)_[a-zA-Z0-9_]{8,255}$/.test(sessionId))return "ignored";

  const intent=await client.query(`SELECT company_id,minutes,subtotal_cents,stripe_customer_id,status,period_start
    FROM ca_inbound_ai_topup_intents WHERE session_id=$1 FOR UPDATE`,[sessionId]);
  if(!intent.rowCount)return "ignored";
  if(intent.rows[0].status==="paid")return "ignored";
  if(intent.rows[0].status!=="pending")throw Error("Top-up intent already closed");

  const companyId=Number(intent.rows[0].company_id);
  // Never fund an unenrolled account or a current-period amount in another month.
  const eligible=await client.query(`SELECT company_id FROM ca_inbound_ai_enrollment
    WHERE company_id=$1 AND enabled IS TRUE AND billing_certified IS TRUE`,[companyId]);
  if(!eligible.rowCount)throw Error("AI top-up company is not certified and enrolled");
  const currentPeriod=await client.query(`SELECT date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start`);
  if(new Date(intent.rows[0].period_start).getTime()!==new Date(currentPeriod.rows[0].start).getTime())
    throw Error("Top-up purchase period is not current; manual review required");

  const response=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(sessionId),{
    headers:{Authorization:"Bearer "+stripeKey},signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error("Could not verify Stripe top-up session");
  const session:any=await response.json();
  const row=intent.rows[0];
  if(session.id!==sessionId||session.livemode!==true||session.mode!=="payment" ||
    session.status!=="complete"||session.payment_status!=="paid"||
    session.currency!=="cad"||session.customer!==row.stripe_customer_id||
    Number(session.amount_subtotal)!==Number(row.subtotal_cents)||
    Number(session.amount_total)<Number(row.subtotal_cents)||
    session.automatic_tax?.status!=="complete" ||
    typeof session.payment_intent!=="string")
    throw Error("Stripe top-up session does not match verified paid CAD order");

  const payment=await fetch("https://api.stripe.com/v1/payment_intents/"+encodeURIComponent(session.payment_intent),{
    headers:{Authorization:"Bearer "+stripeKey},signal:AbortSignal.timeout(15000)
  });
  if(!payment.ok)throw Error("Could not verify Stripe payment intent");
  const pi:any=await payment.json();
  if(pi.id!==session.payment_intent||pi.livemode!==true||
    pi.status!=="succeeded"||pi.currency!=="cad"||
    pi.customer!==row.stripe_customer_id||
    Number(pi.amount_received)!==Number(session.amount_total))
    throw Error("Payment intent does not prove full top-up charge");

  // A payment already fully/partially refunded must NEVER create minutes.
  if(typeof pi.latest_charge!=="string")throw Error("Missing payment charge evidence");
  const chargeResponse=await fetch("https://api.stripe.com/v1/charges/"+encodeURIComponent(pi.latest_charge),{
    headers:{Authorization:"Bearer "+stripeKey},signal:AbortSignal.timeout(15000)
  });
  if(!chargeResponse.ok)throw Error("Charge verification unavailable");
  const charge:any=await chargeResponse.json();
  if(charge.livemode!==true||charge.paid!==true||
    charge.payment_intent!==pi.id||charge.currency!=="cad"||
    Number(charge.amount_refunded)!==0||charge.refunded===true)
    throw Error("Top-up charge has not been verified as paid and unrefunded");
  // An intent row constitutes the month-scoped grant after this atomic update.
  // The existing Stripe event transaction serializes duplicate notifications.
  const updated=await client.query(`UPDATE ca_inbound_ai_topup_intents
    SET status='paid',stripe_payment_intent_id=$2,verified_paid_at=now()
    WHERE session_id=$1 AND status='pending' RETURNING session_id`,[sessionId,pi.id]);
  return updated.rowCount?"credited":"ignored";
}

/**
 * Signed Stripe charge.refunded path: verify the actual Stripe charge and
 * revoke ALL unused entitlement from any matching partially/full refunded
 * charge. Prior consumed calls remain in the immutable usage record.
 */
export async function revokeRefundedIncomingAiTopup(
  chargeId:string,
  paymentIntentId:string,
  client:{query:(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>},
  stripeKey:string,
):Promise<"ignored"|"revoked"> {
  if(!/^ch_[a-zA-Z0-9_]{8,255}$/.test(chargeId)||
    !/^pi_[a-zA-Z0-9_]{8,255}$/.test(paymentIntentId))return "ignored";
  // Most charge refunds are unrelated to prepaid AI. Avoid external requests
  // and changes to existing billing for those unrelated verified webhooks.
  const pending=await client.query(`SELECT session_id FROM ca_inbound_ai_topup_intents
    WHERE stripe_payment_intent_id=$1 AND status='paid' FOR UPDATE`,[paymentIntentId]);
  if(!pending.rowCount)return "ignored";
  const response=await fetch("https://api.stripe.com/v1/charges/"+encodeURIComponent(chargeId),{
    headers:{Authorization:"Bearer "+stripeKey},signal:AbortSignal.timeout(15000)
  });
  if(!response.ok)throw Error("Charge refund verification unavailable");
  const charge:any=await response.json();
  if(charge.livemode!==true||charge.payment_intent!==paymentIntentId||
    !Number.isSafeInteger(charge.amount_refunded)||charge.amount_refunded<=0)return "ignored";
  const updated=await client.query(`UPDATE ca_inbound_ai_topup_intents SET status='refunded'
    WHERE session_id=$1 AND status='paid' RETURNING session_id`,[pending.rows[0].session_id]);
  return updated.rowCount?"revoked":"ignored";
}
