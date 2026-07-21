import { and, eq, sql } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  bookingResourcesTable,
  bookingServicesTable,
  bookingResourceServicesTable,
  bookingAvailabilityTable,
  bookingTimeOffTable,
  bookingSettingsTable,
} from "@workspace/db";

export interface BookingRequest {
  companyId: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;
  phoneNumberId?: number | null;
  serviceName?: string | null;
  resourceName?: string | null;
  startTime: Date;
  notes?: string | null;
  title?: string | null;
  source?: string;
}

function minutesSinceMidnight(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

async function resourceIsAvailable(resourceId: number, companyId: number, start: Date, end: Date): Promise<boolean> {
  const dayOfWeek = start.getDay();
  const windows = await db.select().from(bookingAvailabilityTable).where(and(
    eq(bookingAvailabilityTable.companyId, companyId),
    eq(bookingAvailabilityTable.resourceId, resourceId),
    eq(bookingAvailabilityTable.dayOfWeek, dayOfWeek),
    eq(bookingAvailabilityTable.active, true),
  ));

  if (windows.length > 0) {
    const startMinutes = start.getHours() * 60 + start.getMinutes();
    const endMinutes = end.getHours() * 60 + end.getMinutes();
    if (!windows.some(w => startMinutes >= minutesSinceMidnight(w.startTime) && endMinutes <= minutesSinceMidnight(w.endTime))) {
      return false;
    }
  }

  const timeOff = await db.select({ id: bookingTimeOffTable.id }).from(bookingTimeOffTable).where(and(
    eq(bookingTimeOffTable.companyId, companyId),
    eq(bookingTimeOffTable.resourceId, resourceId),
    sql`${bookingTimeOffTable.startTime} < ${end} AND ${bookingTimeOffTable.endTime} > ${start}`,
  )).limit(1);
  if (timeOff.length) return false;

  const conflicts = await db.select({ id: appointmentsTable.id }).from(appointmentsTable).where(and(
    eq(appointmentsTable.companyId, companyId),
    eq(appointmentsTable.resourceId, resourceId),
    sql`${appointmentsTable.status} <> 'cancelled'`,
    sql`${appointmentsTable.startTime} < ${end} AND COALESCE(${appointmentsTable.endTime}, ${appointmentsTable.startTime} + interval '30 minutes') > ${start}`,
  )).limit(1);
  return conflicts.length === 0;
}

export async function findBookingAssignment(companyId: number, startTime: Date, serviceName?: string | null, resourceName?: string | null) {
  const [settings] = await db.select().from(bookingSettingsTable).where(eq(bookingSettingsTable.companyId, companyId));
  if (settings && !settings.enabled) return { error: "Booking is disabled for this company" as const };

  const now = new Date();
  if (settings) {
    const earliest = new Date(now.getTime() + settings.minimumNoticeMinutes * 60_000);
    const latest = new Date(now.getTime() + settings.maximumAdvanceDays * 86_400_000);
    if (startTime < earliest) return { error: `Appointments require at least ${settings.minimumNoticeMinutes} minutes notice` as const };
    if (startTime > latest) return { error: `Appointments cannot be booked more than ${settings.maximumAdvanceDays} days ahead` as const };
  }

  let service = null;
  if (serviceName) {
    const services = await db.select().from(bookingServicesTable).where(and(
      eq(bookingServicesTable.companyId, companyId),
      eq(bookingServicesTable.active, true),
      sql`lower(${bookingServicesTable.name}) = lower(${serviceName})`,
    )).limit(1);
    service = services[0] ?? null;
  }
  if (!service) {
    const services = await db.select().from(bookingServicesTable).where(and(
      eq(bookingServicesTable.companyId, companyId),
      eq(bookingServicesTable.active, true),
    )).limit(1);
    service = services[0] ?? null;
  }

  const durationMinutes = service?.durationMinutes ?? 30;
  const start = new Date(startTime.getTime() - (service?.bufferBeforeMinutes ?? 0) * 60_000);
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);
  const conflictEnd = new Date(endTime.getTime() + (service?.bufferAfterMinutes ?? 0) * 60_000);

  let resources = await db.select().from(bookingResourcesTable).where(and(
    eq(bookingResourcesTable.companyId, companyId),
    eq(bookingResourcesTable.active, true),
  ));

  if (resourceName) {
    resources = resources.filter(r => r.name.toLowerCase() === resourceName.toLowerCase());
    if (!resources.length) return { error: `No active booking resource named ${resourceName}` as const };
  }

  if (service && resources.length) {
    const links = await db.select().from(bookingResourceServicesTable).where(and(
      eq(bookingResourceServicesTable.companyId, companyId),
      eq(bookingResourceServicesTable.serviceId, service.id),
    ));
    if (links.length) {
      const allowed = new Set(links.map(l => l.resourceId));
      resources = resources.filter(r => allowed.has(r.id));
    }
  }

  if (!resources.length) {
    return { service, resource: null, startTime, endTime, durationMinutes };
  }

  for (const resource of resources) {
    if (!resourceName && !resource.allowRandomAssignment) continue;
    if (await resourceIsAvailable(resource.id, companyId, start, conflictEnd)) {
      return { service, resource, startTime, endTime, durationMinutes };
    }
  }

  return { error: resourceName ? `${resourceName} is not available at that time` as const : "No booking resource is available at that time" as const };
}

export async function createFlexibleBooking(input: BookingRequest) {
  const assignment = await findBookingAssignment(input.companyId, input.startTime, input.serviceName, input.resourceName);
  if ("error" in assignment) return assignment;

  const [appointment] = await db.insert(appointmentsTable).values({
    companyId: input.companyId,
    phoneNumberId: input.phoneNumberId ?? null,
    resourceId: assignment.resource?.id ?? null,
    serviceId: assignment.service?.id ?? null,
    source: input.source ?? "dashboard",
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail ?? null,
    title: input.title ?? assignment.service?.name ?? "Appointment",
    notes: input.notes ?? null,
    startTime: input.startTime,
    endTime: assignment.endTime,
    status: "scheduled",
  }).returning();

  return { appointment, resource: assignment.resource, service: assignment.service };
}
