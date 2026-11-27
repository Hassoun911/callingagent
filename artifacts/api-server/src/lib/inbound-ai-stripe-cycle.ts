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
