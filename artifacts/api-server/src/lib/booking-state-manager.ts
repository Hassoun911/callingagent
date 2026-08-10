export type BookingDaypart = "morning" | "afternoon" | "evening" | null;
export type BookingSlotStatus = "none" | "offered" | "held" | "expired" | "confirmed";
export type BookingAvailabilityStatus = "not_searched" | "stale" | "searching" | "searched";
export type BookingPhoneSource = "caller_id" | "spoken" | "existing_contact" | null;
export type BookingAction =
  | "ASK_SERVICE"
  | "ASK_DATE"
  | "ASK_DAYPART"
  | "SEARCH_AVAILABILITY"
  | "REVALIDATE_AVAILABILITY"
  | "OFFER_SLOTS"
  | "ASK_NAME"
  | "ASK_PHONE_CONFIRMATION"
  | "ASK_SERVICE_DETAIL"
  | "HOLD_SLOT"
  | "RELEASE_HOLD"
  | "HOLD_EXPIRED"
  | "CONFIRM_BOOKING"
  | "CREATE_BOOKING"
  | "BOOKING_COMPLETE"
  | "NO_AVAILABILITY"
  | "ESCALATE_TO_HUMAN"
  | "CANCEL_BOOKING_FLOW";

export interface BookingSlotState {
  iso: string;
  endIso: string;
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
  availabilityStatus: BookingAvailabilityStatus;
  availabilityChecked: boolean;
  offeredSlots: BookingSlotState[];
  selectedSlot: BookingSlotState | null;
  slotStatus: BookingSlotStatus;
  holdId: string | null;
  holdExpiresAt: number | null;
  customerName: string | null;
  customerPhone: string | null;
  customerPhoneSource: BookingPhoneSource;
  customerPhoneConfirmed: boolean;
  customerEmail: string | null;
  notes: Record<string, string>;
  serviceAnswers: Record<string, string>;
  confirmed: boolean;
  bookingAttempt: number;
  idempotencyKey: string;
  bookingId: number | null;
  lastAction: BookingAction | null;
  stateVersion: number;
  updatedAt: number;
  expiresAt: number;
}

type SlotHold = {
  id: string;
  callSid: string;
  companyId: number;
  serviceId: number | null;
  resourceId: number;
  startIso: string;
  endIso: string;
  expiresAt: number;
};

export class StaleBookingStateError extends Error {
  constructor(public expectedVersion: number, public actualVersion: number) {
    super(`Stale booking state update: expected version ${expectedVersion}, current version ${actualVersion}`);
    this.name = "StaleBookingStateError";
  }
}

const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_HOLD_MS = 4 * 60_000;
const states = new Map<string, LiveBookingState>();
const slotHolds = new Map<string, SlotHold>();

function exactHoldKey(companyId: number, slot: BookingSlotState): string {
  return [companyId, slot.serviceId ?? "none", slot.resourceId, slot.iso, slot.endIso].join(":");
}

function fresh(callSid: string, companyId: number): LiveBookingState {
  const now = Date.now();
  const bookingAttempt = 1;
  return {
    callSid,
    companyId,
    bookingIntent: true,
    serviceId: null,
    serviceName: null,
    requestedDay: null,
    requestedDaypart: null,
    requestedTime: null,
    availabilityStatus: "not_searched",
    availabilityChecked: false,
    offeredSlots: [],
    selectedSlot: null,
    slotStatus: "none",
    holdId: null,
    holdExpiresAt: null,
    customerName: null,
    customerPhone: null,
    customerPhoneSource: null,
    customerPhoneConfirmed: false,
    customerEmail: null,
    notes: {},
    serviceAnswers: {},
    confirmed: false,
    bookingAttempt,
    idempotencyKey: `${callSid}:${bookingAttempt}`,
    bookingId: null,
    lastAction: null,
    stateVersion: 1,
    updatedAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
  };
}

function refreshTtl(state: LiveBookingState): LiveBookingState {
  state.expiresAt = Date.now() + DEFAULT_TTL_MS;
  return state;
}

function mutate(state: LiveBookingState, expectedVersion?: number): LiveBookingState {
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) {
    throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  }
  state.stateVersion += 1;
  state.updatedAt = Date.now();
  state.expiresAt = state.updatedAt + DEFAULT_TTL_MS;
  return state;
}

function releaseHoldsForCall(callSid: string, expired = false, mutateState = true): void {
  for (const [key, hold] of slotHolds) {
    if (hold.callSid === callSid) slotHolds.delete(key);
  }
  const state = states.get(callSid);
  if (!state || state.slotStatus !== "held") return;
  state.slotStatus = expired ? "expired" : "none";
  state.holdId = null;
  state.holdExpiresAt = null;
  if (expired) {
    state.selectedSlot = null;
    state.availabilityStatus = "stale";
    state.availabilityChecked = false;
    state.lastAction = "HOLD_EXPIRED";
  }
  if (mutateState) mutate(state);
}

