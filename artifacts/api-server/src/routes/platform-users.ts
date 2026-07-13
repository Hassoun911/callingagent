import { Router, type IRouter, type Request, type Response } from "express";
import { db, platformUsersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyScope, isCompanyScoped } from "../lib/scope";
import {
  ListPlatformUsersQueryParams,
  CreatePlatformUserBody,
  UpdatePlatformUserParams,
  UpdatePlatformUserBody,
  DeletePlatformUserParams,
} from "@workspace/api-zod";
import { hashPassword } from "../lib/password";

const router: IRouter = Router();

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

router.get("/platform-users", async (req: Request, res: Response): Promise<void> => {
  const query = ListPlatformUsersQueryParams.safeParse(req.query);

  // Company-scoped users can only see their own company's users
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

router.post("/platform-users", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreatePlatformUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    return;
  }

  // Company-scoped users can only create users within their own company
  const scopedCompanyId = getCompanyScope(req);
  const { username, email, password, role, companyId } = parsed.data;
  const effectiveCompanyId = scopedCompanyId !== null ? scopedCompanyId : (companyId ?? null);
  if (scopedCompanyId !== null && (role as string) === "super_admin") {
    res.status(403).json({ error: "Cannot create super_admin accounts" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db
    .insert(platformUsersTable)
    .values({ username, email: email ?? null, passwordHash, role, companyId: effectiveCompanyId })
    .returning();
  res.status(201).json(serializeUser(user));
});

router.patch("/platform-users/:id", async (req: Request, res: Response): Promise<void> => {
  const params = UpdatePlatformUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }
  const parsed = UpdatePlatformUserBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid input" }); return; }

  // Company-scoped users can only modify users in their own company
  const scopedCompanyId = getCompanyScope(req);
  if (scopedCompanyId !== null) {
    const [existing] = await db.select().from(platformUsersTable).where(eq(platformUsersTable.id, params.data.id));
    if (!existing || existing.companyId !== scopedCompanyId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    if ((parsed.data.role as string) === "super_admin") {
      res.status(403).json({ error: "Cannot assign super_admin role" });
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
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json(serializeUser(updated));
});

router.delete("/platform-users/:id", async (req: Request, res: Response): Promise<void> => {
  const params = DeletePlatformUserParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Invalid id" }); return; }

  // Company-scoped users can only delete users in their own company
  const scopedCompanyId = getCompanyScope(req);
  if (scopedCompanyId !== null) {
    const [existing] = await db.select().from(platformUsersTable).where(eq(platformUsersTable.id, params.data.id));
    if (!existing || existing.companyId !== scopedCompanyId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  await db.delete(platformUsersTable).where(eq(platformUsersTable.id, params.data.id));
  res.json({ ok: true });
});

export default router;
