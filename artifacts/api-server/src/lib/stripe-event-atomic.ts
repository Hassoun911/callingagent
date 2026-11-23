/**
 * Apply each verified Stripe event atomically: event replay protection and
 * all resulting subscription/fulfillment mutations commit together.
 * The transaction-scoped advisory lock serializes different Stripe events
 * across horizontally scaled web workers without leaking session locks.
 */
type SqlClient = {
  query:(sql:string,parameters?:unknown[])=>Promise<{rowCount:number|null;rows:any[]}>;
};
export async function applyStripeEventAtomically(
  client:SqlClient, eventId:string, apply:()=>Promise<void>,
):Promise<"applied"|"duplicate">{
  if(!/^evt_[A-Za-z0-9_]{3,255}$/.test(eventId))throw Error("Invalid Stripe event id");
  let transactionOpened=false;
  try{
    await client.query("BEGIN");transactionOpened=true;
    await client.query("SELECT pg_advisory_xact_lock(820762101)");
    const previous=await client.query("SELECT event_id FROM ca_stripe_events WHERE event_id=$1",[eventId]);
    if(previous.rowCount){
      await client.query("COMMIT");transactionOpened=false;
      return "duplicate";
    }
    await apply();
    await client.query("INSERT INTO ca_stripe_events(event_id) VALUES($1)",[eventId]);
    await client.query("COMMIT");transactionOpened=false;
    return "applied";
  }catch(error){
    if(transactionOpened)await client.query("ROLLBACK").catch(()=>{});
    throw error;
  }
}
