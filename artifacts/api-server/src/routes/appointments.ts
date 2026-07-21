import { Router, type IRouter } from "express";
import { and, eq, desc } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  companiesTable,
  phoneNumbersTable,
  bookingResourcesTable,
  bookingServicesTable,
  bookingAvailabilityTable,
  bookingTimeOffTable,
  bookingSettingsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { sendBookingNotifications } from "../lib/notifications";
import { createFlexibleBooking, findBookingAssignment } from "../lib/booking-engine";

const router: IRouter = Router();
type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "no_show";
const VALID_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed", "cancelled", "no_show"];

function userCompanyId(req: any): number | null {
  return req.user?.role === "super_admin" ? null : (req.user?.companyId ?? null);
}
function effectiveCompanyId(req: any, requested?: unknown): number | null {
  return userCompanyId(req) ?? (requested != null ? Number(requested) : null);
}
function canAccessCompany(req: any, companyId: number | null): boolean {
  return req.user?.role === "super_admin" || (!!companyId && req.user?.companyId === companyId);
}
function serializeAppointment(a: typeof appointmentsTable.$inferSelect) {
  return { ...a, startTime: a.startTime.toISOString(), endTime: a.endTime?.toISOString() ?? null, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() };
}

router.get("/appointments", async (req, res): Promise<void> => {
  try {
    const companyId = effectiveCompanyId(req, req.query.companyId);
    const rows = companyId
      ? await db.select().from(appointmentsTable).where(eq(appointmentsTable.companyId, companyId)).orderBy(desc(appointmentsTable.startTime))
      : await db.select().from(appointmentsTable).orderBy(desc(appointmentsTable.startTime));
    res.json(rows.map(serializeAppointment));
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list appointments");
    res.status(500).json({ error: "Failed to list appointments" });
  }
});

router.post("/appointments", async (req, res): Promise<void> => {
  try {
    const companyId = effectiveCompanyId(req, req.body?.companyId);
    if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
    const customerName = String(req.body?.customerName ?? "").trim();
    const customerPhone = String(req.body?.customerPhone ?? "").trim();
    const startTime = new Date(req.body?.startTime);
    if (!customerName || !customerPhone || Number.isNaN(startTime.getTime())) {
      res.status(400).json({ error: "customerName, customerPhone and valid startTime are required" }); return;
    }
    const result = await createFlexibleBooking({
      companyId,
      phoneNumberId: req.body?.phoneNumberId ? Number(req.body.phoneNumberId) : null,
      customerName,
      customerPhone,
      customerEmail: req.body?.customerEmail ?? null,
      serviceName: req.body?.serviceName ?? req.body?.title ?? null,
      resourceName: req.body?.resourceName ?? null,
      startTime,
      title: req.body?.title ?? null,
      notes: req.body?.notes ?? null,
      source: req.body?.source ?? "dashboard",
    });
    if ("error" in result) { res.status(409).json({ error: result.error }); return; }
    sendBookingNotificationsForAppointment(result.appointment).catch(err => logger.warn({ err: err?.message }, "Booking notification failed"));
    res.status(201).json({ ...serializeAppointment(result.appointment), resource: result.resource, service: result.service });
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to create appointment");
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

router.post("/appointments/check-availability", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.body?.companyId);
  const startTime = new Date(req.body?.startTime);
  if (!companyId || Number.isNaN(startTime.getTime())) { res.status(400).json({ error: "companyId and valid startTime are required" }); return; }
  const result = await findBookingAssignment(companyId, startTime, req.body?.serviceName ?? null, req.body?.resourceName ?? null);
  if ("error" in result) { res.status(409).json({ available: false, error: result.error }); return; }
  res.json({ available: true, resource: result.resource, service: result.service, startTime: result.startTime, endTime: result.endTime });
});

router.get("/appointments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCompany(req, row.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
  res.json(serializeAppointment(row));
});

router.patch("/appointments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const body = req.body ?? {};
  const updateData: Record<string, any> = { updatedAt: new Date() };
  if (body.customerName != null) updateData.customerName = String(body.customerName).trim();
  if (body.customerPhone != null) updateData.customerPhone = String(body.customerPhone).trim();
  if (body.customerEmail !== undefined) updateData.customerEmail = body.customerEmail || null;
  if (body.title != null) updateData.title = String(body.title).trim();
  if (body.notes !== undefined) updateData.notes = body.notes || null;
  if (body.status != null && VALID_STATUSES.includes(body.status)) updateData.status = body.status;
  if (body.startTime != null) updateData.startTime = new Date(body.startTime);
  if (body.endTime !== undefined) updateData.endTime = body.endTime ? new Date(body.endTime) : null;
  if (body.resourceId !== undefined) updateData.resourceId = body.resourceId ? Number(body.resourceId) : null;
  if (body.serviceId !== undefined) updateData.serviceId = body.serviceId ? Number(body.serviceId) : null;
  const [updated] = await db.update(appointmentsTable).set(updateData).where(eq(appointmentsTable.id, id)).returning();
  res.json(serializeAppointment(updated));
});

