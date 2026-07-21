import { Router, type IRouter, type Request, type Response } from "express";
import { db, platformUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyScope } from "../lib/scope";
import { requireAuthenticated, requirePermission } from "../lib/permissions";
import {
  ListPlatformUsersQueryParams,
  CreatePlatformUserBody,
  UpdatePlatformUserParams,
  UpdatePlatformUserBody,
  DeletePlatformUserParams,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/password";

const router: IRouter = Router();
const COMPANY_ASSIGNABLE_ROLES = new Set(["company_user", "company_read_only"]);

function serializeUser(u: typeof platformUsersTable.$inferSelect) {
  return {
    id: u.id,
    username: u.username,
    email: u.email ?? null,
    role: u.role,
    companyId: u.companyId ?? null,
    isActive: u.isActive,
    createdAt: u.createdAt.toISOString(),
  };
}

router.get("/platform-users", requireAuthenticated, async (req: Request, res: Response): Promise<void> => {
  const query = ListPlatformUsersQueryParams.safeParse(req.query);

  const scopedCompanyId = getCompanyScope(req);
  const conditions = [];
  if (scopedCompanyId !== null) {
    conditions.push(eq(platformUsersTable.companyId, scopedCompanyId));
  } else if (query.success && query.data.companyId != null) {
    conditions.push(eq(platformUsersTable.companyId, query.data.companyId));
  }
  const users = conditions.length
    ? await db.select().from(platformUsersTable).where(and(...conditions))
    : await db.select().from(platformUsersTable);
  res.json(users.map(serializeUser));
});

router.post("/platform-users", requirePermission("users.manage"), async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePlatformUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  const scopedCompanyId = getCompanyScope(req);
  const { username, email, password, role, companyId } = parsed.data;
  const requestedRole = String(role);

  if (scopedCompanyId !== null && !COMPANY_ASSIGNABLE_ROLES.has(requestedRole)) {
    res.status(403).json({ error: "Company admins may only create company_user or company_read_only accounts" });
    return;
  }

  const effectiveCompanyId = scopedCompanyId !== null ? scopedCompanyId : (companyId ?? null);
  if (requestedRole !== "super_admin" && effectiveCompanyId === null) {
    res.status(400).json({ error: "A company must be selected for company accounts" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(platformUsersTable)
    .values({ username, email: email ?? null, passwordHash, role, companyId: effectiveCompanyId })
    .returning();
  res.status(201).json(serializeUser(user));
});

router.patch("/platform-users/:id", requirePermission("users.manage"), async (req: Request, res: Response): Promise<void> => {
  const params = UpdatePlatformUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdatePlatformUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const scopedCompanyId = getCompanyScope(req);
  const [existing] = await db.select().from(platformUsersTable).where(eq(platformUsersTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  if (scopedCompanyId !== null) {
    if (existing.companyId !== scopedCompanyId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if (parsed.data.role !== undefined && !COMPANY_ASSIGNABLE_ROLES.has(String(parsed.data.role))) {
      res.status(403).json({ error: "Company admins may only assign company_user or company_read_only roles" });
      return;
    }
  }

  const { username, email, password, role, isActive } = parsed.data;
  const updates: Partial<typeof platformUsersTable.$inferInsert> = {};
  if (username !== undefined) updates.username = username;
  if (email !== undefined) updates.email = email ?? null;
  if (role !== undefined) updates.role = role;
  if (isActive !== undefined) updates.isActive = isActive;
  if (password) updates.passwordHash = await hashPassword(password);

  const [updated] = await db
    .update(platformUsersTable)
    .set(updates)
    .where(eq(platformUsersTable.id, params.data.id))
    .returning();
  res.json(serializeUser(updated));
});

router.delete("/platform-users/:id", requirePermission("users.manage"), async (req: Request, res: Response): Promise<void> => {
  const params = DeletePlatformUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  const scopedCompanyId = getCompanyScope(req);
  const [existing] = await db.select().from(platformUsersTable).where(eq(platformUsersTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "User not found" }); return; }

  if (scopedCompanyId !== null && existing.companyId !== scopedCompanyId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (existing.id.toString() === req.user?.id) {
    res.status(400).json({ error: "You cannot delete your own account" });
    return;
  }

  await db.delete(platformUsersTable).where(eq(platformUsersTable.id, params.data.id));
  res.json({ ok: true });
});

export default router;
