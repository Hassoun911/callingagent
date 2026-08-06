export type PortalVisibility = {
  pages: {
    dashboard: boolean;
    phoneNumbers: boolean;
    campaigns: boolean;
    callLogs: boolean;
    messages: boolean;
    contacts: boolean;
    bookings: boolean;
    users: boolean;
  };
  dashboard: {
    liveCalls: boolean;
    unreadSms: boolean;
    todaysBookings: boolean;
    activeCampaigns: boolean;
    phoneLines: boolean;
    activityFeed: boolean;
    upcomingBookings: boolean;
    quickActions: boolean;
  };
  phoneNumber: {
    answerMode: boolean;
    forwarding: boolean;
    greeting: boolean;
    language: boolean;
    aiInstructions: boolean;
    voice: boolean;
    voicemailGreeting: boolean;
    lineIdentity: boolean;
    notificationEmail: boolean;
    testCall: boolean;
    twilioStatus: boolean;
  };
};

export const DEFAULT_PORTAL_VISIBILITY: PortalVisibility = {
  pages: {
    dashboard: true,
    phoneNumbers: true,
    campaigns: true,
    callLogs: true,
    messages: true,
    contacts: true,
    bookings: true,
    users: true,
  },
  dashboard: {
    liveCalls: true,
    unreadSms: true,
    todaysBookings: true,
    activeCampaigns: true,
    phoneLines: true,
    activityFeed: true,
    upcomingBookings: true,
    quickActions: true,
  },
  phoneNumber: {
    answerMode: true,
    forwarding: true,
    greeting: true,
    language: true,
    aiInstructions: false,
    voice: false,
    voicemailGreeting: true,
    lineIdentity: true,
    notificationEmail: true,
    testCall: true,
    twilioStatus: true,
  },
};

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export async function getPortalVisibility(companyId: number): Promise<PortalVisibility> {
  const response = await fetch(`${BASE}/api/companies/${companyId}/portal-visibility`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) return DEFAULT_PORTAL_VISIBILITY;
  const value = await response.json();
  return {
    pages: { ...DEFAULT_PORTAL_VISIBILITY.pages, ...(value?.pages ?? {}) },
    dashboard: { ...DEFAULT_PORTAL_VISIBILITY.dashboard, ...(value?.dashboard ?? {}) },
    phoneNumber: { ...DEFAULT_PORTAL_VISIBILITY.phoneNumber, ...(value?.phoneNumber ?? {}) },
  };
}

export async function savePortalVisibility(companyId: number, settings: PortalVisibility): Promise<PortalVisibility> {
  const response = await fetch(`${BASE}/api/companies/${companyId}/portal-visibility`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? `Save failed (${response.status})`);
  }
  return response.json();
}
