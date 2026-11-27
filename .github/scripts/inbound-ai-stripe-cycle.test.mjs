import test from "node:test";
import assert from "node:assert/strict";
import { verifiedAiPaidBillingCycle } from "../../artifacts/api-server/src/lib/inbound-ai-stripe-cycle.ts";

const start=Math.floor(Date.parse("2026-11-17T15:00:00Z")/1000);
const end=Math.floor(Date.parse("2026-12-17T15:00:00Z")/1000);
const priceId="price_"+"A".repeat(18),subId="sub_"+"B".repeat(18);
const invoice={id:"in_"+"C".repeat(18),livemode:true,paid:true,status:"paid",currency:"cad",amount_paid:9900,parent:{subscription_details:{subscription:subId}},lines:{data:[{pricing:{price_details:{price:priceId}},period:{start,end}}]}};
const sub={id:subId,livemode:true,status:"active",currency:"cad",latest_invoice:invoice.id,items:{data:[{price:{id:priceId,currency:"cad",unit_amount:9900,recurring:{interval:"month",interval_count:1}}}]}};
const now=new Date("2026-11-26T20:00:00Z");
const check=(i=invoice,s=sub,p=priceId,t=now)=>verifiedAiPaidBillingCycle(i,s,subId,p,t);

test("valid active paid AI invoice establishes a specific billing cycle",()=>{
 const period=check();assert.ok(period);
 assert.equal(period.start.toISOString(),"2026-11-17T15:00:00.000Z");
 assert.equal(period.end.toISOString(),"2026-12-17T15:00:00.000Z");
});
test("different VoIP price or wrong amount never renews AI",()=>{
 assert.equal(check(invoice,sub,"price_"+"V".repeat(18)),null);
 assert.equal(check(invoice,{...sub,items:{data:[{price:{...sub.items.data[0].price,unit_amount:3900}}]}}),null);
});
test("reject unpaid, stale, mismatched, test mode and altered subscription",()=>{
 for(const bad of [{paid:false},{status:"open"},{livemode:false},{amount_paid:0},{currency:"usd"},{parent:{subscription_details:{subscription:"sub_other"}}}]){
   assert.equal(check({...invoice,...bad}),null,JSON.stringify(bad));
 }
 for(const bad of [{status:"canceled"},{latest_invoice:"in_previous"},{currency:"usd"},{livemode:false}]){
   assert.equal(check(invoice,{...sub,...bad}),null,JSON.stringify(bad));
 }
 assert.equal(check(invoice,sub,priceId,new Date("2026-12-18T00:00:00Z")),null);
});
test("reject arbitrary invoice periods, multiple matching lines and yearly intervals",()=>{
 assert.equal(check({...invoice,lines:{data:[{pricing:{price_details:{price:priceId}},period:{start,end:start+90*86400}}]}}),null);
 assert.equal(check({...invoice,lines:{data:[...invoice.lines.data,...invoice.lines.data]}}),null);
 assert.equal(check(invoice,{...sub,items:{data:[{price:{...sub.items.data[0].price,recurring:{interval:"year",interval_count:1}}}]}}),null);
});
