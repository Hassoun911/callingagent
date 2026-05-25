import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, numberWatchesTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/watches", async (_req, res): Promise<void> => {
  const watches = await db.select().from(numberWatchesTable).orderBy(desc(numberWatchesTable.createdAt));
  res.json(watches.map(w => ({
    ...w,
    createdAt: w.createdAt.toISOString(),
    lastChecked: w.lastChecked?.toISOString() ?? null,
    notifiedAt: w.notifiedAt?.toISOString() ?? null,
    foundNumbers: w.foundNumbers ? JSON.parse(w.foundNumbers) : [],
  })));
});

router.post("/watches", async (req, res): Promise<void> => {
  const { areaCode, city, country = "US", label } = req.body;
  if (!areaCode && !city) {
    res.status(400).json({ error: "areaCode or city is required" });
    return;
  }
  const [watch] = await db.insert(numberWatchesTable).values({
    areaCode: areaCode || null,
    city: city || null,
    country,
    label: label || (city ? `${city} (${country})` : `${areaCode} (${country})`),
    status: "watching",
  }).returning();
  res.status(201).json({
    ...watch,
    createdAt: watch.createdAt.toISOString(),
    lastChecked: null,
    notifiedAt: null,
    foundNumbers: [],
  });
});

router.delete("/watches/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(numberWatchesTable).where(eq(numberWatchesTable.id, id));
  res.sendStatus(204);
});

router.post("/watches/:id/dismiss", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [updated] = await db.update(numberWatchesTable)
    .set({ status: "watching", foundNumbers: null, notifiedAt: null })
    .where(eq(numberWatchesTable.id, id))
    .returning();
  res.json({ ...updated, createdAt: updated.createdAt.toISOString(), lastChecked: updated.lastChecked?.toISOString() ?? null, notifiedAt: null, foundNumbers: [] });
});

export default router;
