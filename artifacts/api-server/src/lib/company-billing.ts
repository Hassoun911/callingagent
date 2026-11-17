/**
 * Company billing domain rules.
 * All prices/allowances must come from persisted package/subscription records.
 * Provider costs are NEVER customer invoices and incomplete evidence is not billable.
 */
export type Meter = "calls" | "minutes" | "sms" | "aiMinutes" | "phoneNumbers";
export type Money = { amountMinor: number; currency: string };
export type Allowance = { included: number; hardLimit: number | null; overagePriceMinor: number | null };
export type PackageTerms = {
  packageId: string; version: string; monthlyPrice: Money;
  allowances: Record<Meter, Allowance>;
};
export type Subscription = {
  companyId: number; packageId: string; packageVersion: string;
  status: "active" | "trialing" | "past_due" | "suspended" | "cancelled";
  periodStart: string; periodEnd: string;
};
export type Usage = { companyId: number; meter: Meter; quantity: number; eventId: string; occurredAt: string };
export type MeterResult = {
  used: number; included: number; overageUnits: number; overageChargeMinor: number | null;
  remaining: number | null; limitReached: boolean; billable: boolean;
};
export function calculateCompanyMeters(
  subscription: Subscription, terms: PackageTerms, events: Usage[],
  options: { complete: boolean; now: string }
): Record<Meter, MeterResult> {
  if (subscription.packageId !== terms.packageId || subscription.packageVersion !== terms.version)
    throw new Error("Subscription package version mismatch");
  if (!Number.isInteger(subscription.companyId) || subscription.companyId <= 0)
    throw new Error("Invalid company");
  if (!(subscription.periodStart < subscription.periodEnd)) throw new Error("Invalid billing period");
  const meters = Object.keys(terms.allowances) as Meter[];
  const unique = new Set<string>();
  const usage = Object.fromEntries(meters.map(m => [m, 0])) as Record<Meter, number>;
  for (const e of events) {
    if (e.companyId !== subscription.companyId) throw new Error("Cross-company usage in billing calculation");
    if (!meters.includes(e.meter) || !e.eventId || !Number.isFinite(e.quantity) || e.quantity < 0)
      throw new Error("Invalid usage event");
    if (e.occurredAt < subscription.periodStart || e.occurredAt >= subscription.periodEnd) continue;
    const key = e.meter + ":" + e.eventId;
    if (unique.has(key)) continue;
    unique.add(key);
    usage[e.meter] += e.quantity;
  }
  return Object.fromEntries(meters.map(meter => {
    const allowance = terms.allowances[meter];
    if (![allowance.included, allowance.hardLimit, allowance.overagePriceMinor].every(
      v => v === null || (Number.isFinite(v) && v >= 0)
    )) throw new Error("Invalid package allowance");
    const used = usage[meter];
    const overageUnits = Math.max(0, used - allowance.included);
    const billable = options.complete && subscription.status === "active";
    return [meter, {
      used, included: allowance.included, overageUnits,
      overageChargeMinor: billable && allowance.overagePriceMinor !== null
        ? Math.round(overageUnits * allowance.overagePriceMinor) : null,
      remaining: allowance.hardLimit === null ? null : Math.max(0, allowance.hardLimit - used),
      limitReached: allowance.hardLimit !== null && used >= allowance.hardLimit,
      billable
    }];
  })) as Record<Meter, MeterResult>;
}
export function canConsumeMeter(
  subscription: Subscription, terms: PackageTerms, meter: Meter,
  used: number, requested: number
): { allowed: boolean; reason?: string } {
  if (!["active", "trialing"].includes(subscription.status)) return { allowed: false, reason: "Subscription inactive" };
  if (subscription.packageId !== terms.packageId || subscription.packageVersion !== terms.version)
    return { allowed: false, reason: "Package mismatch" };
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(used) || used < 0)
    return { allowed: false, reason: "Invalid quantity" };
  const limit = terms.allowances[meter]?.hardLimit;
  if (limit === undefined) return { allowed: false, reason: "Meter not in package" };
  if (limit !== null && used + requested > limit) return { allowed: false, reason: "Package hard limit reached" };
  return { allowed: true };
}
