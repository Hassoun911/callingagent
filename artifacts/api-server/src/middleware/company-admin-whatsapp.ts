import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { companiesTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

function normalizeNorthAmericanPhone(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  let digits = String(value).replace(/^whatsapp:/i, "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) throw new Error("Enter a valid 10-digit Canadian or US WhatsApp number");
  return `+1${digits}`;
}

/**
 * The legacy AI config is platform-wide, but the portal notification editor is
 * shown to company admins. Mirror only the notification recipient into the
 * authenticated company's tenant record so post-call alerts remain isolated.
 */
export async function companyAdminWhatsappSync(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method !== "PATCH" || req.path !== "/ai-voice/config" || !("adminNotifyPhone" in (req.body ?? {}))) {
    next();
    return;
  }

  const companyId = Number(req.user?.companyId);
  if (req.user?.role !== "company_admin" || !Number.isInteger(companyId) || companyId <= 0) {
    next();
    return;
  }

  try {
    const adminWhatsapp = normalizeNorthAmericanPhone(req.body.adminNotifyPhone);
    await db.update(companiesTable)
      .set({ adminWhatsapp })
      .where(eq(companiesTable.id, companyId));
    logger.info({ companyId, adminWhatsapp }, "Updated company-specific admin WhatsApp recipient");
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Invalid WhatsApp number" });
    return;
  }

  next();
}
