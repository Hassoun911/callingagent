import { pool } from "@workspace/db";

/**
 * AI credit wallet groundwork. Credits are denominated in CAD cents, not
 * AI tokens or minutes. Only provider-verified billable events may eventually
 * debit this wallet. No unverified payments are credited automatically.
 *
 * Production AI usage remains gated until each entrypoint is instrumented and
 * measured provider costs can be converted into validated CAD debits.
 */
export const AI_CREDITS_LAUNCH_READY = false as const;

export type AiOffer = "phone_pro" | "standalone_ai" | "phone_addon" | "not_eligible";

export function aiOfferForPlan(slug: string | null, standalone = false): AiOffer {
  if (standalone) return "standalone_ai";
  if (slug === "pro") return "phone_pro";
  if (slug === "business" || slug === "plus") return "phone_addon";
  return "not_eligible";
}

export function validatedCreditCents(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000)
    throw new Error("AI credit value must be a valid non-negative CAD-cent amount");
  return value;
}

export async function ensureAiCreditSchema(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS ca_ai_credit_entries (
    id bigserial PRIMARY KEY,
    company_id integer NOT NULL REFERENCES companies(id),
    event_key text UNIQUE NOT NULL CHECK(length(event_key) BETWEEN 8 AND 180),
    amount_cents integer NOT NULL CHECK (amount_cents <> 0),
    source text NOT NULL CHECK(source IN ('stripe_credit_purchase','verified_ai_usage','pro_monthly_included','adjustment')),
    provider_evidence text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((source = 'verified_ai_usage' AND amount_cents < 0 AND provider_evidence IS NOT NULL)
       OR (source <> 'verified_ai_usage' AND amount_cents > 0))
  )`);
  await pool.query("CREATE INDEX IF NOT EXISTS ca_ai_credit_entries_company_idx ON ca_ai_credit_entries(company_id,created_at DESC)");
}

/** Read-only. Never call the wallet an actual AI entitlement when not certified. */
export async function readAiCreditBalance(companyId: number): Promise<number> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("Invalid company id");
  const result = await pool.query<{ balance: string }>(
    "SELECT COALESCE(SUM(amount_cents),0)::text AS balance FROM ca_ai_credit_entries WHERE company_id=$1",
    [companyId],
  );
  return Number(result.rows[0]?.balance || 0);
}

/**
 * Atomic, per-company wallet debit. This function is intentionally unused
 * until signed provider usage records can be tied to each AI operation.
 * The caller must use a verified provider event reference; never estimate.
 * Duplicate event IDs are idempotent. Missing funds are a hard denial.
 */
export async function debitVerifiedAiUsage(
  companyId: number, chargeCents: number, uniqueEventKey: string,
  providerEvidence: string,
): Promise<{ debited: boolean; balanceCents: number }> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) throw new Error("Invalid company id");
  if (!Number.isSafeInteger(chargeCents) || chargeCents <= 0 || chargeCents > 1_000_000)
    throw new Error("Invalid positive charge");
  if (!/^[A-Za-z0-9:_-]{8,180}$/.test(uniqueEventKey) ||
    !providerEvidence || providerEvidence.length > 500) throw new Error("Verified AI usage evidence required");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize all wallet mutations for this company, including concurrent workers.
    await client.query("SELECT pg_advisory_xact_lock($1,$2)",[714092,companyId]);
    const prior = await client.query(
      "SELECT amount_cents,company_id FROM ca_ai_credit_entries WHERE event_key=$1",[uniqueEventKey],
    );
    if (prior.rowCount) {
      if (Number(prior.rows[0].company_id) !== companyId ||
        Number(prior.rows[0].amount_cents) !== -chargeCents) throw new Error("Conflicting AI usage event");
      const value = await client.query(
        "SELECT COALESCE(SUM(amount_cents),0)::integer AS balance FROM ca_ai_credit_entries WHERE company_id=$1",[companyId],
      );
      await client.query("COMMIT");
      return { debited: false, balanceCents:Number(value.rows[0].balance) };
    }
    const result = await client.query(
      "SELECT COALESCE(SUM(amount_cents),0)::integer AS balance FROM ca_ai_credit_entries WHERE company_id=$1",[companyId],
    );
    const current = Number(result.rows[0].balance);
    if (current < chargeCents) throw new Error("Insufficient verified AI credit");
    await client.query(
      "INSERT INTO ca_ai_credit_entries(company_id,event_key,amount_cents,source,provider_evidence) VALUES($1,$2,$3,'verified_ai_usage',$4)",
      [companyId,uniqueEventKey,-chargeCents,providerEvidence],
    );
    await client.query("COMMIT");
    return { debited:true,balanceCents:current-chargeCents };
  } catch (error) {
    await client.query("ROLLBACK").catch(()=>{});
    throw error;
  } finally { client.release(); }
}