router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCompany(req, existing.companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
  await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id));
  res.status(204).end();
});

router.get("/companies/:id/appointments", async (req, res): Promise<void> => {
  const companyId = Number(req.params.id);
  if (!canAccessCompany(req, companyId)) { res.status(403).json({ error: "Forbidden" }); return; }
  const rows = await db.select().from(appointmentsTable).where(eq(appointmentsTable.companyId, companyId)).orderBy(desc(appointmentsTable.startTime));
  res.json(rows.map(serializeAppointment));
});

router.get("/booking/resources", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.query.companyId);
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  res.json(await db.select().from(bookingResourcesTable).where(eq(bookingResourcesTable.companyId, companyId)));
});
router.post("/booking/resources", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.body?.companyId);
  if (!companyId || !req.body?.name) { res.status(400).json({ error: "companyId and name are required" }); return; }
  const [row] = await db.insert(bookingResourcesTable).values({ companyId, name: String(req.body.name).trim(), resourceType: req.body.resourceType ?? "staff", description: req.body.description ?? null, allowRandomAssignment: req.body.allowRandomAssignment !== false }).returning();
  res.status(201).json(row);
});
router.get("/booking/services", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.query.companyId);
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  res.json(await db.select().from(bookingServicesTable).where(eq(bookingServicesTable.companyId, companyId)));
});
router.post("/booking/services", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.body?.companyId);
  if (!companyId || !req.body?.name) { res.status(400).json({ error: "companyId and name are required" }); return; }
  const [row] = await db.insert(bookingServicesTable).values({ companyId, name: String(req.body.name).trim(), description: req.body.description ?? null, durationMinutes: Number(req.body.durationMinutes ?? 30), bufferBeforeMinutes: Number(req.body.bufferBeforeMinutes ?? 0), bufferAfterMinutes: Number(req.body.bufferAfterMinutes ?? 0) }).returning();
  res.status(201).json(row);
});
router.get("/booking/settings", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.query.companyId);
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  const [row] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, companyId));
  res.json(row ?? null);
});
router.put("/booking/settings", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.body?.companyId);
  if (!companyId) { res.status(400).json({ error: "companyId is required" }); return; }
  const values = { companyId, enabled: req.body.enabled !== false, timezone: req.body.timezone ?? "America/Toronto", slotIntervalMinutes: Number(req.body.slotIntervalMinutes ?? 30), minimumNoticeMinutes: Number(req.body.minimumNoticeMinutes ?? 60), maximumAdvanceDays: Number(req.body.maximumAdvanceDays ?? 90), allowResourceSelection: req.body.allowResourceSelection !== false, allowRandomAssignment: req.body.allowRandomAssignment !== false, requireApproval: req.body.requireApproval === true, updatedAt: new Date() };
  const [row] = await db.insert(bookingSettingsTable).values(values).onConflictDoUpdate({ target: bookingSettingsTable.companyId, set: values }).returning();
  res.json(row);
});
router.post("/booking/availability", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.body?.companyId);
  if (!companyId || !req.body?.resourceId) { res.status(400).json({ error: "companyId and resourceId are required" }); return; }
  const [row] = await db.insert(bookingAvailabilityTable).values({ companyId, resourceId: Number(req.body.resourceId), dayOfWeek: Number(req.body.dayOfWeek), startTime: req.body.startTime, endTime: req.body.endTime }).returning();
  res.status(201).json(row);
});
router.post("/booking/time-off", async (req, res): Promise<void> => {
  const companyId = effectiveCompanyId(req, req.body?.companyId);
  if (!companyId || !req.body?.resourceId) { res.status(400).json({ error: "companyId and resourceId are required" }); return; }
  const [row] = await db.insert(bookingTimeOffTable).values({ companyId, resourceId: Number(req.body.resourceId), startTime: new Date(req.body.startTime), endTime: new Date(req.body.endTime), reason: req.body.reason ?? null }).returning();
  res.status(201).json(row);
});

export async function sendBookingNotificationsForAppointment(appointment: typeof appointmentsTable.$inferSelect): Promise<void> {
  let companyName = "the business", companyAdminEmail: string | null = null, companyAdminWhatsapp: string | null = null, twilioFromNumber: string | null = null;
  if (appointment.companyId) {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, appointment.companyId));
    if (company) { companyName = company.name; companyAdminEmail = company.adminNotificationEmail || company.email || null; companyAdminWhatsapp = company.adminWhatsapp || null; }
  }
  if (appointment.phoneNumberId) {
    const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, appointment.phoneNumberId));
    if (pn) twilioFromNumber = pn.number;
  }
  await sendBookingNotifications({ customerName: appointment.customerName, customerPhone: appointment.customerPhone, customerEmail: appointment.customerEmail, title: appointment.title, notes: appointment.notes, startTime: appointment.startTime, endTime: appointment.endTime, companyName, companyAdminEmail, companyAdminWhatsapp, twilioFromNumber });
}

export default router;
