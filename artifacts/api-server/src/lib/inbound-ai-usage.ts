import { pool } from "@workspace/db";

/**
 * Evidence-only inbound AI consumption ledger.
 * This deliberately does not grant minutes, authorize paid service, debit a
 * wallet, or apply cutoff. Signed/verified usage is needed before activation.
 * Twilio call SIDs are unique, so retries cannot double-count consumption.
 */
export async function ensureInboundAiUsageSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_inbound_ai_usage_evidence (
    call_sid text PRIMARY KEY,
    company_id integer NOT NULL REFERENCES companies(id),
    phone_number_id integer NOT NULL,
    direction text NOT NULL CHECK(direction='inbound'),
    usage_type text NOT NULL CHECK(usage_type='ai_receptionist'),
    status text NOT NULL,
    duration_seconds integer CHECK(duration_seconds BETWEEN 0 AND 86400),
    duration_source text CHECK(duration_source IN ('twilio_status_callback','twilio_api_lookup')),
    call_started_at timestamptz NOT NULL,
    observed_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((duration_seconds IS NULL AND duration_source IS NULL)
        OR (duration_seconds IS NOT NULL AND duration_source IS NOT NULL))
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS ca_inbound_ai_usage_company_month_idx ON ca_inbound_ai_usage_evidence(company_id,call_started_at)");
}

/**
 * Import a terminal Twilio AI call from an existing, company-owned call log.
 * Never trusts a caller-supplied company ID. No recording, transcript, PII,
 * raw provider authentication, or payment information is written.
 */
export async function captureInboundAiCallEvidence(
  callSid: string,
  source: "twilio_status_callback" | "twilio_api_lookup",
): Promise<boolean> {
  if (!/^CA[a-fA-F0-9]{32}$/.test(callSid)) return false;
  const result = await pool.query(`INSERT INTO ca_inbound_ai_usage_evidence(
    call_sid,company_id,phone_number_id,direction,usage_type,
    status,duration_seconds,duration_source,call_started_at
  )
  SELECT l.twilio_call_sid,n.company_id,l.phone_number_id,'inbound','ai_receptionist',
    l.status,
    CASE WHEN l.duration BETWEEN 0 AND 86400 THEN l.duration ELSE NULL END,
    CASE WHEN l.duration BETWEEN 0 AND 86400 THEN $2::text ELSE NULL END,
    l.created_at
  FROM call_logs l
  JOIN phone_numbers n ON n.id=l.phone_number_id
  WHERE l.twilio_call_sid=$1
    AND l.direction='inbound'
    AND l.answer_mode='ai_voice'
    AND n.company_id IS NOT NULL
    AND l.status IN ('completed','failed','busy','no-answer','canceled')
  ON CONFLICT(call_sid) DO UPDATE SET
    status=EXCLUDED.status,
    duration_seconds=COALESCE(ca_inbound_ai_usage_evidence.duration_seconds,EXCLUDED.duration_seconds),
    duration_source=COALESCE(ca_inbound_ai_usage_evidence.duration_source,EXCLUDED.duration_source),
    observed_at=now()
  WHERE ca_inbound_ai_usage_evidence.company_id=EXCLUDED.company_id
    AND ca_inbound_ai_usage_evidence.phone_number_id=EXCLUDED.phone_number_id
  RETURNING call_sid`,[callSid,source]);
  return Boolean(result.rowCount);
}

/** Read-only planning view; never a purchasable or enforceable remaining balance. */
export async function readIncomingAiMonthlyEvidence(companyId: number) {
  if (!Number.isSafeInteger(companyId)||companyId<=0) throw new Error("Invalid company");
  const result=await pool.query(`SELECT
    COUNT(*)::integer AS calls,
    COUNT(*) FILTER(WHERE duration_seconds IS NOT NULL)::integer AS measured_calls,
    COUNT(*) FILTER(WHERE duration_seconds IS NULL)::integer AS unmeasured_calls,
    COALESCE(SUM(CASE WHEN duration_seconds IS NOT NULL
      THEN CEIL(duration_seconds::numeric/60) ELSE 0 END),0)::integer AS measured_rounded_minutes
    FROM ca_inbound_ai_usage_evidence
    WHERE company_id=$1
      AND call_started_at >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND call_started_at < (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month')`,[companyId]);
  return {
    calls:Number(result.rows[0].calls),
    measuredCalls:Number(result.rows[0].measured_calls),
    unmeasuredCalls:Number(result.rows[0].unmeasured_calls),
    measuredRoundedMinutes:Number(result.rows[0].measured_rounded_minutes),
    certifiedForBilling:false as const,
    includedMinutesActive:false as const,
  };
}