export function getBookingState(callSid: string, companyId: number): LiveBookingState {
  const existing = states.get(callSid);
  if (existing && existing.expiresAt > Date.now() && existing.companyId === companyId) return refreshTtl(existing);
  if (existing) releaseHoldsForCall(callSid, true, false);
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
  const current = states.get(callSid) ?? null;
  if (current) refreshTtl(current);
  return current;
}

export function setBookingAction(callSid: string, companyId: number, action: BookingAction, expectedVersion?: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  if (state.lastAction === action) return refreshTtl(state);
  state.lastAction = action;
  if (action === "SEARCH_AVAILABILITY" || action === "REVALIDATE_AVAILABILITY") state.availabilityStatus = "searching";
  return mutate(state);
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
    allowServiceChange?: boolean;
  },
  expectedVersion?: number,
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);

  const dayChanged = patch.requestedDay !== undefined && patch.requestedDay !== state.requestedDay;
  const partChanged = patch.requestedDaypart !== undefined && patch.requestedDaypart !== state.requestedDaypart;
  const timeChanged = patch.requestedTime !== undefined && patch.requestedTime !== state.requestedTime;

  // Once a service has been explicitly captured, unrelated later speech must
  // never silently remap it. A deliberate service-change flow must opt in with
  // allowServiceChange=true and will then invalidate only service-dependent data.
  const canChangeService = state.serviceId === null || patch.allowServiceChange === true;
  const serviceChanged = canChangeService && patch.serviceId !== undefined && patch.serviceId !== state.serviceId;
  const serviceNameChanged = canChangeService && patch.serviceName !== undefined && patch.serviceName !== state.serviceName;
  const changed = dayChanged || partChanged || timeChanged || serviceChanged || serviceNameChanged;

  if (!changed) return refreshTtl(state);
  releaseHoldsForCall(callSid, false, false);

  if (patch.requestedDay !== undefined) state.requestedDay = patch.requestedDay;
  if (patch.requestedDaypart !== undefined) state.requestedDaypart = patch.requestedDaypart;
  if (patch.requestedTime !== undefined) state.requestedTime = patch.requestedTime;
  if (canChangeService && patch.serviceId !== undefined) state.serviceId = patch.serviceId;
  if (canChangeService && patch.serviceName !== undefined) state.serviceName = patch.serviceName;

  state.availabilityStatus = "stale";
  state.availabilityChecked = false;
  state.offeredSlots = [];
  state.selectedSlot = null;
  state.slotStatus = "none";
  state.holdId = null;
  state.holdExpiresAt = null;
  state.confirmed = false;
  state.bookingId = null;
  if (serviceChanged || serviceNameChanged) state.serviceAnswers = {};
  return mutate(state);
}

export function setAvailabilityResult(callSid: string, companyId: number, slots: BookingSlotState[], expectedVersion?: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  releaseHoldsForCall(callSid, false, false);
  state.availabilityStatus = "searched";
  state.availabilityChecked = true;
  state.offeredSlots = slots;
  state.selectedSlot = null;
  state.slotStatus = slots.length ? "offered" : "none";
  state.holdId = null;
  state.holdExpiresAt = null;
  state.confirmed = false;
  return mutate(state);
}

export function holdBookingSlot(
  callSid: string,
  companyId: number,
  slot: BookingSlotState,
  holdMs = DEFAULT_HOLD_MS,
  expectedVersion?: number,
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  const now = Date.now();
  const key = exactHoldKey(companyId, slot);
  const existing = slotHolds.get(key);
  if (existing && existing.expiresAt > now && existing.callSid !== callSid) {
    throw new Error("That appointment time is temporarily being held for another caller.");
  }

  releaseHoldsForCall(callSid, false, false);
  const hold: SlotHold = {
    id: `${state.idempotencyKey}:${slot.serviceId ?? "none"}:${slot.resourceId}:${slot.iso}:${slot.endIso}`,
    callSid,
    companyId,
    serviceId: slot.serviceId,
    resourceId: slot.resourceId,
    startIso: slot.iso,
    endIso: slot.endIso,
    expiresAt: now + holdMs,
  };
  slotHolds.set(key, hold);

  state.selectedSlot = slot;
  state.offeredSlots = state.offeredSlots.length ? state.offeredSlots : [slot];
  state.availabilityStatus = "searched";
  state.availabilityChecked = true;
  state.slotStatus = "held";
  state.holdId = hold.id;
  state.holdExpiresAt = hold.expiresAt;
  state.confirmed = false;
  return mutate(state);
}

