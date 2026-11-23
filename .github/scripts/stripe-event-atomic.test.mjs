import test from "node:test";
import assert from "node:assert/strict";
import {applyStripeEventAtomically} from "../../artifacts/api-server/src/lib/stripe-event-atomic.ts";

function harness(alreadyProcessed=false){
  const calls=[];let rollback=false,applied=0,receipt=false,commits=0;
  const client={async query(sql,params){
    calls.push({sql,params});
    if(sql==="SELECT event_id FROM ca_stripe_events WHERE event_id=$1")
      return {rows:alreadyProcessed?[{event_id:params[0]}]:[],rowCount:alreadyProcessed?1:0};
    if(sql==="INSERT INTO ca_stripe_events(event_id) VALUES($1)")receipt=true;
    if(sql==="ROLLBACK")rollback=true;
    if(sql==="COMMIT")commits++;
    return {rows:[],rowCount:1};
  }};
  return {client,calls,getState:()=>({rollback,applied,receipt,commits}),applied:()=>applied++};
}
test("new verified event changes ledger and receipt in one transaction",async()=>{
  const h=harness();
  assert.equal(await applyStripeEventAtomically(h.client,"evt_unique_123",async()=>{
    h.applied();await h.client.query("UPDATE ca_stripe_subscriptions SET status='active'");
  }),"applied");
  const sql=h.calls.map(x=>x.sql);
  assert.deepEqual(sql,["BEGIN","SELECT pg_advisory_xact_lock(820762101)",
    "SELECT event_id FROM ca_stripe_events WHERE event_id=$1",
    "UPDATE ca_stripe_subscriptions SET status='active'",
    "INSERT INTO ca_stripe_events(event_id) VALUES($1)","COMMIT"]);
  assert.deepEqual(h.getState(),{rollback:false,applied:1,receipt:true,commits:1});
});
test("duplicate delivery is acknowledged without reapplying ledger mutations",async()=>{
  const h=harness(true);let ran=false;
  assert.equal(await applyStripeEventAtomically(h.client,"evt_duplicate_123",async()=>{ran=true}),"duplicate");
  assert.equal(ran,false);
  assert.equal(h.getState().receipt,false);
  assert.equal(h.getState().commits,1);
});
test("partial fulfillment update fails transaction and cannot record idempotency receipt",async()=>{
  const h=harness();
  await assert.rejects(
    applyStripeEventAtomically(h.client,"evt_partial_123",async()=>{
      await h.client.query("UPDATE ca_stripe_subscriptions SET status='active'");
      throw Error("carrier ledger unavailable");
    }),/carrier ledger unavailable/);
  const sql=h.calls.map(x=>x.sql);
  assert.equal(sql.at(-1),"ROLLBACK");
  assert.ok(!sql.some(x=>x.startsWith("INSERT INTO ca_stripe_events")));
  assert.equal(h.getState().commits,0);
});
test("failure to record receipt also rolls back earlier entitlement writes",async()=>{
  const h=harness();
  const client={query:async(sql,params)=>{
    if(sql.startsWith("INSERT INTO ca_stripe_events"))throw Error("receipt insert failed");
    return h.client.query(sql,params);
  }};
  await assert.rejects(
    applyStripeEventAtomically(client,"evt_receipt_123",async()=>h.client.query("UPDATE ca_stripe_subscriptions SET status='active'")),
    /receipt insert failed/);
  assert.equal(h.calls.at(-1).sql,"ROLLBACK");
});
test("reject malformed event ids before entering a transaction",async()=>{
  const h=harness();
  await assert.rejects(applyStripeEventAtomically(h.client,"fake",async()=>{}),/Invalid Stripe event id/);
  assert.equal(h.calls.length,0);
});
