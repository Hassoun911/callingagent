import type { Request, Response, NextFunction } from "express";

export type PlatformRole =
  | "super_admin"
  | "company_admin"
  | "company_user"
  | "company_read_only";

export type Permission =
  | "companies.manage"
  | "users.manage"
  | "numbers.manage"
  | "ai.manage"
  | "campaigns.manage"
  | "calls.view"
  | "calls.listen"
  | "contacts.view"
  | "contacts.manage"
  | "messages.view"
  | "messages.reply"
  | "bookings.view"
  | "bookings.manage"
  | "billing.view";

const ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<Permission> | "*"> = {
  super_admin: "*",
  company_admin: new Set<Permission>([
    "users.manage",
    "numbers.manage",
    "ai.manage",
    "campaigns.manage",
    "calls.view",
    "calls.listen",
    "contacts.view",
    "contacts.manage",
    "messages.view",
    "messages.reply",
    "bookings.view",
    "bookings.manage",
    "billing.view",
  ]),
  company_user: new Set<Permission>([
    "calls.view",
    "calls.listen",
    "contacts.view",
    "messages.view",
    "messages.reply",
    "bookings.view",
    "bookings.manage",
  ]),
  company_read_only: new Set<Permission>([
    "calls.view",
    "calls.listen",
    "contacts.view",
    "messages.view",
    "bookings.view",
  ]),
};

export function normalizeRole(role?: string | null): PlatformRole {
  if (role === "super_admin" || role === "company_admin" || role === "company_user" || role === "company_read_only") {
    return role;
  }
  return "company_user";
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
