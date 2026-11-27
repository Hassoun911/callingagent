import test from "node:test";
import assert from "node:assert/strict";
import {validPaidTopupSession,validPaidTopupPaymentIntent,validUnrefundedTopupCharge} from "../../artifacts/api-server/src/lib/inbound-ai-topup-proof.ts";

const order={sessionId:"cs_live_"+"a".repeat(18),customerId:"cus_"+"b".repeat(18),subtotalCents:4250};
const session={id:order.sessionId,livemode:true,mode:"payment",status:"complete",payment_status:"paid",currency:"cad",customer:order.customerId,amount_subtotal:4250,amount_total:4802,automatic_tax:{status:"complete"},payment_intent:"pi_"+"c".repeat(18)};
const payment={id:session.payment_intent,livemode:true,status:"succeeded",currency:"cad",customer:order.customerId,amount_received:4802,latest_charge:"ch_"+"d".repeat(18)};
const charge={id:payment.latest_charge,livemode:true,paid:true,payment_intent:payment.id,currency:"cad",amount:4802,amount_refunded:0,refunded:false};
test("accepts only matching paid CAD Checkout, payment intent and unrefunded charge",()=>{
  assert.equal(validPaidTopupSession(session,order),true);
  assert.equal(validPaidTopupPaymentIntent(payment,session,order),true);
  assert.equal(validUnrefundedTopupCharge(charge,payment,session),true);
});
test("rejects unpaid, test-mode, mispriced, wrong-customer and non-Canadian checkouts",()=>{
  for(const change of [{payment_status:"unpaid"},{livemode:false},{amount_subtotal:1},{currency:"usd"},{customer:"cus_other"},{automatic_tax:{status:"requires_location_inputs"}},{payment_intent:"bogus"}]){
    assert.equal(validPaidTopupSession({...session,...change},order),false,JSON.stringify(change));
  }
});
test("rejects payment intents without full charge and correct customer",()=>{
  for(const change of [{status:"requires_payment_method"},{amount_received:4250},{customer:"cus_other"},{livemode:false},{latest_charge:"bad"}]){
    assert.equal(validPaidTopupPaymentIntent({...payment,...change},session,order),false,JSON.stringify(change));
  }
});
test("rejects refunded, partially refunded, mismatched, or unpaid charges",()=>{
  for(const change of [{paid:false},{refunded:true},{amount_refunded:1},{amount_refunded:4802},{amount:1},{currency:"usd"},{payment_intent:"pi_other"},{livemode:false}]){
    assert.equal(validUnrefundedTopupCharge({...charge,...change},payment,session),false,JSON.stringify(change));
  }
});
