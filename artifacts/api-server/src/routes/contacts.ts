import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, contactsTable, companiesTable } from "@workspace/db";
import {
  ListContactsResponse,
  ListContactsQueryParams,
  GetContactResponse,
  GetContactParams,
  CreateContactBody,
  UpdateContactParams,
  UpdateContactBody,
  UpdateContactResponse,
  DeleteContactParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/contacts", async (req, res): Promise<void> => {
  const query = ListContactsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { search, companyId, forCompanyId } = query.data;

  let contacts = await db
    .select({
      id: contactsTable.id,
      firstName: contactsTable.firstName,
      lastName: contactsTable.lastName,
      email: contactsTable.email,
      phone: contactsTable.phone,
      companyId: contactsTable.companyId,
      companyName: companiesTable.name,
      notes: contactsTable.notes,
      tags: contactsTable.tags,
      accessType: contactsTable.accessType,
      allowedCompanyIds: contactsTable.allowedCompanyIds,
      createdAt: contactsTable.createdAt,
    })
    .from(contactsTable)
    .leftJoin(companiesTable, eq(contactsTable.companyId, companiesTable.id))
    .orderBy(desc(contactsTable.createdAt));

  if (search) {
    const s = search.toLowerCase();
    contacts = contacts.filter(c =>
      c.firstName.toLowerCase().includes(s) ||
      c.lastName.toLowerCase().includes(s) ||
      (c.email?.toLowerCase().includes(s)) ||
      (c.phone?.includes(s)) ||
      (c.companyName?.toLowerCase().includes(s))
    );
  }

  if (companyId) {
    contacts = contacts.filter(c => c.companyId === companyId);
  }

  // forCompanyId: return contacts accessible to this company
  // accessType="all" → always included; accessType="selected" → only if company is in allowedCompanyIds
  if (forCompanyId) {
    contacts = contacts.filter(c => {
      if (c.accessType === "all" || !c.accessType) return true;
      if (!c.allowedCompanyIds) return false;
      const ids = c.allowedCompanyIds.split(",").map(s => parseInt(s.trim(), 10)).filter(Boolean);
      return ids.includes(forCompanyId);
    });
  }

  res.json(ListContactsResponse.parse(contacts.map(c => ({
    ...c,
    accessType: c.accessType ?? "all",
    createdAt: c.createdAt.toISOString(),
  }))));
});

router.post("/contacts/import", async (req, res): Promise<void> => {
  const body = req.body;
  if (!body || !Array.isArray(body.contacts)) {
    res.status(400).json({ error: "contacts must be an array" });
    return;
  }

  const contacts: any[] = body.contacts;
  const accessType: string = body.accessType ?? "all";
  const allowedCompanyIds: string | null = body.allowedCompanyIds ?? null;
  let imported = 0;
  const errors: string[] = [];

  for (const contact of contacts) {
    try {
      await db.insert(contactsTable).values({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email ?? null,
        phone: contact.phone ?? null,
        companyId: contact.companyId ?? null,
        notes: contact.notes ?? null,
        tags: contact.tags ?? null,
        accessType: accessType ?? "all",
        allowedCompanyIds: allowedCompanyIds ?? null,
      });
      imported++;
    } catch (e: any) {
      errors.push(`${contact.firstName} ${contact.lastName}: ${e.message ?? "unknown error"}`);
    }
  }

  res.json({ imported, skipped: errors.length, errors });
});

router.post("/contacts", async (req, res): Promise<void> => {
  const parsed = CreateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [contact] = await db.insert(contactsTable).values(parsed.data).returning();
  res.status(201).json(GetContactResponse.parse({
    ...contact,
    companyName: null,
    accessType: contact.accessType ?? "all",
    createdAt: contact.createdAt.toISOString(),
  }));
});

router.get("/contacts/:id", async (req, res): Promise<void> => {
  const params = GetContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [contact] = await db
    .select({
      id: contactsTable.id,
      firstName: contactsTable.firstName,
      lastName: contactsTable.lastName,
      email: contactsTable.email,
      phone: contactsTable.phone,
      companyId: contactsTable.companyId,
      companyName: companiesTable.name,
      notes: contactsTable.notes,
      tags: contactsTable.tags,
      accessType: contactsTable.accessType,
      allowedCompanyIds: contactsTable.allowedCompanyIds,
      createdAt: contactsTable.createdAt,
    })
    .from(contactsTable)
    .leftJoin(companiesTable, eq(contactsTable.companyId, companiesTable.id))
    .where(eq(contactsTable.id, params.data.id));

  if (!contact) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(GetContactResponse.parse({ ...contact, accessType: contact.accessType ?? "all", createdAt: contact.createdAt.toISOString() }));
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const params = UpdateContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateContactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: any = {};
  const body = parsed.data;
  if (body.firstName != null) updateData.firstName = body.firstName;
  if (body.lastName != null) updateData.lastName = body.lastName;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.companyId !== undefined) updateData.companyId = body.companyId;
  if (body.notes !== undefined) updateData.notes = body.notes;
  if (body.tags !== undefined) updateData.tags = body.tags;
  if (body.accessType !== undefined) updateData.accessType = body.accessType ?? "all";
  if (body.allowedCompanyIds !== undefined) updateData.allowedCompanyIds = body.allowedCompanyIds;

  const [updated] = await db.update(contactsTable)
    .set(updateData)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.json(UpdateContactResponse.parse({
    ...updated,
    companyName: null,
    accessType: updated.accessType ?? "all",
    createdAt: updated.createdAt.toISOString(),
  }));
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const params = DeleteContactParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db.delete(contactsTable)
    .where(eq(contactsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
