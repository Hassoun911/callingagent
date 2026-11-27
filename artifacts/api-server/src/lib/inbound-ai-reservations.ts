import { pool } from "@workspace/db";
import { incomingAiStopAfterSeconds } from "./inbound-ai-cutoff";

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
    const plan=await client.query(`SELECT included_minutes,verified_prepaid_minutes
      FROM ca_inbound_ai_enrollment
      WHERE company_id=$1 AND enabled IS TRUE AND billing_certified IS TRUE`,[companyId]);
    if(!plan.rowCount){await client.query("COMMIT");return {decision:"not_enrolled",maxCallSeconds:null};}
    const previous=await client.query("SELECT company_id,reserved_minutes,route_type FROM ca_inbound_ai_reservations WHERE call_sid=$1",[callSid]);
    if(previous.rowCount){
      if(Number(previous.rows[0].company_id)!==companyId)throw Error("Conflicting call SID ownership");
      if(previous.rows[0].route_type!==routeType)throw Error("Conflicting call SID AI route");
      await client.query("COMMIT");
      const minutes=Number(previous.rows[0].reserved_minutes);
      return {decision:"reserved",maxCallSeconds:incomingAiStopAfterSeconds(minutes),reservedMinutes:minutes};
    }
    // Consumed minutes for settled calls + worst-case outstanding reservations.
    // Unmeasured calls retain the entire reserved amount until reconciliation.
    const used=await client.query(`SELECT COALESCE(SUM(COALESCE(consumed_minutes,reserved_minutes)),0)::integer AS minutes
      FROM ca_inbound_ai_reservations WHERE company_id=$1
        AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[companyId]);
    // Only verified paid top-ups from the CURRENT UTC month count here.
    // Paid top-ups cannot accidentally carry into a future subscription month.
    const topups=await client.query(`SELECT COALESCE(SUM(minutes),0)::integer AS minutes
      FROM ca_inbound_ai_topup_intents WHERE company_id=$1 AND status='paid'
      AND period_start=date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,[companyId]);
    const total=Number(plan.rows[0].included_minutes)+Number(plan.rows[0].verified_prepaid_minutes)+Number(topups.rows[0].minutes);
    const remaining=total-Number(used.rows[0].minutes);
    if(remaining<=0){await client.query("COMMIT");return {decision:"exhausted",maxCallSeconds:0};}
    const reserved=Math.min(5,remaining);
    await client.query(`INSERT INTO ca_inbound_ai_reservations(call_sid,company_id,period_start,reserved_minutes,route_type)
       VALUES($1,$2,date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',$3,$4)`,[callSid,companyId,reserved,routeType]);
    await client.query("COMMIT");
    return {decision:"reserved",maxCallSeconds:incomingAiStopAfterSeconds(reserved),reservedMinutes:reserved};
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
