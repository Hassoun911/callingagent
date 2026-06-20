import crypto from "crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  clearSession,
  getSessionId,
  createSession,
  SESSION_COOKIE,
  SESSION_TTL,
  type SessionData,
} from "../lib/auth";

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
  const { username, password } = req.body ?? {};

  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminUsername || !adminPassword) {
    res.status(503).json({ error: "Auth not configured — set ADMIN_USERNAME and ADMIN_PASSWORD secrets." });
    return;
  }

  const valid =
    typeof username === "string" &&
    typeof password === "string" &&
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
    },
    access_token: crypto.randomBytes(16).toString("hex"),
  };

  const sid = await createSession(sessionData);
  setSessionCookie(res, sid);
  res.json({ ok: true });
});

router.post("/logout", async (req: Request, res: Response): Promise<void> => {
  const sid = getSessionId(req);
  await clearSession(res, sid);
  res.json({ ok: true });
});

export default router;
