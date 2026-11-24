import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {applyStripeEventAtomically} from "../../../artifacts/api-server/src/lib/stripe-event-atomic.ts";

// This database exists only inside the ephemeral GitHub Actions PostgreSQL
// service. Never point TEST_DATABASE_URL at production or a persistent store.
const url=process.env.TEST_DATABASE_URL;
if(!url || !url.includes("127.0.0.1") || !url.includes("callingagent_test"))
  throw Error("Refusing transaction integration test without local disposable callingagent_test Postgres");
const pool=new Pool({connectionString:url,max:5,connectionTimeoutMillis:6000});
before(async()=>{
  await pool.query("CREATE TABLE ca_stripe_events(event_id text PRIMARY KEY)");
  await pool.query("CREATE TABLE ca_stripe_subscriptions(company_id int PRIMARY KEY, status text NOT NULL)");
});
after(async()=>{await pool.end()});
const apply=async(client,id,fn)=>{
  try {return await applyStripeEventAtomically(client,id,fn)}
  finally{client.release()}
};
test("real PostgreSQL commits entitlement and event receipt together",async()=>{
  const client=await pool.connect();
  assert.equal(await apply(client,"evt_pg_success_001",()=>client.query(
    "INSERT INTO ca_stripe_subscriptions(company_id,status) VALUES(1,'active')")),"applied");
  const [sub,event]=await Promise.all([
    pool.query("SELECT status FROM ca_stripe_subscriptions WHERE company_id=1"),
    pool.query("SELECT event_id FROM ca_stripe_events WHERE event_id='evt_pg_success_001'")
  ]);
  assert.equal(sub.rows[0].status,"active");
  assert.equal(event.rowCount,1);
});
test("real PostgreSQL skips duplicate event without overwriting paid status",async()=>{
  const client=await pool.connect();
  let invoked=false;
  assert.equal(await apply(client,"evt_pg_success_001",async()=>{
    invoked=true;
    await client.query("UPDATE ca_stripe_subscriptions SET status='canceled' WHERE company_id=1");
  }),"duplicate");
  assert.equal(invoked,false);
  assert.equal((await pool.query("SELECT status FROM ca_stripe_subscriptions WHERE company_id=1")).rows[0].status,"active");
});
test("real PostgreSQL rolls back a partial entitlement write when later operation fails",async()=>{
  const client=await pool.connect();
  await assert.rejects(apply(client,"evt_pg_rollback_002",async()=>{
    await client.query("INSERT INTO ca_stripe_subscriptions(company_id,status) VALUES(2,'active')");
    await client.query("INSERT INTO missing_carrier_table(id) VALUES(1)");
  }));
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM ca_stripe_subscriptions WHERE company_id=2")).rows[0].n,0);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM ca_stripe_events WHERE event_id='evt_pg_rollback_002'")).rows[0].n,0);
});
test("real PostgreSQL serializes concurrent deliveries and writes exactly one receipt",async()=>{
  const [left,right]=await Promise.all([pool.connect(),pool.connect()]);
  const results=await Promise.all([
    apply(left,"evt_pg_parallel_003",()=>left.query("INSERT INTO ca_stripe_subscriptions(company_id,status) VALUES(3,'active')")),
    apply(right,"evt_pg_parallel_003",()=>right.query("INSERT INTO ca_stripe_subscriptions(company_id,status) VALUES(3,'active')"))
  ]);
  assert.deepEqual(results.sort(),["applied","duplicate"]);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM ca_stripe_subscriptions WHERE company_id=3")).rows[0].n,1);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM ca_stripe_events WHERE event_id='evt_pg_parallel_003'")).rows[0].n,1);
});
test("real PostgreSQL can retry a rolled-back event cleanly",async()=>{
  const client=await pool.connect();
  assert.equal(await apply(client,"evt_pg_rollback_002",()=>client.query(
    "INSERT INTO ca_stripe_subscriptions(company_id,status) VALUES(2,'active')")),"applied");
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM ca_stripe_events WHERE event_id='evt_pg_rollback_002'")).rows[0].n,1);
});
