import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, appointmentsTable, companiesTable, phoneNumbersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { sendBookingNotifications } from "../lib/notifications";

const router: IRouter = Router();

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "no_show";
const VALID_STATUSES: AppointmentStatus[] = ["scheduled", "confirmed", "cancelled", "no_show"];

function serializeAppointment(a: typeof appointmentsTable.$inferSelect) {
  return {
    ...a,
    startTime: a.startTime.toISOString(),
    endTime: a.endTime?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function parseBody(body: any): { data: Record<string, any>; error?: string } {
  const { companyId, phoneNumberId, customerName, customerPhone, customerEmail, title, notes, startTime, endTime, status } = body ?? {};

  if (!customerName || typeof customerName !== "string") return { data: {}, error: "customerName is required" };
  if (!customerPhone || typeof customerPhone !== "string") return { data: {}, error: "customerPhone is required" };
  if (!startTime || typeof startTime !== "string") return { data: {}, error: "startTime is required" };
  if (status && !VALID_STATUSES.includes(status)) return { data: {}, error: "Invalid status" };

  return {
    data: {
      companyId: companyId != null ? parseInt(companyId, 10) : null,
      phoneNumberId: phoneNumberId != null ? parseInt(phoneNumberId, 10) : null,
      customerName: String(customerName).trim(),
      customerPhone: String(customerPhone).trim(),
      customerEmail: customerEmail ? String(customerEmail).trim() : null,
      title: title ? String(title).trim() : "Appointment",
      notes: notes ? String(notes).trim() : null,
      startTime: new Date(startTime),
      endTime: endTime ? new Date(endTime) : null,
      status: (status as AppointmentStatus) || "scheduled",
    },
  };
}

// GET /appointments
router.get("/appointments", async (req, res): Promise<void> => {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string, 10) : null;
    let rows;
    if (companyId) {
      rows = await db.select().from(appointmentsTable)
        .where(eq(appointmentsTable.companyId, companyId))
        .orderBy(desc(appointmentsTable.startTime));
    } else {
      rows = await db.select().from(appointmentsTable).orderBy(desc(appointmentsTable.startTime));
    }
    res.json(rows.map(serializeAppointment));
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list appointments");
    res.status(500).json({ error: "Failed to list appointments" });
  }
});

// POST /appointments
router.post("/appointments", async (req, res): Promise<void> => {
  const { data, error } = parseBody(req.body);
  if (error) { res.status(400).json({ error }); return; }
  try {
    const [appointment] = await db.insert(appointmentsTable).values(data as any).returning();
    sendBookingNotificationsForAppointment(appointment).catch(err =>
      logger.warn({ err: err?.message }, "Booking notification failed")
    );
    res.status(201).json(serializeAppointment(appointment));
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to create appointment");
    res.status(500).json({ error: "Failed to create appointment" });
  }
});

// GET /appointments/:id
router.get("/appointments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serializeAppointment(row));
});

// PATCH /appointments/:id
router.patch("/appointments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const body = req.body ?? {};
    const updateData: Record<string, any> = {};
    if (body.customerName != null) updateData.customerName = String(body.customerName).trim();
    if (body.customerPhone != null) updateData.customerPhone = String(body.customerPhone).trim();
    if (body.customerEmail !== undefined) updateData.customerEmail = body.customerEmail ? String(body.customerEmail).trim() : null;
    if (body.title != null) updateData.title = String(body.title).trim();
    if (body.notes !== undefined) updateData.notes = body.notes ? String(body.notes).trim() : null;
    if (body.startTime != null) updateData.startTime = new Date(body.startTime);
    if (body.endTime !== undefined) updateData.endTime = body.endTime ? new Date(body.endTime) : null;
    if (body.status != null && VALID_STATUSES.includes(body.status)) updateData.status = body.status;
    if (body.companyId !== undefined) updateData.companyId = body.companyId != null ? parseInt(body.companyId, 10) : null;
    if (body.phoneNumberId !== undefined) updateData.phoneNumberId = body.phoneNumberId != null ? parseInt(body.phoneNumberId, 10) : null;
    updateData.updatedAt = new Date();
    const [updated] = await db.update(appointmentsTable).set(updateData).where(eq(appointmentsTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Not found" }); return; }
    res.json(serializeAppointment(updated));
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to update appointment");
    res.status(500).json({ error: "Failed to update appointment" });
  }
});

// DELETE /appointments/:id
router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id));
  res.status(204).end();
});

// GET /companies/:id/appointments
router.get("/companies/:id/appointments", async (req, res): Promise<void> => {
  const companyId = parseInt(req.params.id, 10);
  if (isNaN(companyId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const rows = await db.select().from(appointmentsTable)
      .where(eq(appointmentsTable.companyId, companyId))
      .orderBy(desc(appointmentsTable.startTime));
    res.json(rows.map(serializeAppointment));
  } catch (err: any) {
    logger.error({ err: err?.message }, "Failed to list company appointments");
    res.status(500).json({ error: "Failed to list appointments" });
  }
});

// Internal helper: fetch related data and send notifications
export async function sendBookingNotificationsForAppointment(
  appointment: typeof appointmentsTable.$inferSelect
): Promise<void> {
  let companyName = "the business";
  let companyAdminEmail: string | null = null;
  let companyAdminWhatsapp: string | null = null;
  let twilioFromNumber: string | null = null;

  if (appointment.companyId) {
    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, appointment.companyId));
    if (company) {
      companyName = company.name;
      companyAdminEmail = company.adminNotificationEmail || company.email || null;
      companyAdminWhatsapp = company.adminWhatsapp || null;
    }
  }

  if (appointment.phoneNumberId) {
    const [pn] = await db.select().from(phoneNumbersTable).where(eq(phoneNumbersTable.id, appointment.phoneNumberId));
    if (pn) twilioFromNumber = pn.number;
  } else if (appointment.companyId) {
    const [pn] = await db.select().from(phoneNumbersTable)
      .where(eq(phoneNumbersTable.companyId, appointment.companyId));
    if (pn) twilioFromNumber = pn.number;
  }

  await sendBookingNotifications({
    customerName: appointment.customerName,
    customerPhone: appointment.customerPhone,
    customerEmail: appointment.customerEmail,
    title: appointment.title,
    notes: appointment.notes,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    companyName,
    companyAdminEmail,
    companyAdminWhatsapp,
    twilioFromNumber,
  });
}

export default router;
