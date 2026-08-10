import type { LiveBookingState } from "./booking-state-manager";

export interface BookingRequirements {
  requireServiceLocation: boolean;
  requireVehicle: boolean;
  requireTireCount: boolean;
  requireMountedStatus: boolean;
}

export type MissingBookingDetail = {
  key: "service_location" | "vehicle" | "tire_count" | "mounted_on_rims";
  prompt: string;
  reason: string;
};

const DEFAULT_REQUIREMENTS: BookingRequirements = {
  requireServiceLocation: false,
  requireVehicle: false,
  requireTireCount: false,
  requireMountedStatus: false,
};

/**
 * Company-scoped requirements live here so one customer's intake rules never
 * become global booking behavior. This is intentionally code-backed until the
 * portal gets first-class per-company required-field controls.
 */
export function bookingRequirementsForCompanyName(companyName?: string | null): BookingRequirements {
  const normalized = companyName?.trim().toLowerCase() ?? "";
  if (normalized === "all tire mobile shop") {
    return {
      requireServiceLocation: true,
      requireVehicle: true,
      requireTireCount: true,
      requireMountedStatus: true,
    };
  }
  return DEFAULT_REQUIREMENTS;
}

export function missingRequiredBookingDetail(
  state: LiveBookingState,
  requirements: BookingRequirements,
): MissingBookingDetail | null {
  if (requirements.requireServiceLocation && !state.notes.service_location?.trim()) {
    return {
      key: "service_location",
      prompt: "Before I finalize the appointment, what's the service address, including the city?",
      reason: "The service location is required before this company can book the appointment.",
    };
  }
  if (requirements.requireVehicle && !state.notes.vehicle?.trim()) {
    return {
      key: "vehicle",
      prompt: "What is the year, make, and model of the vehicle?",
      reason: "Vehicle information is required before this company can book the appointment.",
    };
  }
  if (requirements.requireTireCount && !state.serviceAnswers.tire_count?.trim()) {
    return {
      key: "tire_count",
      prompt: "How many tires need service?",
      reason: "The number of tires is required before this company can book the appointment.",
    };
  }
  if (requirements.requireMountedStatus && !state.serviceAnswers.mounted_on_rims?.trim()) {
    return {
      key: "mounted_on_rims",
      prompt: "Are the tires already mounted on rims?",
      reason: "The mounted-on-rims detail is required before this company can book the appointment.",
    };
  }
  return null;
}
