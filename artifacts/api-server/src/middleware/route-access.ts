import type { NextFunction, Request, Response } from "express";
import { hasPermission, type Permission } from "../lib/permissions";

interface RouteRule {
  prefix: string;
  read: Permission;
  write?: Permission;
}

const ROUTE_RULES: RouteRule[] = [
  { prefix: "/platform-users", read: "users.view", write: "users.manage" },
  { prefix: "/phone-numbers", read: "numbers.view", write: "numbers.manage" },
  { prefix: "/ai-voice", read: "ai.view", write: "ai.manage" },
  { prefix: "/campaigns", read: "campaigns.view", write: "campaigns.manage" },
  { prefix: "/call-logs", read: "calls.view", write: "calls.manage" },
  { prefix: "/contacts", read: "contacts.view", write: "contacts.manage" },
  { prefix: "/sms", read: "messages.view", write: "messages.reply" },
  { prefix: "/appointments", read: "bookings.view", write: "bookings.manage" },
  { prefix: "/booking", read: "bookings.view", write: "bookings.manage" },
  { prefix: "/companies", read: "companies.view", write: "companies.manage" },
  { prefix: "/costs", read: "billing.view" },
  { prefix: "/dashboard", read: "reports.view" },
  { prefix: "/extensions", read: "company.settings.view", write: "company.settings.manage" },
  { prefix: "/watches", read: "numbers.view", write: "numbers.manage" },
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function routeAccessControl(req: Request, res: Response, next: NextFunction): void {
  const rule = ROUTE_RULES.find(({ prefix }) => req.path === prefix || req.path.startsWith(`${prefix}/`));
  if (!rule) { next(); return; }
  if (!req.isAuthenticated?.() || !req.user) { res.status(401).json({ error: "Authentication required" }); return; }
  let permission = SAFE_METHODS.has(req.method) ? rule.read : (rule.write ?? rule.read);
  if (rule.prefix === "/call-logs" && req.path.includes("/recording")) permission = "calls.listen";
  if (!hasPermission(req.user.role, permission)) {
    res.status(403).json({ error: "You do not have permission to perform this action", requiredPermission: permission });
    return;
  }
  next();
}
