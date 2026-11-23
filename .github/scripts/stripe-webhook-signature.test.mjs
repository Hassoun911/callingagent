import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyStripeWebhookSignature } from "../../artifacts/api-server/src/lib/stripe-webhook-signature.ts";

const now=1795460000;
const secret="whsec_valid_webhook_endpoint";
const payload=Buffer.from('{"id":"evt_test_123","type":"invoice.paid","livemode":true}',"utf8");
const sign=(body=payload,time=now,key=secret)=>
  crypto.createHmac("sha256",key).update(Buffer.concat([Buffer.from(String(time)+"."),body])).digest("hex");
const header=(body=payload,time=now,key=secret)=>`t=${time},v1=${sign(body,time,key)}`;

test("accepts valid signed raw Stripe body",()=>{
  assert.equal(verifyStripeWebhookSignature(payload,header(),secret,now),true);
});
test("accepts second matching v1 signature during secret rotation",()=>{
  assert.equal(verifyStripeWebhookSignature(payload,`t=${now},v1=${"0".repeat(64)},v1=${sign()}`,secret,now),true);
});
test("rejects tampered message bytes",()=>{
  assert.equal(verifyStripeWebhookSignature(Buffer.from(payload.toString().replace("invoice.paid","invoice.payment_failed")),header(),secret,now),false);
});
test("rejects wrong endpoint signing secret",()=>{
  assert.equal(verifyStripeWebhookSignature(payload,header(payload,now,"wrong"),secret,now),false);
});
test("rejects unsigned or malformed headers",()=>{
  for(const h of ["",`t=${now}`,`t=${now},v1=xyz`,`v1=${sign()}`,`t=none,v1=${sign()}`,`t=${now},t=${now},v1=${sign()}`])
    assert.equal(verifyStripeWebhookSignature(payload,h,secret,now),false,h);
});
test("rejects stale and future timestamps outside five minutes",()=>{
  assert.equal(verifyStripeWebhookSignature(payload,header(payload,now-301),secret,now),false);
  assert.equal(verifyStripeWebhookSignature(payload,header(payload,now+301),secret,now),false);
  assert.equal(verifyStripeWebhookSignature(payload,header(payload,now-300),secret,now),true);
});
test("rejects unicode normalization and reserialized JSON",()=>{
  const original=Buffer.from('{"message":"café","a":1}',"utf8");
  assert.equal(verifyStripeWebhookSignature(original,header(original),secret,now),true);
  const changed=Buffer.from('{"a":1,"message":"café"}',"utf8");
  assert.equal(verifyStripeWebhookSignature(changed,header(original),secret,now),false);
});
test("rejects invalid UTF-8 byte tampering instead of normalizing",()=>{
  const raw=Buffer.from([0x7b,0x22,0x78,0x22,0x3a,0x22,0xff,0x22,0x7d]);
  assert.equal(verifyStripeWebhookSignature(raw,header(raw),secret,now),true);
  assert.equal(verifyStripeWebhookSignature(Buffer.from(raw.toString("utf8")),header(raw),secret,now),false);
});
test("rejects missing raw body or empty secret",()=>{
  assert.equal(verifyStripeWebhookSignature(null,header(),secret,now),false);
  assert.equal(verifyStripeWebhookSignature(payload,header(),"",now),false);
});
