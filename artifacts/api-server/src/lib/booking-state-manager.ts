export type BookingDaypart = "morning" | "afternoon" | "evening" | null;

export interface BookingSlotState {
  iso: string;
  label: string;
  resourceId: number;
  serviceId: number | null;
}

export interface LiveBookingState {
  callSid: string;
  companyId: number;
  bookingIntent: boolean;
  serviceId: number | null;
  serviceName: string | null;
  requestedDay: string | null;
  requestedDaypart: BookingDaypart;
  availabilityChecked: boolean;
  offeredSlots: BookingSlotState[];
  selectedSlot: BookingSlotState | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  notes: Record<string, string>;
  confirmed: boolean;
  updatedAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 15 * 60_000;
const states = new Map<string, LiveBookingState>();

function fresh(callSid: string, companyId: number): LiveBookingState {
  const now = Date.now();
  return {
    callSid,
    companyId,
    bookingIntent: true,
    serviceId: null,
    serviceName: null,
    requestedDay: null,
    requestedDaypart: null,
    availabilityChecked: false,
    offeredSlots: [],
    selectedSlot: null,
    customerName: null,
    customerPhone: null,
    customerEmail: null,
    notes: {},
    confirmed: false,
    updatedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  };
}

export function getBookingState(callSid: string, companyId: number): LiveBookingState {
  const existing = states.get(callSid);
  if (existing && existing.expiresAt > Date.now() && existing.companyId === companyId) {
    existing.updatedAt = Date.now();
    existing.expiresAt = Date.now() + DEFAULT_TTL_MS;
    return existing;
  }
  const state = fresh(callSid, companyId);
  states.set(callSid, state);
  return state;
}

export function peekBookingState(callSid: string): LiveBookingState | null {
  const state = states.get(callSid);
  if (!state || state.expiresAt <= Date.now()) return null;
  return state;
}

export function setSchedulingPreference(
  callSid: string,
  companyId: number,
  patch: { requestedDay?: string | null; requestedDaypart?: BookingDaypart; serviceId?: number | null; serviceName?: string | null },
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  const dayChanged = patch.requestedDay !== undefined && patch.requestedDay !== state.requestedDay;
  const partChanged = patch.requestedDaypart !== undefined && patch.requestedDaypart !== state.requestedDaypart;
  const serviceChanged = patch.serviceId !== undefined && patch.serviceId !== state.serviceId;
  const serviceNameChanged = patch.serviceName !== undefined && patch.serviceName !== state.serviceName;

  if (patch.requestedDay !== undefined) state.requestedDay = patch.requestedDay;
  if (patch.requestedDaypart !== undefined) state.requestedDaypart = patch.requestedDaypart;
  if (patch.serviceId !== undefined) state.serviceId = patch.serviceId;
  if (patch.serviceName !== undefined) state.serviceName = patch.serviceName;

  if (dayChanged || partChanged || serviceChanged || serviceNameChanged) {
    // Changing one scheduling variable must never make the caller restart.
    // Keep customer/service context that is still valid, but invalidate only the
    // calendar-dependent portion of the state.
    state.availabilityChecked = false;
    state.offeredSlots = [];
    state.selectedSlot = null;
    state.confirmed = false;
  }

  state.updatedAt = Date.now();
  state.expiresAt = Date.now() + DEFAULT_TTL_MS;
  return state;
}

export function setAvailabilityResult(callSid: string, companyId: number, slots: BookingSlotState[]): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  state.availabilityChecked = true;
  state.offeredSlots = slots;
  state.selectedSlot = null;
  state.confirmed = false;
  return state;
}

export function selectBookingSlot(callSid: string, companyId: number, slot: BookingSlotState): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  state.selectedSlot = slot;
  state.offeredSlots = state.offeredSlots.length ? state.offeredSlots : [slot];
  state.availabilityChecked = true;
  state.confirmed = false;
  return state;
}

export function setCustomerDetails(
  callSid: string,
  companyId: number,
  patch: { customerName?: string | null; customerPhone?: string | null; customerEmail?: string | null; notes?: Record<string, string> },
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (patch.customerName !== undefined) state.customerName = patch.customerName;
  if (patch.customerPhone !== undefined) state.customerPhone = patch.customerPhone;
  if (patch.customerEmail !== undefined) state.customerEmail = patch.customerEmail;
  if (patch.notes) state.notes = { ...state.notes, ...patch.notes };
  return state;
}

export function markBookingConfirmed(callSid: string, companyId: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  state.confirmed = true;
  return state;
}

export function bookingStatePrompt(state: LiveBookingState): string {
  const known = [
    state.serviceName ? `service=${state.serviceName}` : null,
    state.requestedDay ? `requested_day=${state.requestedDay}` : null,
    state.requestedDaypart ? `daypart=${state.requestedDaypart}` : null,
    state.selectedSlot ? `selected_slot=${state.selectedSlot.label}` : null,
    state.customerName ? `customer_name=${state.customerName}` : null,
    state.customerPhone ? `customer_phone=${state.customerPhone}` : null,
  ].filter(Boolean).join(", ");

  return `[BOOKING STATE - INTERNAL ONLY: ${known || "booking intent detected; scheduling details not collected yet"}. availability_checked=${state.availabilityChecked}. offered_slots=${state.offeredSlots.map(slot => slot.label).join(" | ") || "none"}. Never ask for a value already present here. If the caller changes one field, preserve every other known field and update only that field.]`;
}

export function clearBookingState(callSid: string): void {
  states.delete(callSid);
}

export function expireBookingStates(now = Date.now()): void {
  for (const [callSid, state] of states) {
    if (state.expiresAt <= now) states.delete(callSid);
  }
}
