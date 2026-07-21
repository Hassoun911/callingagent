import type { Request, Response, NextFunction } from "express";

export type PlatformRole =
  | "super_admin"
  | "company_admin"
  | "company_user"
  | "company_read_only";

export type Permission =
  | "companies.view"
  | "companies.manage"
  | "users.view"
  | "users.manage"
  | "numbers.view"
  | "numbers.manage"
  | "ai.view"
  | "ai.manage"
  | "campaigns.view"
  | "campaigns.manage"
  | "calls.view"
  | "calls.listen"
  | "calls.manage"
  | "contacts.view"
  | "contacts.manage"
  | "leads.view"
  | "leads.manage"
  | "messages.view"
  | "messages.reply"
  | "bookings.view"
  | "bookings.manage"
  | "billing.view"
  | "reports.view"
  | "company.settings.view"
  | "company.settings.manage"
  | "audit.view";

const ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<Permission> | "*"> = {
  // Platform owner: unrestricted access across every company.
  super_admin: "*",

  // Company administrator: full control inside their own company only.
  company_admin: new Set<Permission>([
    "companies.view",
    "users.view",
    "users.manage",
    "numbers.view",
    "numbers.manage",
    "ai.view",
    "ai.manage",
    "campaigns.view",
    "campaigns.manage",
    "calls.view",
    "calls.listen",
    "calls.manage",
    "contacts.view",
    "contacts.manage",
    "leads.view",
    "leads.manage",
    "messages.view",
    "messages.reply",
    "bookings.view",
    "bookings.manage",
    "billing.view",
    "reports.view",
    "company.settings.view",
    "company.settings.manage",
    "audit.view",
  ]),

  // Operational employee: may work with day-to-day customer activity, but cannot
  // alter phone routing, AI configuration, campaigns, billing, users, or company setup.
  company_user: new Set<Permission>([
    "companies.view",
    "numbers.view",
    "campaigns.view",
    "calls.view",
    "calls.listen",
    "contacts.view",
    "contacts.manage",
    "leads.view",
    "leads.manage",
    "messages.view",
    "messages.reply",
    "bookings.view",
    "bookings.manage",
    "reports.view",
    "company.settings.view",
  ]),

  // Read-only employee: may inspect operational information without changing it.
  company_read_only: new Set<Permission>([
    "companies.view",
    "numbers.view",
    "campaigns.view",
    "calls.view",
    "calls.listen",
    "contacts.view",
    "leads.view",
    "messages.view",
    "bookings.view",
    "reports.view",
    "company.settings.view",
  ]),
};

export function normalizeRole(role?: string | null): PlatformRole {
  if (role === "super_admin" || role === "company_admin" || role === "company_user" || role === "company_read_only") {
    return role;
  }
  return "company_user";
}

export function getPermissionsForRole(role?: string | null): Permission[] | ["*"] {
  const permissions = ROLE_PERMISSIONS[normalizeRole(role)];
  return permissions === "*" ? ["*"] : Array.from(permissions);
}

export function hasPermission(role: string | null | undefined, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[normalizeRole(role)];
  return permissions === "*" || permissions.has(permission);
}

export function requireAuthenticated(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.isAuthenticated?.() || !req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!hasPermission(req.user.role, permission)) {
      res.status(403).json({ error: "You do not have permission to perform this action" });
      return;
    }
    next();
  };
}
