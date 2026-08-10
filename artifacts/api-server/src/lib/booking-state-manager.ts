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

type SlotHold = {
  callSid: string;
  companyId: number;
  resourceId: number;
  iso: string;
  expiresAt: number;
};

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_HOLD_MS = 4 * 60_000;
const states = new Map<string, LiveBookingState>();
const slotHolds = new Map<string, SlotHold>();

function holdKey(companyId: number, resourceId: number, iso: string): string {
  return `${companyId}:${resourceId}:${iso}`;
}

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

function releaseHoldsForCall(callSid: string): void {
  for (const [key, hold] of slotHolds) {
    if (hold.callSid === callSid) slotHolds.delete(key);
  }
}

export function getBookingState(callSid: string, companyId: number): LiveBookingState {
  const existing = states.get(callSid);
  if (existing && existing.expiresAt > Date.now() && existing.companyId === companyId) {
    existing.updatedAt = Date.now();
    existing.expiresAt = Date.now() + DEFAULT_TTL_MS;
    return existing;
  }
  if (existing) releaseHoldsForCall(callSid);
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
    // Preserve unrelated caller information, but invalidate only data that
    // depends on the scheduling preference that changed.
    releaseHoldsForCall(callSid);
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

export function holdBookingSlot(
  callSid: string,
  companyId: number,
  slot: BookingSlotState,
  holdMs = DEFAULT_HOLD_MS,
): LiveBookingState {
  const now = Date.now();
  const key = holdKey(companyId, slot.resourceId, slot.iso);
  const existing = slotHolds.get(key);
  if (existing && existing.expiresAt > now && existing.callSid !== callSid) {
    throw new Error("That appointment time is temporarily being held for another caller.");
  }

  releaseHoldsForCall(callSid);
  slotHolds.set(key, {
    callSid,
    companyId,
    resourceId: slot.resourceId,
    iso: slot.iso,
    expiresAt: now + holdMs,
  });

  const state = getBookingState(callSid, companyId);
  state.selectedSlot = slot;
  state.offeredSlots = state.offeredSlots.length ? state.offeredSlots : [slot];
  state.availabilityChecked = true;
  state.confirmed = false;
  state.updatedAt = now;
  state.expiresAt = now + DEFAULT_TTL_MS;
  return state;
}

export function isSlotHeldByAnother(callSid: string, companyId: number, resourceId: number, iso: string): boolean {
  const hold = slotHolds.get(holdKey(companyId, resourceId, iso));
  if (!hold) return false;
  if (hold.expiresAt <= Date.now()) {
    slotHolds.delete(holdKey(companyId, resourceId, iso));
    return false;
  }
  return hold.callSid !== callSid;
}

export function releaseBookingHold(callSid: string): void {
  releaseHoldsForCall(callSid);
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
  releaseHoldsForCall(callSid);
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
    state.customerEmail ? `customer_email=${state.customerEmail}` : null,
  ].filter(Boolean).join(", ");

  return `[BOOKING STATE - INTERNAL ONLY: ${known || "intent detected; scheduling details not collected yet"}. availability_checked=${state.availabilityChecked}. offered_slots=${state.offeredSlots.map(slot => slot.label).join(" | ") || "none"}. Ask only for the next missing piece. Never ask for a value already present here. If the caller changes one field, preserve every other known field and update only that field. If caller ID is already present, ask whether to use that number instead of making the caller repeat it.]`;
}

export function clearBookingState(callSid: string): void {
  releaseHoldsForCall(callSid);
  states.delete(callSid);
}

export function expireBookingStates(now = Date.now()): void {
  for (const [callSid, state] of states) {
    if (state.expiresAt <= now) {
      releaseHoldsForCall(callSid);
      states.delete(callSid);
    }
  }
  for (const [key, hold] of slotHolds) {
    if (hold.expiresAt <= now) slotHolds.delete(key);
  }
}
