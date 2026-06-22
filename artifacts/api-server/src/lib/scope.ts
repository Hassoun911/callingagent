import type { Request } from "express";

/**
 * Returns the companyId to scope queries to for company_admin / company_user.
 * Returns null for super_admin (no restriction — sees all data).
 */
export function getCompanyScope(req: Request): number | null {
  const user = req.user;
  if (!user) return null;
  if (user.role === "company_admin" || user.role === "company_user") {
    return user.companyId ?? null;
  }
  return null;
}

/** True when the caller is a company-scoped user (not super_admin). */
export function isCompanyScoped(req: Request): boolean {
  const role = req.user?.role;
  return role === "company_admin" || role === "company_user";
}

/** True when the caller is a company_admin (can write within their company). */
export function isCompanyAdmin(req: Request): boolean {
  return req.user?.role === "company_admin";
}
