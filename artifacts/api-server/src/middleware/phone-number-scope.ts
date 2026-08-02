import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, phoneNumbersTable } from "@workspace/db";
import { getCompanyScope } from "../lib/scope";

const ID_ROUTE = /^\/phone-numbers\/(\d+)(?:\/|$)/;

/**
 * Enforces record-level tenant isolation for every phone-number endpoint.
 * Route permission checks answer whether a role may use the feature; this
 * guard answers whether the requested phone number belongs to that company.
 */
export async function phoneNumberScopeGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!req.path.startsWith("/phone-numbers")) {
    next();
    return;
  }

  const companyId = getCompanyScope(req);
  if (companyId === null) {
    next();
    return;
  }

  // Importing an existing account-wide Twilio number requires a platform admin
  // until the import handler can assign and validate a destination company.
  if (req.method === "POST" && req.path === "/phone-numbers/import") {
    res.status(403).json({ error: "Only a platform administrator can import an existing Twilio number." });
    return;
  }

  // Company users may provision numbers only for their own company, even if a
  // different companyId is supplied by a modified client request.
  if (req.method === "POST" && req.path === "/phone-numbers") {
    req.body = { ...(req.body ?? {}), companyId };
    next();
    return;
  }

  // Company users may not transfer a phone number to another company.
  if (req.method === "PATCH") {
    req.body = { ...(req.body ?? {}) };
    delete req.body.companyId;
  }

  const match = ID_ROUTE.exec(req.path);
  if (!match) {
    next();
    return;
  }

  const id = Number(match[1]);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid phone number id" });
    return;
  }

  const [number] = await db
    .select({ id: phoneNumbersTable.id, companyId: phoneNumbersTable.companyId })
    .from(phoneNumbersTable)
    .where(eq(phoneNumbersTable.id, id));

  // Return 404 for both missing and out-of-scope records to avoid leaking IDs.
  if (!number || number.companyId !== companyId) {
    res.status(404).json({ error: "Phone number not found" });
    return;
  }

  next();
}
