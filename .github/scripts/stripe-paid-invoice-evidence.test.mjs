import test from "node:test";
import assert from "node:assert/strict";
import { verifiedCurrentPaidInvoice } from "../../artifacts/api-server/src/lib/stripe-paid-invoice-evidence.ts";

const subscriptionId="sub_verified_123";
const priceId="price_expected";
const invoice=()=>({
  id:"in_current",livemode:true,paid:true,status:"paid",subscription:subscriptionId,
  lines:{data:[{pricing:{price_details:{price:priceId}}}]},
});
const subscription=()=>({
  id:subscriptionId,livemode:true,status:"active",latest_invoice:"in_current",
  items:{data:[{price:{id:priceId}}]},
});

test("current live paid invoice matches active package",()=>{
  assert.equal(verifiedCurrentPaidInvoice(invoice(),subscription(),subscriptionId,priceId),true);
});
test("supports Stripe's legacy invoice line price field",()=>{
  const i=invoice();i.lines={data:[{price:{id:priceId}}]};
  assert.equal(verifiedCurrentPaidInvoice(i,subscription(),subscriptionId,priceId),true);
});
test("rejects a historical invoice after a newer invoice exists",()=>{
  const s=subscription();s.latest_invoice="in_newer";
  assert.equal(verifiedCurrentPaidInvoice(invoice(),s,subscriptionId,priceId),false);
});
test("rejects an invoice for the old plan after an upgrade",()=>{
  const i=invoice();i.lines={data:[{pricing:{price_details:{price:"price_old"}}}]};
  assert.equal(verifiedCurrentPaidInvoice(i,subscription(),subscriptionId,priceId),false);
});
test("rejects an unpaid invoice",()=>{
  const i=invoice();i.paid=false;
  assert.equal(verifiedCurrentPaidInvoice(i,subscription(),subscriptionId,priceId),false);
});
test("rejects canceled subscriptions",()=>{
  const s=subscription();s.status="canceled";
  assert.equal(verifiedCurrentPaidInvoice(invoice(),s,subscriptionId,priceId),false);
});
test("rejects test-mode evidence on a live account",()=>{
  const i=invoice();i.livemode=false;
  assert.equal(verifiedCurrentPaidInvoice(i,subscription(),subscriptionId,priceId),false);
});
test("rejects cross-company subscription invoice attribution",()=>{
  const i=invoice();i.subscription="sub_another_company";
  assert.equal(verifiedCurrentPaidInvoice(i,subscription(),subscriptionId,priceId),false);
});
test("rejects missing invoice lines instead of guessing",()=>{
  const i=invoice();delete i.lines;
  assert.equal(verifiedCurrentPaidInvoice(i,subscription(),subscriptionId,priceId),false);
});
test("rejects mismatched subscription package even if invoice price matches",()=>{
  const s=subscription();s.items.data[0].price.id="price_other";
  assert.equal(verifiedCurrentPaidInvoice(invoice(),s,subscriptionId,priceId),false);
});
