import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
import { getCompanyScope, isCompanyScoped, isCompanyAdmin } from "../lib/scope";
import { getPortalVisibility } from "./portal-visibility";
import {
  ListCompaniesResponse,
  GetCompanyResponse,
  GetCompanyParams,
  CreateCompanyBody,
  UpdateCompanyParams,
  UpdateCompanyBody,
  UpdateCompanyResponse,
  DeleteCompanyParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function normalizeNorthAmericanPhone(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;

  let digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);

  if (digits.length !== 10) {
    throw new Error("Enter a valid 10-digit Canadian or US phone number");
  }

  return `+1${digits}`;
}

function normalizeNotificationEmail(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === "") return null;
  const email = String(value).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid notification email address");
  }
  return email;
}

router.get("/companies/:id/public-info", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [company] = await db.select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable).where(eq(companiesTable.id, id));
  if (!company) { res.status(404).json({ error: "Not found" }); return; }
  res.json(company);
});

router.get("/companies", async (req, res): Promise<void> => {
  const companyId = getCompanyScope(req);
  let companies = await db.select().from(companiesTable).orderBy(desc(companiesTable.createdAt));
  if (companyId !== null) {
    companies = companies.filter(c => c.id === companyId);
  }
  res.json(ListCompaniesResponse.parse(companies.map(c => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }))));
});

router.post("/companies", async (req, res): Promise<void> => {
  if (isCompanyScoped(req)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const adminWhatsapp = normalizeNorthAmericanPhone(req.body?.adminWhatsapp ?? req.body?.companyAdminWhatsapp);
    const adminNotificationEmail = normalizeNotificationEmail(req.body?.adminNotificationEmail);
    const [company] = await db.insert(companiesTable).values({
      ...parsed.data,
      ...(adminWhatsapp !== undefined ? { adminWhatsapp } : {}),
      ...(adminNotificationEmail !== undefined ? { adminNotificationEmail } : {}),
    } as any).returning();
    res.status(201).json(GetCompanyResponse.parse({ ...company, createdAt: company.createdAt.toISOString() }));
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Invalid notification setting" });
  }
});

router.get("/companies/:id", async (req, res): Promise<void> => {
  const params = GetCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyScope(req);
  if (companyId !== null && params.data.id !== companyId) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, params.data.id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  res.json(GetCompanyResponse.parse({ ...company, createdAt: company.createdAt.toISOString() }));
});

router.patch("/companies/:id", async (req, res): Promise<void> => {
  const params = UpdateCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const companyId = getCompanyScope(req);
  if (companyId !== null && (!isCompanyAdmin(req) || params.data.id !== companyId)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const parsed = UpdateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const updateData: any = {};
    const body = parsed.data;
    if (body.name != null) updateData.name = body.name;
    if (body.ownerName !== undefined) updateData.ownerName = body.ownerName;
    if (body.industry !== undefined) updateData.industry = body.industry;
    if (body.phone !== undefined) updateData.phone = body.phone;
    if (body.email !== undefined) updateData.email = body.email;
    if (body.website !== undefined) updateData.website = body.website;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const adminWhatsapp = normalizeNorthAmericanPhone(req.body?.adminWhatsapp ?? req.body?.companyAdminWhatsapp);
    const adminNotificationEmail = normalizeNotificationEmail(req.body?.adminNotificationEmail);

    if (companyId !== null && (adminWhatsapp !== undefined || adminNotificationEmail !== undefined)) {
      const visibility = await getPortalVisibility(companyId);
      if (!visibility.pages.notifications) {
        res.status(403).json({ error: "Notification settings are managed by the main administrator" });
        return;
      }
      if (adminWhatsapp !== undefined && !visibility.notifications.adminWhatsapp) {
        res.status(403).json({ error: "WhatsApp notification number is managed by the main administrator" });
        return;
      }
      if (adminNotificationEmail !== undefined && !visibility.notifications.notificationEmail) {
        res.status(403).json({ error: "Notification email is managed by the main administrator" });
        return;
      }
    }

    if (adminWhatsapp !== undefined) updateData.adminWhatsapp = adminWhatsapp;
    if (adminNotificationEmail !== undefined) updateData.adminNotificationEmail = adminNotificationEmail;

    const [updated] = await db.update(companiesTable)
      .set(updateData)
      .where(eq(companiesTable.id, params.data.id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    res.json(UpdateCompanyResponse.parse({ ...updated, createdAt: updated.createdAt.toISOString() }));
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Invalid notification setting" });
  }
});

router.delete("/companies/:id", async (req, res): Promise<void> => {
  if (isCompanyScoped(req)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const params = DeleteCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db.delete(companiesTable)
    .where(eq(companiesTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
