import { ensureTwilioReconciliationTables, persistTwilioPage, readTwilioCheckpoint, type TwilioResource, type ReconciliationRow } from "./twilio-reconciliation-store";

/**
 * Explicitly invoked reconciliation worker. Do not call this from a billing
 * dashboard request. It persists at most maxPages per invocation, then resumes.
 * It does not produce invoices or bill customers.
 */
export async function reconcileTwilioBatch(args: {
  accountSid: string;
  authToken: string;
  month: string;
  resource: TwilioResource;
  maxPages?: number;
}): Promise<{ complete: boolean; pages: number; records: number }> {
  const { accountSid, authToken, month, resource } = args;
  if (!/^AC[a-fA-F0-9]{32}$/.test(accountSid)) throw new Error("Invalid Twilio account SID");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid billing month");
  const maxPages = Number.isFinite(args.maxPages) ? Math.max(1, Math.min(10, Math.floor(args.maxPages!))) : 3;
  await ensureTwilioReconciliationTables();
  const checkpoint = await readTwilioCheckpoint(accountSid, month, resource);
  if (checkpoint?.status === "complete") return { complete: true, pages: 0, records: 0 };
  const [year, mm] = month.split("-").map(Number);
  const start = month + "-01";
  const end = new Date(Date.UTC(year, mm, 0)).toISOString().slice(0, 10);
  const dateField = resource === "Calls" ? "StartTime" : "DateSent";
  const basePath = `/2010-04-01/Accounts/${accountSid}/${resource}.json`;
  let next: string | null = checkpoint?.next_page_uri ??
    `https://api.twilio.com${basePath}?PageSize=1000`;
  const visited = new Set<string>();
  let pages = 0, records = 0;
  while (next && pages < maxPages) {
    const url = new URL(next, "https://api.twilio.com");
    if (url.protocol !== "https:" || url.hostname !== "api.twilio.com" || url.pathname !== basePath)
      throw new Error("Invalid Twilio page URL");
    url.searchParams.set(dateField + ">=", start);
    url.searchParams.set(dateField + "<=", end);
    const canonical = url.toString();
    if (visited.has(canonical)) throw new Error("Repeated Twilio page URL");
    visited.add(canonical);
    const response = await fetch(canonical, {
      headers: { Authorization: "Basic " + Buffer.from(accountSid + ":" + authToken).toString("base64") },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("Twilio request failed: " + response.status);
    const payload: any = await response.json();
    const items = resource === "Calls" ? payload.calls : payload.messages;
    if (!Array.isArray(items)) throw new Error("Malformed Twilio response");
    const rows: ReconciliationRow[] = items.map((item: any) => ({
      sid: String(item.sid ?? ""),
      timestamp: String(resource === "Calls" ? item.start_time ?? "" : item.date_sent ?? item.date_created ?? ""),
      from: item.from == null ? null : String(item.from),
      to: item.to == null ? null : String(item.to),
      price: item.price == null ? null : String(item.price),
      currency: item.price_unit == null ? null : String(item.price_unit).toUpperCase(),
    }));
    const continuation = payload.next_page_uri ?
      new URL(String(payload.next_page_uri), "https://api.twilio.com").toString() : null;
    if (continuation) {\n      const nextUrl = new URL(continuation);\n      if (nextUrl.protocol !== "https:" || nextUrl.hostname !== "api.twilio.com" || nextUrl.pathname !== basePath)\n        throw new Error("Invalid Twilio continuation URL");\n      nextUrl.searchParams.set(dateField + ">=", start);\n      nextUrl.searchParams.set(dateField + "<=", end);\n      if (nextUrl.toString() === canonical) throw new Error("Twilio continuation repeats current page");\n    }
    await persistTwilioPage({ accountSid, month, resource, rows, nextPageUri: continuation });
    records += rows.length;
    pages++;
    next = continuation;
  }
  return { complete: next === null, pages, records };
}
