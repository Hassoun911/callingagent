import { pool } from "@workspace/db";

/**
 * Carrier evidence ingestion. Telnyx call.cost is signed by the existing voice
 * webhook middleware; we store each reported leg for eventual CDR reconciliation.
 * This is NOT yet a verified customer billable-minute counter.
 */
export async function ensureTelnyxUsageSchema(){
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_telnyx_session_attribution(
    call_session_id text PRIMARY KEY, company_id integer NOT NULL,
    phone_number_id integer NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_telnyx_cost_legs(
    call_leg_id text PRIMARY KEY, call_session_id text,
    call_control_id text, event_id text,
    billed_duration_secs integer, company_id integer,
    occurred_at timestamptz, received_at timestamptz NOT NULL DEFAULT now()
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS ca_telnyx_cost_legs_company_idx ON ca_telnyx_cost_legs(company_id,occurred_at)");
}
export async function attributeTelnyxSession(sessionId:unknown,companyId:number|null|undefined,lineId:number):Promise<void>{
  if(typeof sessionId!=="string"||!sessionId||typeof companyId!=="number"||!Number.isSafeInteger(companyId)||!Number.isSafeInteger(lineId))return;
  await pool.query(`INSERT INTO ca_telnyx_session_attribution(call_session_id,company_id,phone_number_id)
  VALUES($1,$2,$3) ON CONFLICT(call_session_id) DO NOTHING`,[sessionId,companyId,lineId]);
  // Late attribution: cost webhooks can arrive before other webhook deliveries.
  await pool.query(`UPDATE ca_telnyx_cost_legs SET company_id=$2
     WHERE call_session_id=$1 AND company_id IS NULL`,[sessionId,companyId]);
}
export async function recordSignedTelnyxCost(event:any):Promise<void>{
  const payload=event?.payload||{};
  const leg=payload.call_leg_id;
  const session=payload.call_session_id;
  const value=payload.billed_duration_secs;
  if(typeof leg!=="string"||!leg||typeof session!=="string"||!session)return;
  const duration=typeof value==="number" && Number.isSafeInteger(value)&&value>=0?value:null;
  const date=new Date(event.occurred_at||Date.now());
  if(!Number.isFinite(date.getTime()))return;
  await pool.query(`INSERT INTO ca_telnyx_cost_legs(
      call_leg_id,call_session_id,call_control_id,event_id,billed_duration_secs,company_id,occurred_at)
    VALUES($1,$2,$3,$4,$5,(SELECT company_id FROM ca_telnyx_session_attribution WHERE call_session_id=$2),$6)
    ON CONFLICT(call_leg_id) DO UPDATE SET
      billed_duration_secs=COALESCE(EXCLUDED.billed_duration_secs,ca_telnyx_cost_legs.billed_duration_secs),
      company_id=COALESCE(ca_telnyx_cost_legs.company_id,EXCLUDED.company_id),
      event_id=EXCLUDED.event_id,received_at=now()`,[
      leg,session,typeof payload.call_control_id==="string"?payload.call_control_id:null,
      typeof event.id==="string"?event.id:null,duration,date
    ]);
}

/**
 * Idempotent internal call-history recovery, NOT rated customer billing.
 * Each repaired inbound call has exactly one matching signed Telnyx cost leg,
 * a carrier billed duration, and matching line/company ownership.
 * Unknown or ambiguous calls remain null, never assumed free.
 */
export async function reconcileVerifiedTelnyxInboundDurations():Promise<number>{
  const result=await pool.query(`WITH uniquely_verified AS (
    SELECT l.id AS log_id,MIN(c.billed_duration_secs)::integer AS carrier_seconds
    FROM call_logs l
    JOIN phone_numbers n ON n.id=l.phone_number_id
    JOIN ca_telnyx_cost_legs c ON l.twilio_call_sid='telnyx:' || c.call_control_id
    WHERE l.duration IS NULL AND l.direction=$1
      AND c.company_id=n.company_id
      AND c.billed_duration_secs IS NOT NULL
      AND c.billed_duration_secs BETWEEN 0 AND 86400
      AND l.created_at >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    GROUP BY l.id HAVING COUNT(*)=1
  ), updated AS (
    UPDATE call_logs l SET duration=v.carrier_seconds
    FROM uniquely_verified v WHERE l.id=v.log_id AND l.duration IS NULL
    RETURNING l.id
  ) SELECT COUNT(*)::integer AS recovered FROM updated`,["inbound"]);
  return Number(result.rows[0]?.recovered||0);
}
