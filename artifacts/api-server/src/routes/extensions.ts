import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, extensionsTable, platformUsersTable, phoneNumbersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { getCompanyScope } from "../lib/scope";

const router: IRouter = Router();

function allowed(req: any, companyId: number): boolean {
 const scope = getCompanyScope(req);
 return Number.isInteger(companyId) && companyId > 0 && (scope === null || scope === companyId);
}
function phone(value: unknown): string | null {
 if (typeof value !== "string") return null;
 const digits = value.replace(/\D/g, "");
 const e164 = digits.length === 10 ? "+1" + digits : "+" + digits;
 return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}
async function members(companyId: number, raw: unknown): Promise<Array<{ userId: number; phone: string }>> {
 if (!Array.isArray(raw) || raw.length > 15) throw new Error("Choose at most 15 assigned users");
 const result: Array<{ userId: number; phone: string }> = [];
 for (const item of raw) {
   const userId = Number(item?.userId), number = phone(item?.phone);
   if (!Number.isInteger(userId) || userId < 1 || !number) throw new Error("Select a user and valid phone number for each member");
   const [user] = await db.select().from(platformUsersTable).where(and(eq(platformUsersTable.id, userId), eq(platformUsersTable.companyId, companyId)));
   if (!user?.isActive) throw new Error("All assigned members must be active users of this company");
   if (result.some(x => x.userId === userId || x.phone === number)) throw new Error("Duplicate agent or phone");
   result.push({ userId, phone: number });
 }
 return result;
}


router.get("/companies/:id/extensions", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    if (!allowed(req, companyId)) { res.status(400).json({ error: "Invalid company id" }); return; }
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
    if (!allowed(req, companyId)) { res.status(400).json({ error: "Invalid company id" }); return; }
    const { name, digit, forwardTo, description, enabled } = req.body;
    const agents = req.body.agents === undefined ? [] : await members(companyId, req.body.agents);
    const mainNumber = phone(forwardTo) || agents[0]?.phone;
    if (!name || !/^[1-9]$/.test(String(digit)) || !mainNumber) {
      res.status(400).json({ error: "Enter a name, digit 1-9, and forwarding number or team member" }); return;
    }
    const [row] = await db.insert(extensionsTable).values({
      companyId, name: String(name), digit: String(digit), forwardTo: mainNumber,
      agents, ringCount: Math.max(1, Math.min(10, Number(req.body.ringCount) || 4)),
      fallbackAction: req.body.fallbackAction === "ai_voice" ? "ai_voice" : "voicemail",
      description: description ? String(description) : null, enabled: enabled !== false,
    }).returning();
    res.status(201).json(row);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to create extension");
    res.status(400).json({ error: err?.message || "Failed to create extension" });
  }
});

router.patch("/companies/:id/extensions/:extId", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    const extId = parseInt(req.params.extId, 10);
    if (!allowed(req, companyId) || isNaN(extId)) { res.status(400).json({ error: "Invalid id" }); return; }
    const updates: Record<string, any> = {};
    if (req.body.name != null) updates.name = String(req.body.name);
    if (req.body.digit != null) updates.digit = String(req.body.digit);
    if (req.body.forwardTo != null) {
      const normalized = phone(req.body.forwardTo);
      if (!normalized) { res.status(400).json({ error: "Invalid forwarding number" }); return; }
      updates.forwardTo = normalized;
    }
    if (req.body.agents !== undefined) {
      updates.agents = await members(companyId, req.body.agents);
      if (updates.agents.length && !req.body.forwardTo) updates.forwardTo = updates.agents[0].phone;
    }
    if (req.body.ringCount !== undefined) updates.ringCount = Math.max(1, Math.min(10, Number(req.body.ringCount) || 4));
    if (req.body.fallbackAction !== undefined) updates.fallbackAction = req.body.fallbackAction === "ai_voice" ? "ai_voice" : "voicemail";
    if (req.body.description !== undefined) updates.description = req.body.description ? String(req.body.description) : null;
    if (req.body.enabled != null) updates.enabled = Boolean(req.body.enabled);
    const [updated] = await db.update(extensionsTable).set(updates)
      .where(and(eq(extensionsTable.id, extId), eq(extensionsTable.companyId, companyId)))
      .returning();
    if (!updated) { res.status(404).json({ error: "Extension not found" }); return; }
    res.json(updated);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to update extension");
    res.status(400).json({ error: err?.message || "Failed to update extension" });
  }
});

router.delete("/companies/:id/extensions/:extId", async (req, res): Promise<void> => {
  try {
    const companyId = parseInt(req.params.id, 10);
    const extId = parseInt(req.params.extId, 10);
    if (!allowed(req, companyId) || isNaN(extId)) { res.status(400).json({ error: "Invalid id" }); return; }
    await db.delete(extensionsTable)
      .where(and(eq(extensionsTable.id, extId), eq(extensionsTable.companyId, companyId)));
    res.sendStatus(204);
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to delete extension");
    res.status(500).json({ error: "Failed to delete extension" });
  }
});


router.post("/companies/:id/extensions/menu", async (req, res): Promise<void> => {
 const companyId = Number(req.params.id);
 if (!allowed(req, companyId)) { res.status(403).json({ error: "Company access denied" }); return; }
 const lineId = Number(req.body?.phoneNumberId);
 if (!Number.isInteger(lineId)) { res.status(400).json({ error: "Choose company line" }); return; }
 const [line] = await db.select().from(phoneNumbersTable).where(and(eq(phoneNumbersTable.id, lineId), eq(phoneNumbersTable.companyId, companyId)));
 if (!line || !line.isActive || line.twilioSid) { res.status(400).json({ error: "Choose an active company Telnyx number" }); return; }
 const [updated] = await db.update(phoneNumbersTable).set({ answerMode: req.body?.enabled === true ? "ivr" : "forward" })
   .where(eq(phoneNumbersTable.id, lineId)).returning();
 res.json({ id: updated.id, answerMode: updated.answerMode });
});

export default router;
