import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, extensionsTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/companies/:id/extensions", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (isNaN(companyId)) { res.status(400).json({ error: "Invalid company id" }); return; }
    const rows = await db.select().from(extensionsTable)
      .where(eq(extensionsTable.companyId, companyId))
      .orderBy(extensionsTable.digit);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list extensions");
    res.status(500).json({ error: "Failed to list extensions" });
  }
});

router.post("/companies/:id/extensions", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (isNaN(companyId)) { res.status(400).json({ error: "Invalid company id" }); return; }
    const { name, digit, forwardTo, description, enabled } = req.body;
    if (!name || !digit || !forwardTo) {
      res.status(400).json({ error: "name, digit, and forwardTo are required" });
      return;
    }
    const [row] = await db.insert(extensionsTable).values({
      companyId,
      name: String(name),
      digit: String(digit),
      forwardTo: String(forwardTo),
      description: description ? String(description) : null,
      enabled: enabled !== false,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to create extension");
    res.status(500).json({ error: "Failed to create extension" });
  }
});

router.patch("/companies/:id/extensions/:extId", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    const extId = parseInt(req.params.extId, 10);
    if (isNaN(companyId) || isNaN(extId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const updates: Record<string, any> = {};
    if (req.body.name != null) updates.name = String(req.body.name);
    if (req.body.digit != null) updates.digit = String(req.body.digit);
    if (req.body.forwardTo != null) updates.forwardTo = String(req.body.forwardTo);
    if (req.body.description !== undefined) updates.description = req.body.description ? String(req.body.description) : null;
    if (req.body.enabled != null) updates.enabled = Boolean(req.body.enabled);
    const [updated] = await db.update(extensionsTable).set(updates)
      .where(and(eq(extensionsTable.id, extId), eq(extensionsTable.companyId, companyId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Extension not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to update extension");
    res.status(500).json({ error: "Failed to update extension" });
  }
});

router.delete("/companies/:id/extensions/:extId", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    const extId = parseInt(req.params.extId, 10);
    if (isNaN(companyId) || isNaN(extId)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(extensionsTable)
      .where(and(eq(extensionsTable.id, extId), eq(extensionsTable.companyId, companyId)));
    res.sendStatus(204);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to delete extension");
    res.status(500).json({ error: "Failed to delete extension" });
  }
});

export default router;
