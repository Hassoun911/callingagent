import twilio from "twilio";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { INBOUND_AI_RESERVATIONS_ENABLED } from "./inbound-ai-reservations";

/**
 * Disabled until a company is explicitly certified and opted into metered
 * incoming AI calls. Prevents an unanswered <Gather> from remaining open past
 * a reserved usage allowance; process restarts do not discard deadlines.
 *
 * Twilio completion is best effort; carrier-billed seconds, not estimated
 * elapsed time, are eventually used for settlement. Unknown durations keep
 * their reservation in place. Never touches outgoing calls or ordinary VoIP.
 */
export async function sweepOverdueIncomingAiCalls():Promise<{attempted:number;completed:number;failed:number}> {
  if(!INBOUND_AI_RESERVATIONS_ENABLED)return {attempted:0,completed:0,failed:0};
  const sid=process.env.TWILIO_ACCOUNT_SID,token=process.env.TWILIO_AUTH_TOKEN;
  if(!sid||!token)return {attempted:0,completed:0,failed:0};
  const candidates=await pool.query<{call_sid:string}>(`WITH candidates AS (
    SELECT r.call_sid FROM ca_inbound_ai_reservations r
    JOIN ca_inbound_ai_enrollment e ON e.company_id=r.company_id
    WHERE e.enabled=TRUE AND e.billing_certified=TRUE
      AND r.settled_at IS NULL
      AND r.started_at + make_interval(secs=>GREATEST(15,r.reserved_minutes*60-25))<=now()
      AND (r.termination_requested_at IS NULL OR r.termination_requested_at<now()-interval '45 seconds')
    ORDER BY r.started_at ASC LIMIT 10 FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE ca_inbound_ai_reservations r SET termination_requested_at=now()
  FROM candidates c WHERE r.call_sid=c.call_sid RETURNING r.call_sid`);
  const client=twilio(sid,token);
  let completed=0,failed=0;
  for(const candidate of candidates.rows){
    try{
      // Twilio update is idempotent for ongoing calls; already completed
      // calls may return an error and will still be reconciled by callbacks.
      await client.calls(candidate.call_sid).update({status:"completed"});
      completed++;
    }catch(error:any){
      failed++;
      logger.warn({callSid:candidate.call_sid,code:error?.code,message:error?.message},
        "Incoming AI cutoff carrier request not confirmed");
    }
  }
  if(candidates.rows.length)logger.info({attempted:candidates.rows.length,completed,failed},
    "Opt-in incoming AI duration cutoff sweep");
  return {attempted:candidates.rows.length,completed,failed};
}

let running=false;
export function startIncomingAiCutoffWatchdog():void {
  if(!INBOUND_AI_RESERVATIONS_ENABLED)return;
  // No eligible enrolled companies means no carrier calls can be affected.
  const timer=setInterval(async()=>{
    if(running)return;
    running=true;
    try{await sweepOverdueIncomingAiCalls();}
    catch(error:any){logger.error({message:error?.message},"Incoming AI cutoff watchdog failed");}
    finally{running=false;}
  },10000);
  timer.unref();
}
