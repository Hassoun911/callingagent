import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, platformUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";
import { verifyPassword } from "../lib/password";

const router: IRouter = Router();

function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a);
    const bBuf = Buffer.from(b);
    if (aBuf.length !== bBuf.length) {
      crypto.timingSafeEqual(aBuf, aBuf);
      return false;
    }
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

router.get("/auth/user", (req: Request, res: Response) => {
  res.json({ user: req.isAuthenticated() ? req.user : null });
});

router.post("/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password, companyId: requiredCompanyId } = req.body ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password required." });
    return;
  }

  // 1. Check platform_users table first
  const [platformUser] = await db
    .select()
    .from(platformUsersTable)
    .where(eq(platformUsersTable.username, username));

  if (platformUser) {
    if (!platformUser.isActive) {
      await new Promise(r => setTimeout(r, 500));
      res.status(401).json({ error: "Account is disabled." });
      return;
    }
    const valid = await verifyPassword(password, platformUser.passwordHash);
    if (!valid) {
      await new Promise(r => setTimeout(r, 500));
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    if (requiredCompanyId !== undefined && requiredCompanyId !== null) {
      const required = parseInt(String(requiredCompanyId), 10);
      if (!isNaN(required) && platformUser.companyId !== required) {
        await new Promise(r => setTimeout(r, 500));
        res.status(403).json({ error: "This account does not belong to this company's portal." });
        return;
      }
    }
    const sessionData: SessionData = {
      user: {
        id: platformUser.id.toString(),
        email: platformUser.email ?? null,
        firstName: platformUser.username,
        lastName: null,
        profileImageUrl: null,
        role: platformUser.role as "company_admin" | "company_user",
        companyId: platformUser.companyId ?? null,
      },
      access_token: crypto.randomBytes(16).toString("hex"),
    };
    const sid = await createSession(sessionData);
    setSessionCookie(res, sid);
    res.json({ ok: true, role: platformUser.role, companyId: platformUser.companyId ?? null });
    return;
  }

  // 2. Fall back to env-var super admin
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    res.status(503).json({ error: "Auth not configured — set ADMIN_USERNAME and ADMIN_PASSWORD secrets." });
    return;
  }

  const valid =
    timingSafeEqual(username, adminUsername) &&
    timingSafeEqual(password, adminPassword);

  if (!valid) {
    await new Promise(r => setTimeout(r, 500));
    res.status(401).json({ error: "Invalid username or password." });
    return;
  }

  const sessionData: SessionData = {
    user: {
      id: "admin",
      email: null,
      firstName: adminUsername,
      lastName: null,
      profileImageUrl: null,
      role: "super_admin",
      companyId: null,
    },
    access_token: crypto.randomBytes(16).toString("hex"),
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ ok: true, role: "super_admin", companyId: null });
});

router.post("/logout", async (req: Request, res: Response): Promise<void> => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

export default router;
