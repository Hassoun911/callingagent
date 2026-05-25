import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, companiesTable } from "@workspace/db";
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

router.get("/companies", async (_req, res): Promise<void> => {
  const companies = await db.select().from(companiesTable).orderBy(desc(companiesTable.createdAt));
  res.json(ListCompaniesResponse.parse(companies.map(c => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
  }))));
});

router.post("/companies", async (req, res): Promise<void> => {
  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [company] = await db.insert(companiesTable).values(parsed.data).returning();
  res.status(201).json(GetCompanyResponse.parse({ ...company, createdAt: company.createdAt.toISOString() }));
});

router.get("/companies/:id", async (req, res): Promise<void> => {
  const params = GetCompanyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
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

  const parsed = UpdateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  const body = parsed.data;
  if (body.name != null) updateData.name = body.name;
  if (body.industry !== undefined) updateData.industry = body.industry;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.website !== undefined) updateData.website = body.website;
  if (body.notes !== undefined) updateData.notes = body.notes;

  const [updated] = await db.update(companiesTable)
    .set(updateData)
    .where(eq(companiesTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Company not found" });
    return;
  }

  res.json(UpdateCompanyResponse.parse({ ...updated, createdAt: updated.createdAt.toISOString() }));
});

router.delete("/companies/:id", async (req, res): Promise<void> => {
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
