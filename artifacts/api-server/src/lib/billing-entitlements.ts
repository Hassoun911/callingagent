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
    `SELECT s.status,p.included_numbers AS included_limit
      FROM ca_stripe_subscriptions s
      LEFT JOIN ca_plans p ON p.slug=s.plan_slug WHERE s.company_id=$1`, [companyId]
  );
  if (!subscription.rowCount) return null; // Existing legacy customers unaffected.
  const row=subscription.rows[0];
  if (!["active","trialing"].includes(String(row.status))) {
    return "This company's subscription is not active. Number purchases and new assignments are unavailable.";
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
