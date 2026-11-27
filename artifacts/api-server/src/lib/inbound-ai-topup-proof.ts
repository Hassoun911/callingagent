/**
 * Pure, provider-evidence validation for future prepaid incoming AI minutes.
 * Never accept browser redirects, user metadata or unsigned amounts as proof.
 */
type TopupOrder={sessionId:string;customerId:string;subtotalCents:number};
type StripeValue=Record<string,any>;

export function validPaidTopupSession(s:StripeValue,order:TopupOrder):boolean{
  return s?.id===order.sessionId && s.livemode===true && s.mode==="payment" &&
    s.status==="complete" && s.payment_status==="paid" && s.currency==="cad" &&
    s.customer===order.customerId && Number.isSafeInteger(s.amount_subtotal) &&
    s.amount_subtotal===order.subtotalCents &&
    Number.isSafeInteger(s.amount_total) && s.amount_total>=order.subtotalCents &&
    s.automatic_tax?.status==="complete" &&
    typeof s.payment_intent==="string" && /^pi_[A-Za-z0-9_]{8,255}$/.test(s.payment_intent);
}
export function validPaidTopupPaymentIntent(p:StripeValue,s:StripeValue,order:TopupOrder):boolean{
  return p?.id===s.payment_intent && p.livemode===true &&
    p.status==="succeeded" && p.currency==="cad" &&
    p.customer===order.customerId &&
    Number.isSafeInteger(p.amount_received) && p.amount_received===s.amount_total &&
    typeof p.latest_charge==="string" && /^ch_[A-Za-z0-9_]{8,255}$/.test(p.latest_charge);
}
export function validUnrefundedTopupCharge(c:StripeValue,p:StripeValue,s:StripeValue):boolean{
  return c?.id===p.latest_charge && c.livemode===true && c.paid===true &&
    c.payment_intent===p.id && c.currency==="cad" &&
    Number.isSafeInteger(c.amount) && c.amount===s.amount_total &&
    Number.isSafeInteger(c.amount_refunded) && c.amount_refunded===0 &&
    c.refunded!==true;
}