export function isSlotHeldByAnother(callSid: string, companyId: number, slot: BookingSlotState): boolean {
  const key = exactHoldKey(companyId, slot);
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
  const hold = slotHolds.get(exactHoldKey(state.companyId, state.selectedSlot));
  return !!hold && hold.callSid === callSid && hold.id === state.holdId && hold.expiresAt > Date.now();
}

export function releaseBookingHold(callSid: string, expectedVersion?: number): LiveBookingState | null {
  const state = peekBookingState(callSid);
  if (!state) return null;
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  releaseHoldsForCall(callSid, false, false);
  state.lastAction = "RELEASE_HOLD";
  return mutate(state);
}

export function setCustomerDetails(
  callSid: string,
  companyId: number,
  patch: {
    customerName?: string | null;
    customerPhone?: string | null;
    customerPhoneSource?: BookingPhoneSource;
    customerPhoneConfirmed?: boolean;
    customerEmail?: string | null;
    notes?: Record<string, string>;
    serviceAnswers?: Record<string, string>;
  },
  expectedVersion?: number,
): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  let changed = false;
  const assign = <K extends keyof LiveBookingState>(key: K, value: LiveBookingState[K]) => {
    if (state[key] !== value) { state[key] = value; changed = true; }
  };
  if (patch.customerName !== undefined) assign("customerName", patch.customerName);
  if (patch.customerPhone !== undefined) assign("customerPhone", patch.customerPhone);
  if (patch.customerPhoneSource !== undefined) assign("customerPhoneSource", patch.customerPhoneSource);
  if (patch.customerPhoneConfirmed !== undefined) assign("customerPhoneConfirmed", patch.customerPhoneConfirmed);
  if (patch.customerEmail !== undefined) assign("customerEmail", patch.customerEmail);
  if (patch.notes) { state.notes = { ...state.notes, ...patch.notes }; changed = true; }
  if (patch.serviceAnswers) { state.serviceAnswers = { ...state.serviceAnswers, ...patch.serviceAnswers }; changed = true; }
  return changed ? mutate(state) : refreshTtl(state);
}

export function markBookingConfirmed(callSid: string, companyId: number, expectedVersion?: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  if (state.confirmed) return refreshTtl(state);
  state.confirmed = true;
  return mutate(state);
}

export function beginNewBookingAttempt(callSid: string, companyId: number, expectedVersion?: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  state.bookingAttempt += 1;
  state.idempotencyKey = `${callSid}:${state.bookingAttempt}`;
  state.bookingId = null;
  state.confirmed = false;
  return mutate(state);
}

export function markBookingCreated(callSid: string, companyId: number, bookingId: number, expectedVersion?: number): LiveBookingState {
  const state = getBookingState(callSid, companyId);
  if (expectedVersion !== undefined && state.stateVersion !== expectedVersion) throw new StaleBookingStateError(expectedVersion, state.stateVersion);
  state.confirmed = true;
  state.bookingId = bookingId;
  releaseHoldsForCall(callSid, false, false);
  state.slotStatus = "confirmed";
  state.lastAction = "BOOKING_COMPLETE";
  return mutate(state);
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
    state.notes.service_location ? `service_location=${state.notes.service_location}` : null,
    state.notes.vehicle ? `vehicle=${state.notes.vehicle}` : null,
    state.serviceAnswers.tire_count ? `tire_count=${state.serviceAnswers.tire_count}` : null,
    state.serviceAnswers.mounted_on_rims ? `mounted_on_rims=${state.serviceAnswers.mounted_on_rims}` : null,
  ].filter(Boolean).join(", ");
  return `[BOOKING STATE - INTERNAL ONLY: ${known || "intent detected; scheduling details not collected yet"}. state_version=${state.stateVersion}. availability_status=${state.availabilityStatus}. slot_status=${state.slotStatus}. last_action=${state.lastAction ?? "none"}. offered_slots=${state.offeredSlots.map(slot => slot.label).join(" | ") || "none"}. Ask only for the next missing piece. Never ask for a value already present here. If the caller changes one field, preserve every unrelated field and invalidate only dependent scheduling data.]`;
}

export function clearBookingState(callSid: string): void {
  releaseHoldsForCall(callSid, false, false);
  states.delete(callSid);
}

export function expireBookingStates(now = Date.now()): void {
  for (const [callSid, state] of states) {
    if (state.holdExpiresAt && state.holdExpiresAt <= now && state.slotStatus === "held") releaseHoldsForCall(callSid, true);
    if (state.expiresAt <= now) {
      releaseHoldsForCall(callSid, true, false);
      states.delete(callSid);
    }
  }
  for (const [key, hold] of slotHolds) if (hold.expiresAt <= now) slotHolds.delete(key);
}
