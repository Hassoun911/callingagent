import { pool } from "@workspace/db";

/**
 * Preflight for new number purchases/assignments.
 * Existing companies without Stripe subscription records are grandfathered:
 * do not disrupt current phone lines during the billing migration.
 *
 * This is NOT an atomic carrier inventory reservation; concurrent orders and
 * external carrier state still require reconciliation before billing certification.
 */
export async function newNumberAllowanceError(companyId: number, excludedPhoneId?: number): Promise<string | null> {
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return null;
  const subscription = await pool.query(
    `SELECT s.status,s.last_payment_status,p.included_numbers AS included_limit
      FROM ca_stripe_subscriptions s
      LEFT JOIN ca_plans p ON p.slug=s.plan_slug WHERE s.company_id=$1`, [companyId]
  );
  if (!subscription.rowCount) return null; // Existing legacy customers unaffected.
  const row=subscription.rows[0];
  // The CallingAgent live catalog does not currently offer a free trial.
  // An "active" Stripe flag by itself is not evidence that the first invoice paid.
  if (row.status !== "active" || row.last_payment_status !== "paid") {
    return "A verified active and paid subscription is required before adding another phone number.";
  }
  if (row.included_limit == null || Number(row.included_limit) < 1) {
    return "No verified number allowance was found for this subscription.";
  }
  const result=await pool.query(
    `SELECT COUNT(*)::integer AS assigned
       FROM phone_numbers WHERE company_id=$1 AND ($2::integer IS NULL OR id<>$2::integer)`,
    [companyId,excludedPhoneId ?? null]
  );
  if (Number(result.rows[0].assigned) >= Number(row.included_limit)) {
    return "This subscription's phone-number allowance has been reached. Upgrade the plan before adding another line.";
  }
  return null;
}
