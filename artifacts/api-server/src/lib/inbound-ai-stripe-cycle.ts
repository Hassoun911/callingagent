import { verifiedCurrentPaidInvoice } from "./stripe-paid-invoice-evidence";
import { validCertifiedAiPeriod } from "./inbound-ai-period";

/**
 * Dedicated AI Receptionist billing proof. Existing VoIP subscription prices
 * must NEVER renew or activate the $99 incoming-AI allowance.
 */
export function verifiedAiPaidBillingCycle(
  invoice:any,
  subscription:any,
  subscriptionId:string,
  aiPriceId:string,
  now:Date,
):{start:Date;end:Date}|null{
  if(!/^price_[A-Za-z0-9_]{6,255}$/.test(aiPriceId))return null;
  if(!verifiedCurrentPaidInvoice(invoice,subscription,subscriptionId,aiPriceId))return null;
  if(subscription.currency!=="cad")return null;
  const items=subscription.items?.data;
  if(!Array.isArray(items)||items.length!==1)return null;
  const price=items[0]?.price;
  if(price?.id!==aiPriceId||price?.currency!=="cad"||
    price?.unit_amount!==9900||price?.recurring?.interval!=="month"||
    price?.recurring?.interval_count!==1)return null;
  const lines=invoice.lines?.data;
  const matches=lines?.filter((line:any)=>{
    const id=line?.pricing?.price_details?.price||line?.price?.id||line?.plan?.id;
    return id===aiPriceId && Number.isSafeInteger(line?.period?.start) &&
      Number.isSafeInteger(line?.period?.end);
  });
  if(!Array.isArray(matches)||matches.length!==1)return null;
  const line=matches[0];
  const start=new Date(line.period.start*1000);
  const end=new Date(line.period.end*1000);
  if(!validCertifiedAiPeriod(start,end,now))return null;
  if(invoice.currency!=="cad")return null;
  // Avoid accidentally treating a zero-cost coupon or a refunded free trial
  // as payment for a full-price monthly AI subscription.
  if(!Number.isSafeInteger(invoice.amount_paid)||invoice.amount_paid<=0)return null;
  return {start,end};
}

/**
 * Call only from a Stripe-signature-verified, idempotent event transaction.
 * A matching explicitly linked AI subscription is mandatory. VoIP subscription
 * invoices cannot modify AI minute periods. This function grants no enrollment
 * and does not alter any customer phone or payment method.
 */
export async function syncLinkedIncomingAiPaidCycle(
 invoiceId:string,
 subscriptionId:string,
 client:{query:(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>},
 stripeKey:string,
 priceId:string,
):Promise<"ignored"|"updated"> {
 if(process.env.CALLINGAGENT_AI_BILLING_CERTIFIED!=="true")return "ignored";
 if(!/^in_[A-Za-z0-9_]{6,255}$/.test(invoiceId)||
   !/^sub_[A-Za-z0-9_]{6,255}$/.test(subscriptionId)||
   !/^price_[A-Za-z0-9_]{6,255}$/.test(priceId))return "ignored";
 const candidate=await client.query(`SELECT company_id FROM ca_inbound_ai_enrollment
   WHERE ai_stripe_subscription_id=$1 AND billing_certified=TRUE AND enabled=TRUE`,[subscriptionId]);
 if(candidate.rowCount!==1)return "ignored";
 // Ensure a legacy Business Phone subscription is not reused as AI evidence.
 const legacy=await client.query("SELECT 1 FROM ca_stripe_subscriptions WHERE stripe_subscription_id=$1",[subscriptionId]);
 if(legacy.rowCount)throw Error("Existing VoIP subscription cannot authorize AI minutes");
 const headers={Authorization:"Bearer "+stripeKey};
 const [ir,sr]=await Promise.all([
   fetch("https://api.stripe.com/v1/invoices/"+encodeURIComponent(invoiceId),{headers,signal:AbortSignal.timeout(15000)}),
   fetch("https://api.stripe.com/v1/subscriptions/"+encodeURIComponent(subscriptionId)+"?expand[]=items.data.price",{headers,signal:AbortSignal.timeout(15000)})
 ]);
 if(!ir.ok||!sr.ok)throw Error("Could not independently verify AI invoice and subscription");
 const invoice:any=await ir.json(),subscription:any=await sr.json();
 const period=verifiedAiPaidBillingCycle(invoice,subscription,subscriptionId,priceId,new Date());
 if(!period)throw Error("AI subscription invoice does not prove paid $99 CAD current cycle");
 const updated=await client.query(`UPDATE ca_inbound_ai_enrollment
   SET cycle_start=$2,cycle_end=$3,ai_last_paid_invoice_id=$4,updated_at=now()
   WHERE company_id=$1 AND ai_stripe_subscription_id=$5
     AND enabled=TRUE AND billing_certified=TRUE
     AND (cycle_end IS NULL OR cycle_end<=$3)
   RETURNING company_id`,[candidate.rows[0].company_id,period.start,period.end,invoiceId,subscriptionId]);
 return updated.rowCount===1?"updated":"ignored";
}
