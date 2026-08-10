export type BookingDaypart = "morning" | "afternoon" | "evening" | null;
export type BookingSlotStatus = "none" | "offered" | "held" | "expired" | "confirmed";
export type BookingAction =
  | "ASK_SERVICE"
  | "ASK_DATE"
  | "ASK_DAYPART"
  | "SEARCH_AVAILABILITY"
  | "OFFER_SLOTS"
  | "ASK_NAME"
  | "ASK_PHONE_CONFIRMATION"
  | "ASK_SERVICE_DETAIL"
  | "HOLD_SLOT"
  | "CONFIRM_BOOKING"
  | "CREATE_BOOKING"
  | "BOOKING_COMPLETE"
  | "NO_AVAILABILITY";

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
  requestedTime: string | null;
  availabilityChecked: boolean;
  offeredSlots: BookingSlotState[];
  selectedSlot: BookingSlotState | null;
  slotStatus: BookingSlotStatus;
  holdId: string | null;
  holdExpiresAt: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhoneConfirmed: boolean;
  customerEmail: string | null;
  notes: Record<string, string>;
  confirmed: boolean;
  bookingId: number | null;
  lastAction: BookingAction | null;
  updatedAt: number;
  expiresAt: number;
}

type SlotHold = {
  id: string;
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
    requestedTime: null,
    availabilityChecked: false,
    offeredSlots: [],
    selectedSlot: null,
    slotStatus: "none",
    holdId: null,
    holdExpiresAt: null,
    customerName: null,
    customerPhone: null,
    customerPhoneConfirmed: false,
    customerEmail: null,
    notes: {},
    confirmed: false,
    bookingId: null,
    lastAction: null,
    updatedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  };
}

function touch(state: LiveBookingState): LiveBookingState {
  state.updatedAt = Date.now();
  state.expiresAt = state.updatedAt + DEFAULT_TTL_MS;
  return state;
}

function releaseHoldsForCall(callSid: string, expired = false): void {
  for (const [key, hold] of slotHolds) {
    if (hold.callSid !== callSid) continue;
    slotHolds.delete(key);
  }
  const state = states.get(callSid);
  if (state && state.slotStatus === "held") {
    state.slotStatus = expired ? "expired" : "none";
    state.holdId = null;
    state.holdExpiresAt = null;
    if (expired) state.selectedSlot = null;
    touch(state);
  }
}

export function getBookingState(callSid: string, companyId: number): LiveBookingState {
  const existing = states.get(callSid);
  if (existing && existing.expiresAt > Date.now() && existing.companyId === companyId) return touch(existing);
  if (existing) releaseHoldsForCall(callSid, true);
  const state = fresh(callSid, companyId);
  states.set(callSid, state);
  return state;
}

export function peekBookingState(callSid: string): LiveBookingState | null {
  const state = states.get(callSid);
  if (!state || state.expiresAt <= Date.now()) return null;
  if (state.holdExpiresAt && state.holdExpiresAt <= Date.now() && state.slotStatus === "held") {
    releaseHoldsForCall(callSid, true);
  }
  return states.get(callSid) ?? null;
}

export function setBookingAction(callSid: string, companyId: number, action: BookingAction): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  state.lastAction = action;
  return touch(state);
}

export function setSchedulingPreference(
  callSid: string,
  companyId: number,
  patch: {
    requestedDay?: string | null;
    requestedDaypart?: BookingDaypart;
    requestedTime?: string | null;
    serviceId?: number | null;
    serviceName?: string | null;
  },
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  const dayChanged = patch.requestedDay !== undefined && patch.requestedDay !== state.requestedDay;
  const partChanged = patch.requestedDaypart !== undefined && patch.requestedDaypart !== state.requestedDaypart;
  const timeChanged = patch.requestedTime !== undefined && patch.requestedTime !== state.requestedTime;
  const serviceChanged = patch.serviceId !== undefined && patch.serviceId !== state.serviceId;
  const serviceNameChanged = patch.serviceName !== undefined && patch.serviceName !== state.serviceName;

  if (patch.requestedDay !== undefined) state.requestedDay = patch.requestedDay;
  if (patch.requestedDaypart !== undefined) state.requestedDaypart = patch.requestedDaypart;
  if (patch.requestedTime !== undefined) state.requestedTime = patch.requestedTime;
  if (patch.serviceId !== undefined) state.serviceId = patch.serviceId;
  if (patch.serviceName !== undefined) state.serviceName = patch.serviceName;

  if (dayChanged || partChanged || timeChanged || serviceChanged || serviceNameChanged) {
    // Dependency-based invalidation: keep caller identity and unrelated details,
    // but invalidate all calendar-derived data whenever scheduling inputs change.
    releaseHoldsForCall(callSid);
    state.availabilityChecked = false;
    state.offeredSlots = [];
    state.selectedSlot = null;
    state.slotStatus = "none";
    state.holdId = null;
    state.holdExpiresAt = null;
    state.confirmed = false;
    state.bookingId = null;
  }

  return touch(state);
}

