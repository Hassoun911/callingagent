import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  Activity,
  CalendarDays,
  ChevronRight,
  Menu,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneOutgoing,
  Radio,
  RefreshCw,
  Target,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useGetCompany } from "@workspace/api-client-react";
import type { AuthUser } from "@/App";
import PortalNavigation from "@/components/portal-navigation";
import PortalNumberDetail from "@/pages/portal-number-detail";
import Calls from "@/pages/calls";
import Messages from "@/pages/messages";
import Contacts from "@/pages/contacts";
import Bookings from "@/pages/bookings";
import Campaigns from "@/pages/campaigns";
import CampaignDetail from "@/pages/campaign-detail";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PORTAL = "/portal";
const FALLBACK_REFRESH_MS = 15_000;
const EVENT_DEBOUNCE_MS = 750;

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "no_show";

type Appointment = {
  id: number;
  companyId?: number | null;
  customerName: string;
  customerPhone: string;
  title: string;
  startTime: string;
  status: AppointmentStatus;
  createdAt?: string | null;
};

type PortalSnapshot = {
  numbers: any[];
  campaigns: any[];
  calls: any[];
  messages: any[];
  appointments: Appointment[];
  fetchedAt: string;
};

type ActivityItem = {
  id: string;
  type: "call" | "message" | "booking";
  title: string;
  detail: string;
  at: string;
  href: string;
  icon: LucideIcon;
  live?: boolean;
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json() as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // Keep the status fallback.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function loadPortalSnapshot(companyId: number, signal?: AbortSignal): Promise<PortalSnapshot> {
  const [numbers, campaigns, calls, messages, appointments] = await Promise.all([
    fetchJson<any[]>(`${BASE}/api/phone-numbers`, signal),
    fetchJson<any[]>(`${BASE}/api/campaigns`, signal),
    fetchJson<any[]>(`${BASE}/api/call-logs?limit=200`, signal),
    fetchJson<any[]>(`${BASE}/api/sms?limit=500`, signal),
    fetchJson<Appointment[]>(`${BASE}/api/companies/${companyId}/appointments`, signal),
  ]);

  return {
    numbers,
    campaigns,
    calls,
    messages,
    appointments,
    fetchedAt: new Date().toISOString(),
  };
}

function formatPhone(value?: string | null): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10
    ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : value;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function isActiveCall(call: any): boolean {
  return ["queued", "ringing", "in-progress", "in_progress", "initiated", "answered"]
    .includes(String(call.status ?? "").toLowerCase());
}

