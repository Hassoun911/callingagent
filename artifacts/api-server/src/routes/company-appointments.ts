import { Router, type Request, type Response, type NextFunction } from "express";
import { desc, eq } from "drizzle-orm";
import { appointmentsTable, db } from "@workspace/db";
import { logger } from "../lib/logger";

const router = Router();

function serializeAppointment(row: typeof appointmentsTable.$inferSelect) {
  return {
    ...row,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/appointments", async (req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated?.() || !req.user) {
    next();
    return;
  }

  if (req.user.role === "super_admin") {
    next();
    return;
  }

  const companyId = Number(req.user.companyId);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    res.status(403).json({ error: "This account is not assigned to a company" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(appointmentsTable)
      .where(eq(appointmentsTable.companyId, companyId))
      .orderBy(desc(appointmentsTable.startTime));

    res.json(rows.map(serializeAppointment));
  } catch (error: any) {
    logger.error({ error: error?.message, companyId }, "Failed to list company appointments");
    res.status(500).json({ error: "Failed to list appointments" });
  }
});

export default router;