export function setAvailabilityResult(callSid: string, companyId: number, slots: BookingSlotState[]): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  releaseHoldsForCall(callSid);
  state.availabilityChecked = true;
  state.offeredSlots = slots;
  state.selectedSlot = null;
  state.slotStatus = slots.length ? "offered" : "none";
  state.holdId = null;
  state.holdExpiresAt = null;
  state.confirmed = false;
  return touch(state);
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
  const hold: SlotHold = {
    id: `${callSid}:${slot.resourceId}:${now}`,
    callSid,
    companyId,
    resourceId: slot.resourceId,
    iso: slot.iso,
    expiresAt: now + holdMs,
  };
  slotHolds.set(key, hold);

  const state = getBookingState(callSid, companyId);
  state.selectedSlot = slot;
  state.offeredSlots = state.offeredSlots.length ? state.offeredSlots : [slot];
  state.availabilityChecked = true;
  state.slotStatus = "held";
  state.holdId = hold.id;
  state.holdExpiresAt = hold.expiresAt;
  state.confirmed = false;
  return touch(state);
}

export function isSlotHeldByAnother(callSid: string, companyId: number, resourceId: number, iso: string): boolean {
  const key = holdKey(companyId, resourceId, iso);
  const hold = slotHolds.get(key);
  if (!hold) return false;
  if (hold.expiresAt <= Date.now()) {
    slotHolds.delete(key);
    return false;
  }
  return hold.callSid !== callSid;
}

export function hasValidBookingHold(callSid: string): boolean {
  const state = peekBookingState(callSid);
  if (!state || state.slotStatus !== "held" || !state.selectedSlot || !state.holdId || !state.holdExpiresAt) return false;
  if (state.holdExpiresAt <= Date.now()) return false;
  const hold = slotHolds.get(holdKey(state.companyId, state.selectedSlot.resourceId, state.selectedSlot.iso));
  return !!hold && hold.callSid === callSid && hold.id === state.holdId && hold.expiresAt > Date.now();
}

export function releaseBookingHold(callSid: string): void {
  releaseHoldsForCall(callSid);
}

export function setCustomerDetails(
  callSid: string,
  companyId: number,
  patch: {
    customerName?: string | null;
    customerPhone?: string | null;
    customerPhoneConfirmed?: boolean;
    customerEmail?: string | null;
    notes?: Record<string, string>;
  },
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (patch.customerName !== undefined) state.customerName = patch.customerName;
  if (patch.customerPhone !== undefined) state.customerPhone = patch.customerPhone;
  if (patch.customerPhoneConfirmed !== undefined) state.customerPhoneConfirmed = patch.customerPhoneConfirmed;
  if (patch.customerEmail !== undefined) state.customerEmail = patch.customerEmail;
  if (patch.notes) state.notes = { ...state.notes, ...patch.notes };
  return touch(state);
}

export function markBookingConfirmed(callSid: string, companyId: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  state.confirmed = true;
  return touch(state);
}

export function markBookingCreated(callSid: string, companyId: number, bookingId: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  state.confirmed = true;
  state.bookingId = bookingId;
  state.slotStatus = "confirmed";
  state.lastAction = "BOOKING_COMPLETE";
  releaseHoldsForCall(callSid);
  state.slotStatus = "confirmed";
  return touch(state);
}

export function bookingStatePrompt(state: LiveBookingState): string {
  const known = [
    state.serviceName ? `service=${state.serviceName}` : null,
    state.requestedDay ? `requested_day=${state.requestedDay}` : null,
    state.requestedDaypart ? `daypart=${state.requestedDaypart}` : null,
    state.requestedTime ? `preferred_time=${state.requestedTime}` : null,
    state.selectedSlot ? `selected_slot=${state.selectedSlot.label}` : null,
    state.customerName ? `customer_name=${state.customerName}` : null,
    state.customerPhone ? `customer_phone=${state.customerPhone}` : null,
    state.customerEmail ? `customer_email=${state.customerEmail}` : null,
  ].filter(Boolean).join(", ");

  return `[BOOKING STATE - INTERNAL ONLY: ${known || "intent detected; scheduling details not collected yet"}. availability_checked=${state.availabilityChecked}. slot_status=${state.slotStatus}. last_action=${state.lastAction ?? "none"}. offered_slots=${state.offeredSlots.map(slot => slot.label).join(" | ") || "none"}. Ask only for the next missing piece. Never ask for a value already present here. If the caller changes one field, preserve every unrelated field and invalidate only dependent scheduling data.]`;
}

export function clearBookingState(callSid: string): void {
  releaseHoldsForCall(callSid);
  states.delete(callSid);
}

export function expireBookingStates(now = Date.now()): void {
  for (const [callSid, state] of states) {
    if (state.holdExpiresAt && state.holdExpiresAt <= now && state.slotStatus === "held") releaseHoldsForCall(callSid, true);
    if (state.expiresAt <= now) {
      releaseHoldsForCall(callSid, true);
      states.delete(callSid);
    }
  }
  for (const [key, hold] of slotHolds) {
    if (hold.expiresAt <= now) slotHolds.delete(key);
  }
}