function timeValue(item: any): number {
  const value = item.createdAt ?? item.startTime ?? item.updatedAt ?? item.timestamp;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function StatCard({ label, value, icon: Icon, className = "", live = false }: {
  label: string;
  value: number;
  icon: LucideIcon;
  className?: string;
  live?: boolean;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-3 text-3xl font-bold tabular-nums">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${className || "bg-primary/10 text-primary"}`}>
          <Icon className={`h-5 w-5 ${live ? "animate-pulse" : ""}`} />
        </div>
      </div>
      {live && <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-emerald-400" />}
    </section>
  );
}

function PhoneNumbersPage({ numbers }: { numbers: any[] }) {
  const [, navigate] = useLocation();
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold">Phone Numbers</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage the phone lines assigned to this company.</p>
      </header>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {!numbers.length ? (
          <div className="px-5 py-14 text-center text-sm text-muted-foreground">No phone numbers are assigned.</div>
        ) : numbers.map((number, index) => (
          <button
            key={number.id}
            type="button"
            onClick={() => navigate(`${PORTAL}/numbers/${number.id}`)}
            className={`flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Phone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm font-medium">{formatPhone(number.number)}</p>
              <p className="truncate text-xs text-muted-foreground">{number.friendlyName || "No friendly name"}</p>
            </div>
            <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] capitalize text-muted-foreground">
              {number.answerMode?.replace(/_/g, " ") || "Not configured"}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
          </button>
        ))}
      </div>
    </div>
  );
}

function Dashboard({ snapshot, connected, refreshing, error, refetch }: {
  snapshot: PortalSnapshot;
  connected: boolean;
  refreshing: boolean;
  error: Error | null;
  refetch: () => void;
}) {
  const numbers = snapshot.numbers;
  const numberIds = useMemo(() => new Set(numbers.map(number => Number(number.id))), [numbers]);
  const lines = useMemo(() => new Set(numbers.map(number => String(number.number))), [numbers]);
  const campaigns = useMemo(
    () => snapshot.campaigns.filter(campaign => numberIds.has(Number(campaign.fromPhoneNumberId))),
    [snapshot.campaigns, numberIds],
  );
  const calls = useMemo(
    () => snapshot.calls.filter(call => lines.has(String(call.toNumber)) || lines.has(String(call.fromNumber))),
    [snapshot.calls, lines],
  );
  const messages = useMemo(
    () => snapshot.messages.filter(message => {
      const line = String(message.lineNumber ?? (message.direction === "inbound" ? message.to : message.from) ?? "");
      return lines.has(line);
    }),
    [snapshot.messages, lines],
  );

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const activeCalls = calls.filter(isActiveCall);
  const unreadMessages = messages.reduce((sum, message) => sum + Number(message.unread ?? 0), 0);
  const todayBookings = snapshot.appointments.filter(appointment => {
    const date = new Date(appointment.startTime);
    return date >= start && date < end && appointment.status !== "cancelled";
  });
  const upcoming = snapshot.appointments
    .filter(appointment => new Date(appointment.startTime) >= now && ["scheduled", "confirmed"].includes(appointment.status))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const activity = useMemo<ActivityItem[]>(() => {
    const callItems = calls.slice(0, 20).map(call => ({
      id: `call-${call.id}`,
      type: "call" as const,
      title: isActiveCall(call) ? "Call in progress" : `${call.direction === "outbound" ? "Outbound" : "Inbound"} call`,
      detail: formatPhone(call.direction === "outbound" ? call.toNumber : call.fromNumber),
      at: call.createdAt ?? new Date().toISOString(),
      href: `${PORTAL}/calls`,
      icon: call.direction === "outbound" ? PhoneOutgoing : PhoneIncoming,
      live: isActiveCall(call),
    }));
    const messageItems = messages.slice(0, 20).map(message => ({
      id: `message-${message.id}`,
      type: "message" as const,
      title: message.direction === "outbound" ? "SMS sent" : "New SMS received",
      detail: `${formatPhone(message.direction === "outbound" ? message.to : message.from)}${message.body ? ` · ${String(message.body).slice(0, 70)}` : ""}`,
      at: message.createdAt ?? new Date().toISOString(),
      href: `${PORTAL}/messages`,
      icon: MessageSquare,
    }));
    const bookingItems = snapshot.appointments.slice(0, 20).map(appointment => ({
      id: `booking-${appointment.id}`,
      type: "booking" as const,
      title: appointment.status === "cancelled" ? "Booking cancelled" : "Booking scheduled",
      detail: `${appointment.customerName || "Customer"} · ${appointment.title || "Appointment"}`,
      at: appointment.createdAt ?? appointment.startTime,
      href: `${PORTAL}/bookings`,
      icon: CalendarDays,
    }));
    return [...callItems, ...messageItems, ...bookingItems]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);
  }, [calls, messages, snapshot.appointments]);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Live Operations</h1>
            {activeCalls.length > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                <Radio className="h-3 w-3 animate-pulse" />{activeCalls.length} live
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Calls, messages, bookings, and campaigns for your company.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${connected ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-amber-500/20 bg-amber-500/5 text-amber-300"}`}>
            {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <span>{connected ? "Live" : "Reconnecting"}</span>
            <span className="hidden opacity-60 sm:inline">· {new Date(snapshot.fetchedAt).toLocaleTimeString()}</span>
          </div>
          <button
            type="button"
            onClick={refetch}
            disabled={refreshing}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Refresh dashboard"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          Live synchronization is temporarily unavailable. The most recently loaded data remains visible.
        </div>
      )}

      {activeCalls.length > 0 && (
        <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-5 py-4">
          <div className="flex items-center gap-4">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
              <PhoneCall className="h-5 w-5" />
              <span className="absolute inset-0 animate-ping rounded-full border border-emerald-400/30" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-emerald-200">Incoming or active call</p>
              <p className="truncate text-xs text-emerald-300/70">{activeCalls.map(call => formatPhone(call.fromNumber)).join(", ")}</p>
            </div>
            <Link href={`${PORTAL}/calls`} className="rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200">Open call logs</Link>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Live calls" value={activeCalls.length} icon={PhoneCall} className="bg-emerald-400/10 text-emerald-300" live={activeCalls.length > 0} />
        <StatCard label="Unread SMS" value={unreadMessages} icon={MessageSquare} className="bg-cyan-400/10 text-cyan-300" />
        <StatCard label="Today's bookings" value={todayBookings.length} icon={CalendarDays} className="bg-violet-400/10 text-violet-300" />
        <StatCard label="Active campaigns" value={campaigns.filter(campaign => campaign.status === "active").length} icon={Target} className="bg-amber-400/10 text-amber-300" />
        <StatCard label="Phone lines" value={numbers.length} icon={Phone} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div><h2 className="font-semibold">Live activity</h2><p className="text-xs text-muted-foreground">New calls, texts, and bookings appear automatically.</p></div>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          {!activity.length ? (
            <div className="px-5 py-14 text-center text-sm text-muted-foreground">No activity yet.</div>
          ) : activity.map((item, index) => {
            const Icon = item.icon;
            return (
              <Link key={item.id} href={item.href} className={`flex items-center gap-3 px-5 py-4 transition hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}>
                <div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.type === "call" ? "bg-emerald-400/10 text-emerald-300" : item.type === "message" ? "bg-cyan-400/10 text-cyan-300" : "bg-violet-400/10 text-violet-300"}`}>
                  <Icon className={`h-4 w-4 ${item.live ? "animate-pulse" : ""}`} />
                </div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div>
                <time className="hidden text-[11px] text-muted-foreground sm:block">{formatTime(item.at)}</time>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50" />
              </Link>
            );
          })}
        </div>

        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div><h2 className="font-semibold">Upcoming bookings</h2><p className="text-xs text-muted-foreground">Next scheduled appointments</p></div>
              <span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{upcoming.length}</span>
            </div>
            {!upcoming.length ? (
              <div className="px-5 py-10 text-center text-sm text-muted-foreground">No upcoming bookings.</div>
            ) : upcoming.slice(0, 5).map((appointment, index) => (
              <Link key={appointment.id} href={`${PORTAL}/bookings`} className={`block px-5 py-4 transition hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}>
                <p className="truncate text-sm font-medium">{appointment.customerName || "Customer"}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{appointment.title || "Appointment"} · {formatTime(appointment.startTime)}</p>
              </Link>
            ))}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">Quick actions</h2>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { label: "Call logs", href: `${PORTAL}/calls`, icon: PhoneIncoming },
                { label: "Messages", href: `${PORTAL}/messages`, icon: MessageSquare },
                { label: "Bookings", href: `${PORTAL}/bookings`, icon: CalendarDays },
                { label: "Contacts", href: `${PORTAL}/contacts`, icon: Users },
              ].map(action => {
                const Icon = action.icon;
                return <Link key={action.href} href={action.href} className="flex items-center gap-2 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"><Icon className="h-4 w-4" />{action.label}</Link>;
              })}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

export default function StableCompanyPortal({ user }: { user: AuthUser }) {
  const companyId = user.companyId;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [location] = useLocation();
  const eventTimerRef = useRef<number | null>(null);
  const company = useGetCompany(companyId ?? 0);

  const snapshotQuery = useQuery<PortalSnapshot, Error>({
    queryKey: ["stable-company-portal", companyId],
    queryFn: ({ signal }) => loadPortalSnapshot(companyId as number, signal),
    enabled: Boolean(companyId),
    staleTime: 5_000,
    refetchInterval: online ? FALLBACK_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const scheduleRefetch = useCallback(() => {
    if (eventTimerRef.current !== null) return;
    eventTimerRef.current = window.setTimeout(() => {
      eventTimerRef.current = null;
      if (navigator.onLine && !snapshotQuery.isFetching) void snapshotQuery.refetch();
    }, EVENT_DEBOUNCE_MS);
  }, [snapshotQuery.isFetching, snapshotQuery.refetch]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); scheduleRefetch(); };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [scheduleRefetch]);

  useEffect(() => {
    if (!companyId) return;
    const source = new EventSource(`${BASE}/api/companies/${companyId}/events`, { withCredentials: true });
    source.onmessage = scheduleRefetch;
    source.onerror = () => setOnline(navigator.onLine);
    return () => source.close();
  }, [companyId, scheduleRefetch]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => () => {
    if (eventTimerRef.current !== null) window.clearTimeout(eventTimerRef.current);
  }, []);

  if (!companyId) {
    return <div className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-red-300">This account is not assigned to a company.</div>;
  }

  const snapshot = snapshotQuery.data ?? {
    numbers: [],
    campaigns: [],
    calls: [],
    messages: [],
    appointments: [],
    fetchedAt: new Date().toISOString(),
  };
  const activeCalls = snapshot.calls.filter(isActiveCall).length;
  const unreadMessages = snapshot.messages.reduce((sum, message) => sum + Number(message.unread ?? 0), 0);
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentCalls = snapshot.calls.filter(call => timeValue(call) >= cutoff).length;
  const newBookings = snapshot.appointments.filter(appointment => timeValue(appointment) >= cutoff || new Date(appointment.startTime).getTime() >= Date.now()).length;
  const liveStats = { activeCalls, unreadMessages, recentCalls, newBookings };
  const companyName = company.data?.name ?? "Your company";
  const connected = online && !snapshotQuery.isError;

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-black/75 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,292px)] transform shadow-2xl transition-transform duration-200 lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <PortalNavigation companyName={companyName} liveStats={liveStats} connected={connected} lastUpdatedAt={snapshotQuery.dataUpdatedAt ? new Date(snapshotQuery.dataUpdatedAt) : null} mobile onClose={() => setMobileOpen(false)} />
      </div>
      <div className="hidden w-[272px] shrink-0 lg:block">
        <PortalNavigation companyName={companyName} liveStats={liveStats} connected={connected} lastUpdatedAt={snapshotQuery.dataUpdatedAt ? new Date(snapshotQuery.dataUpdatedAt) : null} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">Company Portal</p><p className="truncate text-[11px] text-muted-foreground">{companyName}</p></div>
          <div className={`ml-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${connected ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-amber-500/20 bg-amber-500/5 text-amber-300"}`}>
            {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            <span>{connected ? "Live" : "Reconnecting"}</span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {snapshotQuery.isPending ? (
            <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted-foreground"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />Loading company operations…</div>
          ) : (
            <Switch>
              <Route path={PORTAL}>{() => <Dashboard snapshot={snapshot} connected={connected} refreshing={snapshotQuery.isFetching} error={snapshotQuery.error ?? null} refetch={() => void snapshotQuery.refetch()} />}</Route>
              <Route path={`${PORTAL}/numbers/:id`}>{() => <PortalNumberDetail companyId={companyId} />}</Route>
              <Route path={`${PORTAL}/numbers`}>{() => <PhoneNumbersPage numbers={snapshot.numbers} />}</Route>
              <Route path={`${PORTAL}/campaigns/:id`} component={CampaignDetail} />
              <Route path={`${PORTAL}/campaigns`} component={Campaigns} />
              <Route path={`${PORTAL}/calls`} component={Calls} />
              <Route path={`${PORTAL}/messages`} component={Messages} />
              <Route path={`${PORTAL}/contacts`} component={Contacts} />
              <Route path={`${PORTAL}/bookings`} component={Bookings} />
              <Route>{() => <Dashboard snapshot={snapshot} connected={connected} refreshing={snapshotQuery.isFetching} error={snapshotQuery.error ?? null} refetch={() => void snapshotQuery.refetch()} />}</Route>
            </Switch>
          )}
        </main>
      </div>
    </div>
  );
}
