import { and, eq, ne } from "drizzle-orm";
import {
  db,
  appointmentsTable,
  bookingResourcesTable,
  bookingServicesTable,
} from "@workspace/db";
import { hasValidBookingHold, type LiveBookingState } from "./booking-state-manager";

export type BookingValidationResult =
  | { ok: true; startTime: Date; endTime: Date; durationMinutes: number; existingBookingId?: number }
  | { ok: false; reason: string; code: "MISSING_STATE" | "HOLD_EXPIRED" | "MISSING_DETAILS" | "NOT_CONFIRMED" | "INVALID_PHONE" | "INVALID_SERVICE" | "INVALID_RESOURCE" | "INVALID_SLOT" | "SLOT_CONFLICT" | "DUPLICATE" };

type ValidatorOptions = {
  executor?: any;
  callLogId?: number | null;
};

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function validPhone(value: string | null): boolean {
  if (!value) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export async function validateBookingBeforeCreate(
  state: LiveBookingState,
  options: ValidatorOptions = {},
): Promise<BookingValidationResult> {
  const executor = options.executor ?? db;

  if (!state.selectedSlot || !state.companyId) {
    return { ok: false, code: "MISSING_STATE", reason: "The booking no longer has a selected appointment time." };
  }
  if (state.bookingId) {
    return { ok: false, code: "DUPLICATE", reason: "This booking attempt already created an appointment." };
  }
  if (!state.confirmed) {
    return { ok: false, code: "NOT_CONFIRMED", reason: "The caller has not confirmed the final booking summary." };
  }
  if (!hasValidBookingHold(state.callSid)) {
    return { ok: false, code: "HOLD_EXPIRED", reason: "The temporary hold expired before the booking was completed." };
  }
  if (!state.customerName?.trim() || !state.customerPhone?.trim()) {
    return { ok: false, code: "MISSING_DETAILS", reason: "Name and phone number are required before booking." };
  }
  if (!state.customerPhoneConfirmed) {
    return { ok: false, code: "NOT_CONFIRMED", reason: "The caller has not confirmed the phone number for the appointment." };
  }
  if (!validPhone(state.customerPhone)) {
    return { ok: false, code: "INVALID_PHONE", reason: "The confirmation phone number is not valid." };
  }

  // Persistent retry protection: a Twilio callback can be delivered more than once.
  // A completed AI booking tied to this call log is returned instead of inserted again.
  if (options.callLogId) {
    const existingForCall = await executor.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.callLogId, options.callLogId),
      eq(appointmentsTable.companyId, state.companyId),
      eq(appointmentsTable.source, "ai_voice"),
      ne(appointmentsTable.status, "cancelled"),
    ));
    if (existingForCall.length) {
      return { ok: true, startTime: existingForCall[0].startTime, endTime: existingForCall[0].endTime ?? existingForCall[0].startTime, durationMinutes: 0, existingBookingId: existingForCall[0].id };
    }
  }

  const [resource] = await executor.select().from(bookingResourcesTable).where(and(
    eq(bookingResourcesTable.id, state.selectedSlot.resourceId),
    eq(bookingResourcesTable.companyId, state.companyId),
    eq(bookingResourcesTable.active, true),
  ));
  if (!resource) {
    return { ok: false, code: "INVALID_RESOURCE", reason: "The selected booking resource is no longer available." };
  }

  let durationMinutes = 60;
  if (state.selectedSlot.serviceId != null) {
    const [service] = await executor.select().from(bookingServicesTable).where(and(
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
  const endTime = new Date(state.selectedSlot.endIso);
  if (!Number.isFinite(startTime.getTime()) || !Number.isFinite(endTime.getTime()) || endTime <= startTime) {
    return { ok: false, code: "INVALID_SLOT", reason: "The selected appointment time is invalid." };
  }

  const expectedEnd = new Date(startTime.getTime() + durationMinutes * 60_000);
  if (Math.abs(expectedEnd.getTime() - endTime.getTime()) > 1000) {
    return { ok: false, code: "INVALID_SLOT", reason: "The selected appointment duration no longer matches the service." };
  }

  // Re-read current appointments immediately before insert. When called from the
  // create transaction, this executes after advisory locks are acquired.
  const existing = await executor.select().from(appointmentsTable).where(and(
    eq(appointmentsTable.companyId, state.companyId),
    ne(appointmentsTable.status, "cancelled"),
  ));

  const conflict = existing.some((appointment: any) => {
    if (appointment.resourceId != null && appointment.resourceId !== state.selectedSlot!.resourceId) return false;
    const appointmentEnd = appointment.endTime ?? new Date(appointment.startTime.getTime() + durationMinutes * 60_000);
    return overlaps(startTime, endTime, appointment.startTime, appointmentEnd);
  });

  if (conflict) {
    return { ok: false, code: "SLOT_CONFLICT", reason: "That appointment time was just taken." };
  }

  return { ok: true, startTime, endTime, durationMinutes };
}
