import { pool } from "@workspace/db";
import { incomingAiStopAfterSeconds } from "./inbound-ai-cutoff";
import { certifiedAiCycleCutoffSeconds, validCertifiedAiPeriod } from "./inbound-ai-period";

/**
 * Reserved incoming AI minutes. IMPORTANT:
 * This path is OFF unless explicitly enabled by environment AND the company
 * has a separately certified, opted-in plan row. Existing phone accounts are
 * never enrolled automatically. No Stripe calls, credits or outbound calls.
 */
export const INBOUND_AI_RESERVATIONS_ENABLED = process.env.CALLINGAGENT_INBOUND_AI_RESERVATIONS_ENABLED === "true";

export async function ensureInboundAiReservationSchema():Promise<void>{
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_inbound_ai_enrollment(
    company_id integer PRIMARY KEY REFERENCES companies(id),
    enabled boolean NOT NULL DEFAULT false,
    billing_certified boolean NOT NULL DEFAULT false,
    included_minutes integer NOT NULL DEFAULT 80 CHECK(included_minutes BETWEEN 0 AND 100000),
    cycle_start timestamptz,
    cycle_end timestamptz,
    verified_prepaid_minutes integer NOT NULL DEFAULT 0 CHECK(verified_prepaid_minutes BETWEEN 0 AND 100000),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK(NOT enabled OR billing_certified)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_inbound_ai_reservations(
    call_sid text PRIMARY KEY CHECK(call_sid ~ '^CA[0-9a-fA-F]{32}$'),
    company_id integer NOT NULL REFERENCES companies(id),
    route_type text NOT NULL DEFAULT 'direct' CHECK(route_type IN ('direct','forward_fallback')),
    period_start timestamptz NOT NULL,
    reserved_minutes integer NOT NULL CHECK(reserved_minutes BETWEEN 1 AND 5),
    consumed_minutes integer CHECK(consumed_minutes BETWEEN 0 AND 1440),
    started_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    termination_requested_at timestamptz,
    CHECK((consumed_minutes IS NULL AND settled_at IS NULL)
      OR (consumed_minutes IS NOT NULL AND settled_at IS NOT NULL))
  )`);
  await pool.query("ALTER TABLE ca_inbound_ai_enrollment ADD COLUMN IF NOT EXISTS cycle_start timestamptz");
  await pool.query("ALTER TABLE ca_inbound_ai_enrollment ADD COLUMN IF NOT EXISTS cycle_end timestamptz");
  await pool.query("ALTER TABLE ca_inbound_ai_reservations ADD COLUMN IF NOT EXISTS termination_requested_at timestamptz");
  await pool.query("ALTER TABLE ca_inbound_ai_reservations ADD COLUMN IF NOT EXISTS route_type text NOT NULL DEFAULT 'direct' CHECK(route_type IN ('direct','forward_fallback'))");

  await pool.query("CREATE INDEX IF NOT EXISTS ca_inbound_ai_reservations_company_period_idx ON ca_inbound_ai_reservations(company_id,period_start)");
}

export type IncomingAiAdmission =
  | {decision:"not_enrolled";maxCallSeconds:null}
  | {decision:"reserved";maxCallSeconds:number;reservedMinutes:number}
  | {decision:"exhausted";maxCallSeconds:0};

/** Strictly for inbound AI Twilio voice paths; never run for VoIP or outbound. */
export async function reserveIncomingAiMinutes(companyId:number|null|undefined,callSid:string,routeType:"direct"|"forward_fallback"="direct"):Promise<IncomingAiAdmission>{
  if(!INBOUND_AI_RESERVATIONS_ENABLED)return {decision:"not_enrolled",maxCallSeconds:null};
  if(!Number.isSafeInteger(companyId)||!companyId||companyId<=0||!/^CA[a-fA-F0-9]{32}$/.test(callSid))
    throw new Error("Verified company and Twilio CallSid required");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1,$2)",[714095,companyId]);
    const plan=await client.query(`SELECT included_minutes,cycle_start,cycle_end
      FROM ca_inbound_ai_enrollment
      WHERE company_id=$1 AND enabled IS TRUE AND billing_certified IS TRUE`,[companyId]);
    if(!plan.rowCount){await client.query("COMMIT");return {decision:"not_enrolled",maxCallSeconds:null};}
    // No automatic calendar-month renewals or VoIP-subscription inference.
    // A certified AI billing period must be explicitly set from real payment
    // evidence before any existing company can receive restricted AI usage.
    const now=new Date();
    const start=plan.rows[0].cycle_start?new Date(plan.rows[0].cycle_start):new Date(NaN);
    const end=plan.rows[0].cycle_end?new Date(plan.rows[0].cycle_end):new Date(NaN);
    if(!validCertifiedAiPeriod(start,end,now)){
      await client.query("COMMIT");
      return {decision:"exhausted",maxCallSeconds:0};
    }

    const previous=await client.query("SELECT company_id,reserved_minutes,route_type,period_start,started_at FROM ca_inbound_ai_reservations WHERE call_sid=$1",[callSid]);
    if(previous.rowCount){
      if(Number(previous.rows[0].company_id)!==companyId)throw Error("Conflicting call SID ownership");
      if(previous.rows[0].route_type!==routeType)throw Error("Conflicting call SID AI route");
      await client.query("COMMIT");
      if(new Date(previous.rows[0].period_start).getTime()!==start.getTime())return {decision:"exhausted",maxCallSeconds:0};
      const minutes=Number(previous.rows[0].reserved_minutes);
      const elapsed=Math.ceil((now.getTime()-new Date(previous.rows[0].started_at).getTime())/1000);
      const remainingReserved=Math.max(0,incomingAiStopAfterSeconds(minutes)-elapsed);
      const cutoff=certifiedAiCycleCutoffSeconds(remainingReserved,end,now);
      return cutoff>0?{decision:"reserved",maxCallSeconds:cutoff,reservedMinutes:minutes}:{decision:"exhausted",maxCallSeconds:0};
    }
    // Consumed minutes for settled calls + worst-case outstanding reservations.
    // Unmeasured calls retain the entire reserved amount until reconciliation.
    const used=await client.query(`SELECT COALESCE(SUM(COALESCE(consumed_minutes,reserved_minutes)),0)::integer AS minutes
      FROM ca_inbound_ai_reservations WHERE company_id=$1
        AND period_start=$2::timestamptz`,[companyId,start]);
    // Only verified paid top-ups from the SAME certified AI billing cycle count.
    // Historical or future subscription periods never grant current usage.
    const topups=await client.query(`SELECT COALESCE(SUM(minutes),0)::integer AS minutes
      FROM ca_inbound_ai_topup_intents WHERE company_id=$1 AND status='paid'
      AND period_start=$2::timestamptz`,[companyId,start]);
    // The legacy verified_prepaid_minutes column is not period-scoped.
    // Do NOT include it; only verified Stripe purchases for this month grant
    // extra minutes. Otherwise a one-time grant could recur indefinitely.
    const total=Number(plan.rows[0].included_minutes)+Number(topups.rows[0].minutes);
    const remaining=total-Number(used.rows[0].minutes);
    if(remaining<=0){await client.query("COMMIT");return {decision:"exhausted",maxCallSeconds:0};}
    const reserved=Math.min(5,remaining);
    const cutoff=certifiedAiCycleCutoffSeconds(incomingAiStopAfterSeconds(reserved),end,now);
    if(cutoff<=0){await client.query("COMMIT");return {decision:"exhausted",maxCallSeconds:0};}
    await client.query(`INSERT INTO ca_inbound_ai_reservations(call_sid,company_id,period_start,reserved_minutes,route_type)
       VALUES($1,$2,$3,$4,$5)`,[callSid,companyId,start,reserved,routeType]);
    await client.query("COMMIT");
    return {decision:"reserved",maxCallSeconds:cutoff,reservedMinutes:reserved};
  }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
  finally{client.release();}
}

/**
 * Provider-measured terminal call seconds only. No evidence = reserve stays
 * occupied as a fail-closed protection. Forwarded-fallback parent calls
 * include non-AI time and cannot be settled from total parent duration.
 */
export async function settleIncomingAiMinutes(callSid:string,seconds:number):Promise<boolean>{
  if(!INBOUND_AI_RESERVATIONS_ENABLED)return false;
  if(!/^CA[a-fA-F0-9]{32}$/.test(callSid)||!Number.isSafeInteger(seconds)||seconds<0||seconds>86400)return false;
  const result=await pool.query(`UPDATE ca_inbound_ai_reservations
    SET consumed_minutes=CEIL($2::numeric/60)::integer,settled_at=now()
    WHERE call_sid=$1 AND consumed_minutes IS NULL AND route_type='direct' RETURNING call_sid`,[callSid,seconds]);
  return Boolean(result.rowCount);
}
