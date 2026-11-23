import { createHash } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "./logger";

/**
 * Telnyx outbound Call Control admission counter.
 *
 * This is intentionally an ATTEMPT ledger, not a carrier-accepted CPS or
 * invoice calculator. It sees starts made by CallingAgent only; it cannot
 * observe calls placed directly in Telnyx or other API-key integrations.
 *
 * OFF (default): no checks or DB writes on call attempts.
 * OBSERVE: record and warn, without changing voice behavior.
 * ENFORCE: reject excess initial user-initiated click-to-call starts only;
 *          ongoing click-to-call second legs and inbound-call forwarding stay
 *          available and are warned, so accepted callers are not stranded.
 *
 * Configure TELNYX_CPS_ACCOUNT_KEY consistently for every worker/connection
 * belonging to the same Telnyx account. If absent, the same API key hashes
 * to the same scope. A different API key requires a shared account key.
 */
export type OutboundKind = "click_to_call" | "click_to_call_followup" | "forwarding";
export type CpsMode = "off" | "observe" | "enforce";

export class TelnyxCpsLimitError extends Error {
  readonly code = "TELNYX_CPS_LIMIT";
  constructor() {
    super("Outbound call capacity is busy. Please try again shortly.");
    this.name = "TelnyxCpsLimitError";
  }
}

export function readTelnyxCpsConfig(env: NodeJS.ProcessEnv = process.env): {
  mode: CpsMode; maxStarts: number;
} {
  const value = env.TELNYX_CPS_MODE?.trim().toLowerCase();
  const mode: CpsMode = value === "observe" || value === "enforce" ? value : "off";
  const parsed = Number(env.TELNYX_CPS_MAX_STARTS ?? "5");
  // The currently announced Telnyx no-surcharge band is 5 CPS. Refuse
  // unsafe higher configuration values instead of silently widening it.
  const maxStarts = Number.isSafeInteger(parsed) && parsed >= 1
    ? Math.min(parsed, 5) : 5;
  return { mode, maxStarts };
}

function accountScope(env: NodeJS.ProcessEnv): string {
  const explicit = env.TELNYX_CPS_ACCOUNT_KEY?.trim();
  const apiKey = env.TELNYX_API_KEY?.trim();
  const key = explicit || apiKey;
  if (!key) throw new Error("Cannot identify the Telnyx CPS account scope");
  // The database never stores raw API tokens or account keys.
  return createHash("sha256").update(key).digest("hex");
}

export async function ensureTelnyxCpsSchema(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ca_telnyx_outbound_cps_seconds (
      account_hash text NOT NULL,
      bucket_second timestamptz NOT NULL,
      attempts integer NOT NULL DEFAULT 0,
      forwarding_attempts integer NOT NULL DEFAULT 0,
      click_attempts integer NOT NULL DEFAULT 0,
      PRIMARY KEY (account_hash, bucket_second)
    )`);
}

export async function getTelnyxCpsRecentHours(hours = 24): Promise<{
  mode: CpsMode;
  maxStarts: number;
  source: "callingagent_outbound_attempts_not_provider_accepted";
  hours: Array<{ hour: string; peakAttemptsInSecond: number; totalAttempts: number; forwardingAttempts: number; clickAttempts: number }>;
}> {
  const { mode, maxStarts } = readTelnyxCpsConfig();
  const safeHours = Number.isSafeInteger(hours) ? Math.max(1, Math.min(hours, 720)) : 24;
  const accountHash = accountScope(process.env);
  const result = await pool.query<{
    hour: Date;
    peak_attempts: number | string;
    total_attempts: number | string;
    forwarding_attempts: number | string;
    click_attempts: number | string;
  }>(`SELECT date_trunc('hour', bucket_second) AS hour,
      MAX(attempts) AS peak_attempts,
      SUM(attempts) AS total_attempts,
      SUM(forwarding_attempts) AS forwarding_attempts,
      SUM(click_attempts) AS click_attempts
    FROM ca_telnyx_outbound_cps_seconds
    WHERE account_hash=$1 AND bucket_second >= now() - ($2::integer * interval '1 hour')
    GROUP BY 1 ORDER BY 1 DESC`, [accountHash, safeHours]);
  return {
    mode, maxStarts, source: "callingagent_outbound_attempts_not_provider_accepted",
    hours: result.rows.map(r => ({
      hour: new Date(r.hour).toISOString(),
      peakAttemptsInSecond: Number(r.peak_attempts),
      totalAttempts: Number(r.total_attempts),
      forwardingAttempts: Number(r.forwarding_attempts),
      clickAttempts: Number(r.click_attempts),
    })),
  };
}

export async function recordTelnyxOutboundStart(
  kind: OutboundKind,
): Promise<void> {
  const { mode, maxStarts } = readTelnyxCpsConfig();
  if (mode === "off") return;

  let count: number;
  try {
    const scope = accountScope(process.env);
    // PostgreSQL chooses the second and serializes cross-instance increments
    // via the unique constraint / ON CONFLICT row lock. A process-local Map
    // would not protect a scaled Render service.
    const outcome = await pool.query<{
      attempts: number;
      bucket_second: Date;
    }>(`INSERT INTO ca_telnyx_outbound_cps_seconds
      (account_hash, bucket_second, attempts, forwarding_attempts, click_attempts)
      VALUES ($1, date_trunc('second', clock_timestamp()), 1, $2, $3)
      ON CONFLICT (account_hash, bucket_second)
      DO UPDATE SET
        attempts=ca_telnyx_outbound_cps_seconds.attempts+1,
        forwarding_attempts=ca_telnyx_outbound_cps_seconds.forwarding_attempts+EXCLUDED.forwarding_attempts,
        click_attempts=ca_telnyx_outbound_cps_seconds.click_attempts+EXCLUDED.click_attempts
      RETURNING attempts, bucket_second`,
    [scope, kind === "forwarding" ? 1 : 0, kind === "forwarding" ? 0 : 1]);
    count = Number(outcome.rows[0]?.attempts);
    if (!Number.isSafeInteger(count)) throw new Error("Invalid CPS ledger count");
  } catch (error) {
    logger.error({ kind, err: error }, "Telnyx outbound CPS ledger unavailable");
    // When explicitly enforcing, never substitute an unsafe in-memory
    // allowance for click-to-call. Forwarding remains fail-open to avoid
    // silently dropping incoming callers during DB incidents.
    if (mode === "enforce" && kind === "click_to_call")
      throw new TelnyxCpsLimitError();
    return;
  }

  if (count > maxStarts) {
    logger.warn({ kind, mode, attemptsInSecond: count, maxStarts },
      "Telnyx outbound attempt CPS threshold exceeded");
    // This counts attempts; rejected / failed attempts do not necessarily
    // contribute to the Telnyx billed CPS value.
    if (mode === "enforce" && kind === "click_to_call")
      throw new TelnyxCpsLimitError();
  }
}
