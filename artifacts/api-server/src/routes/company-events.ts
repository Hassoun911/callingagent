import { Router, type Request, type Response } from "express";

const router = Router();
const HEARTBEAT_MS = 3_000;

function canAccessCompany(req: Request, companyId: number): boolean {
  if (!req.isAuthenticated?.() || !req.user) return false;
  if (req.user.role === "super_admin") return true;
  return Number(req.user.companyId) === companyId;
}

router.get("/companies/:companyId/events", (req: Request, res: Response) => {
  const companyId = Number(req.params.companyId);

  if (!Number.isInteger(companyId) || companyId <= 0) {
    res.status(400).json({ error: "Invalid company id" });
    return;
  }

  if (!req.isAuthenticated?.() || !req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  if (!canAccessCompany(req, companyId)) {
    res.status(403).json({ error: "You cannot subscribe to another company's events" });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (type: string) => {
    res.write(`data: ${JSON.stringify({
      type,
      companyId,
      at: new Date().toISOString(),
    })}\n\n`);
  };

  send("connected");

  const heartbeat = setInterval(() => {
    send("sync");
  }, HEARTBEAT_MS);

  req.on("close", () => {
    clearInterval(heartbeat);
    res.end();
  });
});

export default router;
