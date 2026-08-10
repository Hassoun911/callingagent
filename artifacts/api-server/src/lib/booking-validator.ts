import { and, eq, ne } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  bookingResourcesTable,
  bookingServicesTable,
} from "@workspace/db";
import { hasValidBookingHold, type LiveBookingState } from "./booking-state-manager";

export type BookingValidationResult =
  | { ok: true; startTime: Date; endTime: Date; durationMinutes: number }
  | { ok: false; reason: string; code: "MISSING_STATE" | "HOLD_EXPIRED" | "MISSING_DETAILS" | "INVALID_PHONE" | "INVALID_SERVICE" | "INVALID_RESOURCE" | "SLOT_CONFLICT" | "DUPLICATE" };

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function validPhone(value: string | null): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export async function validateBookingBeforeCreate(state: LiveBookingState): Promise<BookingValidationResult> {
  if (!state.selectedSlot || !state.companyId) {
    return { ok: false, code: "MISSING_STATE", reason: "The booking no longer has a selected appointment time." };
  }
  if (state.bookingId) {
    return { ok: false, code: "DUPLICATE", reason: "This call already created an appointment." };
  }
  if (!hasValidBookingHold(state.callSid)) {
    return { ok: false, code: "HOLD_EXPIRED", reason: "The temporary hold expired before the booking was completed." };
  }
  if (!state.customerName?.trim() || !state.customerPhone?.trim()) {
    return { ok: false, code: "MISSING_DETAILS", reason: "Name and phone number are required before booking." };
  }
  if (!validPhone(state.customerPhone)) {
    return { ok: false, code: "INVALID_PHONE", reason: "The confirmation phone number is not valid." };
  }

  const [resource] = await db.select().from(bookingResourcesTable).where(and(
    eq(bookingResourcesTable.id, state.selectedSlot.resourceId),
    eq(bookingResourcesTable.companyId, state.companyId),
    eq(bookingResourcesTable.active, true),
  ));
  if (!resource) {
    return { ok: false, code: "INVALID_RESOURCE", reason: "The selected booking resource is no longer available." };
  }

  let durationMinutes = 60;
  if (state.selectedSlot.serviceId != null) {
    const [service] = await db.select().from(bookingServicesTable).where(and(
      eq(bookingServicesTable.id, state.selectedSlot.serviceId),
      eq(bookingServicesTable.companyId, state.companyId),
      eq(bookingServicesTable.active, true),
    ));
    if (!service) {
      return { ok: false, code: "INVALID_SERVICE", reason: "The selected service is no longer available." };
    }
    durationMinutes = service.durationMinutes;
  }

  const startTime = new Date(state.selectedSlot.iso);
  if (!Number.isFinite(startTime.getTime())) {
    return { ok: false, code: "MISSING_STATE", reason: "The selected appointment time is invalid." };
  }
  const endTime = new Date(startTime.getTime() + durationMinutes * 60_000);

  // Re-read current appointments immediately before insert. The temporary hold
  // protects callers inside this process; this final DB check also catches any
  // appointment created by another process, dashboard user, or stale worker.
  const existing = await db.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.companyId, state.companyId),
    ne(appointmentsTable.status, "cancelled"),
  ));

  const conflict = existing.some(appointment => {
    if (appointment.resourceId != null && appointment.resourceId !== state.selectedSlot!.resourceId) return false;
    const appointmentEnd = appointment.endTime ?? new Date(appointment.startTime.getTime() + durationMinutes * 60_000);
    return overlaps(startTime, endTime, appointment.startTime, appointmentEnd);
  });

  if (conflict) {
    return { ok: false, code: "SLOT_CONFLICT", reason: "That appointment time was just taken." };
  }

  return { ok: true, startTime, endTime, durationMinutes };
}
