import type { Request } from "express";

const COMPANY_ROLES = new Set([
  "company_admin",
  "company_user",
  "company_read_only",
]);

/**
 * Returns the companyId to scope queries to for every company-level role.
 * Returns null for platform-level roles such as super_admin.
 */
export function getCompanyScope(req: Request): number | null {
  const user = req.user;
  if (!user) return null;
  if (COMPANY_ROLES.has(user.role)) {
    return user.companyId ?? null;
  }
  return null;
}

/** True when the caller belongs to a company rather than the platform. */
export function isCompanyScoped(req: Request): boolean {
  return COMPANY_ROLES.has(req.user?.role ?? "");
}

/** True when the caller can administer company-level configuration. */
export function isCompanyAdmin(req: Request): boolean {
  return req.user?.role === "company_admin";
}
