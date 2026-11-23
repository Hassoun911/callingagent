/**
 * Pure, fail-closed checks for the Stripe invoice event that grants a paid
 * entitlement. Stripe webhooks are signed, but a legitimate old invoice must
 * not pay for a newly selected package.
 */
export function verifiedCurrentPaidInvoice(
  invoice: any, subscription: any, subscriptionId: string,
  expectedPriceId: string,
): boolean {
  if (!invoice || invoice.livemode !== true ||
      invoice.paid !== true || invoice.status !== "paid" ||
      !subscription || subscription.livemode !== true ||
      subscription.id !== subscriptionId || subscription.status !== "active") return false;

  const parentSubscription = typeof invoice.subscription === "string"
    ? invoice.subscription : invoice.parent?.subscription_details?.subscription;
  if (parentSubscription !== subscriptionId) return false;

  const latest = typeof subscription.latest_invoice === "string"
    ? subscription.latest_invoice : subscription.latest_invoice?.id;
  if (latest !== invoice.id) return false;

  const items = subscription.items?.data;
  if (!Array.isArray(items) || items.length !== 1 ||
      items[0]?.price?.id !== expectedPriceId) return false;

  // Subscription may change plan while an older invoice payment is in flight.
  // An invoice's price must match the CURRENT verified subscription price.
  const lines = invoice.lines?.data;
  if (!Array.isArray(lines) || !lines.length) return false;
  return lines.some((line:any) => {
    const price = line?.pricing?.price_details?.price ||
      line?.price?.id || line?.plan?.id;
    return price === expectedPriceId;
  });
}
