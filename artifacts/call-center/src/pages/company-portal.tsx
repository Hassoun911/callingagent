import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  Activity,
  Building2,
  CalendarDays,
  ChevronRight,
  Clock3,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useGetCompany,
  useListCallLogs,
  useListCampaigns,
  useListPhoneNumbers,
  useListSmsMessages,
} from "@workspace/api-client-react";
import type { AuthUser } from "@/App";
import PortalNavigation from "@/components/portal-navigation";
import Bookings from "@/pages/bookings";
import Calls from "@/pages/calls";
import CampaignDetail from "@/pages/campaign-detail";
import Campaigns from "@/pages/campaigns";
import Contacts from "@/pages/contacts";
import Messages from "@/pages/messages";
import PortalNumberDetail from "@/pages/portal-number-detail";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PORTAL = "/portal";
const LIVE_REFRESH_MS = 4_000;

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "no_show";

type Appointment = {
  id: number;
  customerName: string;
  customerPhone: string;
  title: string;
  startTime: string;
  status: AppointmentStatus;
  createdAt?: string | null;
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

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
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
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function isActiveCall(call: any): boolean {
  const status = String(call.status ?? "").toLowerCase();
  return ["queued", "ringing", "in-progress", "in_progress", "initiated", "answered"].includes(status);
}

function timeValue(item: any): number {
  const value = item.createdAt ?? item.startTime ?? item.updatedAt ?? item.timestamp;
  return value ? new Date(value).getTime() : 0;
}

function StatCard({ label, value, icon: Icon, accent, live }: { label: string; value: number | string; icon: LucideIcon; accent?: string; live?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
          <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">{value}</p>
        </div>
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent ?? "bg-primary/10 text-primary"}`}>
          <Icon className={`h-5 w-5 ${live ? "animate-pulse" : ""}`} />
        </div>
      </div>
      {live && <div className="absolute bottom-0 left-0 h-0.5 w-full animate-pulse bg-emerald-400" />}
    </section>
  );
}

function LiveDashboard({
  companyId,
  numbers,
  campaigns,
  calls,
  messages,
  appointments,
  connected,
  lastUpdatedAt,
  refresh,
}: {
  companyId: number;
  numbers: any[];
  campaigns: any[];
  calls: any[];
  messages: any[];
  appointments: Appointment[];
  connected: boolean;
  lastUpdatedAt: Date | null;
  refresh: () => void;
}) {
  const companyNumberIds = useMemo(() => new Set(numbers.map(number => Number(number.id))), [numbers]);
  const companyLines = useMemo(() => new Set(numbers.map(number => String(number.number))), [numbers]);

  const companyCampaigns = useMemo(
    () => campaigns.filter(campaign => companyNumberIds.has(Number(campaign.fromPhoneNumberId))),
    [campaigns, companyNumberIds],
  );

  const scopedCalls = useMemo(
    () => calls.filter(call => companyLines.has(String(call.toNumber)) || companyLines.has(String(call.fromNumber)) || Number(call.companyId) === companyId),
    [calls, companyId, companyLines],
  );

  const scopedMessages = useMemo(
    () => messages.filter(message => {
      const line = String(message.lineNumber ?? (message.direction === "inbound" ? message.to : message.from) ?? "");
      return companyLines.has(line) || Number(message.companyId) === companyId;
    }),
    [messages, companyId, companyLines],
  );

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(todayStart);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const nextDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const activeCalls = scopedCalls.filter(isActiveCall);
  const unreadMessages = scopedMessages.reduce((sum, message) => sum + Number(message.unread ?? 0), 0);
  const todayBookings = appointments.filter(item => {
    const date = new Date(item.startTime);
    return date >= todayStart && date < tomorrow && item.status !== "cancelled";
  });
  const upcoming = appointments
    .filter(item => new Date(item.startTime) >= now && ["scheduled", "confirmed"].includes(item.status))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const newBookings = appointments.filter(item => {
    const created = item.createdAt ? new Date(item.createdAt) : new Date(item.startTime);
    return created >= new Date(now.getTime() - 24 * 60 * 60 * 1000) && created <= nextDay;
  }).length;

  const activities = useMemo<ActivityItem[]>(() => {
    const callItems = scopedCalls.slice(0, 20).map(call => ({
      id: `call-${call.id}`,
      type: "call" as const,
      title: isActiveCall(call) ? "Call in progress" : `${call.direction === "outbound" ? "Outbound" : "Inbound"} call`,
      detail: formatPhone(call.direction === "outbound" ? call.toNumber : call.fromNumber),
      at: call.createdAt ?? new Date().toISOString(),
      href: `${PORTAL}/calls`,
      icon: call.direction === "outbound" ? PhoneOutgoing : PhoneIncoming,
      live: isActiveCall(call),
    }));

    const messageItems = scopedMessages.slice(0, 20).map(message => ({
      id: `message-${message.id}`,
      type: "message" as const,
      title: message.direction === "outbound" ? "SMS sent" : "New SMS received",
      detail: `${formatPhone(message.direction === "outbound" ? message.to : message.from)}${message.body ? ` · ${String(message.body).slice(0, 70)}` : ""}`,
      at: message.createdAt ?? new Date().toISOString(),
      href: `${PORTAL}/messages`,
      icon: MessageSquare,
    }));

    const bookingItems = appointments.slice(0, 20).map(item => ({
      id: `booking-${item.id}`,
      type: "booking" as const,
      title: item.status === "cancelled" ? "Booking cancelled" : "Booking scheduled",
      detail: `${item.customerName || "Customer"} · ${item.title || "Appointment"}`,
      at: item.createdAt ?? item.startTime,
      href: `${PORTAL}/bookings`,
      icon: CalendarDays,
    }));

    return [...callItems, ...messageItems, ...bookingItems]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 12);
  }, [appointments, scopedCalls, scopedMessages]);

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Live Operations</h1>
            {activeCalls.length > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-300"><Radio className="h-3 w-3 animate-pulse" />{activeCalls.length} live</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Calls, messages, bookings, and campaigns for your company.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${connected ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-amber-500/20 bg-amber-500/5 text-amber-300"}`}>
            {connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            <span>{connected ? "Live" : "Reconnecting"}</span>
            {lastUpdatedAt && <span className="hidden opacity-60 sm:inline">· {lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
          <button type="button" onClick={refresh} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Refresh dashboard"><RefreshCw className="h-4 w-4" /></button>
        </div>
      </header>

      {activeCalls.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06]">
          <div className="flex items-center gap-4 px-5 py-4">
            <div className="relative flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300"><PhoneCall className="h-5 w-5" /><span className="absolute inset-0 animate-ping rounded-full border border-emerald-400/30" /></div>
            <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-emerald-200">Incoming or active call</p><p className="truncate text-xs text-emerald-300/70">{activeCalls.map(call => formatPhone(call.fromNumber)).join(", ")}</p></div>
            <Link href={`${PORTAL}/calls`} className="rounded-lg bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-400/20">Open call logs</Link>
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Live calls" value={activeCalls.length} icon={PhoneCall} accent="bg-emerald-400/10 text-emerald-300" live={activeCalls.length > 0} />
        <StatCard label="Unread SMS" value={unreadMessages} icon={MessageSquare} accent="bg-cyan-400/10 text-cyan-300" />
        <StatCard label="Today's bookings" value={todayBookings.length} icon={CalendarDays} accent="bg-violet-400/10 text-violet-300" />
        <StatCard label="Active campaigns" value={companyCampaigns.filter(item => item.status === "active").length} icon={Target} accent="bg-amber-400/10 text-amber-300" />
        <StatCard label="Phone lines" value={numbers.length} icon={Phone} />
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold text-foreground">Live activity</h2><p className="text-xs text-muted-foreground">Newest calls, texts, and bookings appear automatically.</p></div><Activity className="h-4 w-4 text-muted-foreground" /></div>
          {activities.length === 0 ? <div className="px-5 py-14 text-center text-sm text-muted-foreground">No activity yet.</div> : activities.map((item, index) => {
            const Icon = item.icon;
            return <Link key={item.id} href={item.href} className={`flex items-center gap-3 px-5 py-4 transition hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}><div className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${item.type === "call" ? "bg-emerald-400/10 text-emerald-300" : item.type === "message" ? "bg-cyan-400/10 text-cyan-300" : "bg-violet-400/10 text-violet-300"}`}><Icon className={item.live ? "h-4 w-4 animate-pulse" : "h-4 w-4"} />{item.live && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400" />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div><div className="flex shrink-0 items-center gap-2"><time className="hidden text-[11px] text-muted-foreground sm:block">{formatTime(item.at)}</time><ChevronRight className="h-4 w-4 text-muted-foreground/50" /></div></Link>;
          })}
        </div>

        <div className="space-y-6">
          <section className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold text-foreground">Upcoming bookings</h2><p className="text-xs text-muted-foreground">Next scheduled appointments</p></div><span className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">{upcoming.length}</span></div>
            {upcoming.length === 0 ? <div className="px-5 py-10 text-center text-sm text-muted-foreground">No upcoming bookings.</div> : upcoming.slice(0, 5).map((item, index) => <Link key={item.id} href={`${PORTAL}/bookings`} className={`block px-5 py-4 hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}><div className="flex items-center justify-between gap-3"><p className="truncate text-sm font-medium">{item.customerName || "Customer"}</p><span className="shrink-0 rounded-full bg-violet-400/10 px-2 py-1 text-[10px] capitalize text-violet-300">{item.status}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.title || "Appointment"} · {formatTime(item.startTime)}</p></Link>)}
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold text-foreground">Quick actions</h2><p className="text-xs text-muted-foreground">Jump directly to company operations</p></div><Clock3 className="h-4 w-4 text-muted-foreground" /></div>
            <div className="grid grid-cols-2 gap-2">
              {[{ label: "Call logs", href: `${PORTAL}/calls`, icon: PhoneIncoming }, { label: "Messages", href: `${PORTAL}/messages`, icon: MessageSquare }, { label: "Bookings", href: `${PORTAL}/bookings`, icon: CalendarDays }, { label: "Contacts", href: `${PORTAL}/contacts`, icon: Users }].map(action => { const Icon = action.icon; return <Link key={action.href} href={action.href} className="flex items-center gap-2 rounded-xl border border-border px-3 py-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Icon className="h-4 w-4" />{action.label}</Link>; })}
            </div>
          </section>
        </div>
      </section>

      {newBookings > 0 && <p className="text-xs text-muted-foreground">{newBookings} booking event{newBookings === 1 ? "" : "s"} detected in the current activity window.</p>}
    </div>
  );
}

function PhoneNumbersPage({ companyNumbers }: { companyNumbers: any[] }) {
  const [, navigate] = useLocation();
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <div><h1 className="text-2xl font-bold">Phone Numbers</h1><p className="mt-1 text-sm text-muted-foreground">Manage the phone lines assigned to this company.</p></div>
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {companyNumbers.length === 0 ? <div className="px-5 py-14 text-center text-sm text-muted-foreground">No phone numbers are assigned.</div> : companyNumbers.map((number, index) => <button key={number.id} type="button" onClick={() => navigate(`${PORTAL}/numbers/${number.id}`)} className={`flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Phone className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-mono text-sm font-medium">{formatPhone(number.number)}</p><p className="truncate text-xs text-muted-foreground">{number.friendlyName || "No friendly name"}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[11px] capitalize text-muted-foreground">{number.answerMode?.replace(/_/g, " ") || "Not configured"}</span><ChevronRight className="h-4 w-4 text-muted-foreground/50" /></button>)}
      </div>
    </div>
  );
}

export default function CompanyPortal({ user }: { user: AuthUser }) {
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connected, setConnected] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [location] = useLocation();
  const companyId = user.companyId;

  const company = useGetCompany(companyId ?? 0);
  const phoneNumbersQuery = useListPhoneNumbers();
  const campaignsQuery = useListCampaigns();
  const callsQuery = useListCallLogs({ limit: 200 });
  const messagesQuery = useListSmsMessages({ limit: 500 });
  const appointmentsQuery = useQuery<Appointment[]>({
    queryKey: ["company-portal", companyId, "appointments"],
    queryFn: () => requestJson<Appointment[]>(`${BASE}/api/companies/${companyId}/appointments`),
    enabled: Boolean(companyId),
    staleTime: 0,
  });

  const companyNumbers = useMemo(
    () => (phoneNumbersQuery.data ?? []).filter(number => Number(number.companyId) === companyId),
    [phoneNumbersQuery.data, companyId],
  );
  const companyLines = useMemo(() => new Set(companyNumbers.map(number => String(number.number))), [companyNumbers]);
  const companyCalls = useMemo(
    () => (callsQuery.data ?? []).filter(call => companyLines.has(String(call.toNumber)) || companyLines.has(String(call.fromNumber)) || Number((call as any).companyId) === companyId),
    [callsQuery.data, companyId, companyLines],
  );
  const companyMessages = useMemo(
    () => (messagesQuery.data ?? []).filter(message => {
      const line = String((message as any).lineNumber ?? ((message as any).direction === "inbound" ? (message as any).to : (message as any).from) ?? "");
      return companyLines.has(line) || Number((message as any).companyId) === companyId;
    }),
    [messagesQuery.data, companyId, companyLines],
  );
  const appointments = appointmentsQuery.data ?? [];

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setConnected(false);
      return;
    }
    try {
      await Promise.all([
        phoneNumbersQuery.refetch(),
        campaignsQuery.refetch(),
        callsQuery.refetch(),
        messagesQuery.refetch(),
        appointmentsQuery.refetch(),
      ]);
      setConnected(true);
      setLastUpdatedAt(new Date());
    } catch {
      setConnected(false);
    }
  }, [appointmentsQuery, callsQuery, campaignsQuery, messagesQuery, phoneNumbersQuery]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), LIVE_REFRESH_MS);
    const onFocus = () => void refresh();
    const onOnline = () => { setConnected(true); void refresh(); };
    const onOffline = () => setConnected(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh]);

  useEffect(() => { setMobileOpen(false); }, [location]);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [mobileOpen]);

  useEffect(() => {
    if (!companyId) return;
    const source = new EventSource(`${BASE}/api/companies/${companyId}/events`, { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onmessage = () => {
      setLastUpdatedAt(new Date());
      void queryClient.invalidateQueries();
    };
    source.onerror = () => {
      source.close();
      setConnected(navigator.onLine);
    };
    return () => source.close();
  }, [companyId, queryClient]);

  if (!companyId) return <div className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-red-300">This account is not assigned to a company.</div>;

  const companyName = company.data?.name ?? "Your company";
  const activeCalls = companyCalls.filter(isActiveCall).length;
  const unreadMessages = companyMessages.reduce((sum, message) => sum + Number((message as any).unread ?? 0), 0);
  const recentCutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentCalls = companyCalls.filter(call => timeValue(call) >= recentCutoff).length;
  const newBookings = appointments.filter(item => timeValue(item) >= recentCutoff || new Date(item.startTime).getTime() >= Date.now()).length;
  const liveStats = { activeCalls, unreadMessages, newBookings, recentCalls };

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {mobileOpen && <button type="button" className="fixed inset-0 z-40 bg-black/75 backdrop-blur-[2px] lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <div className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,292px)] transform shadow-2xl transition-transform duration-200 ease-out lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`} aria-hidden={!mobileOpen}><PortalNavigation companyName={companyName} liveStats={liveStats} connected={connected} lastUpdatedAt={lastUpdatedAt} mobile onClose={() => setMobileOpen(false)} /></div>
      <div className="hidden w-[272px] shrink-0 lg:block"><PortalNavigation companyName={companyName} liveStats={liveStats} connected={connected} lastUpdatedAt={lastUpdatedAt} /></div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <button type="button" onClick={() => setMobileOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground lg:hidden" aria-label="Open navigation"><Menu className="h-5 w-5" /></button>
          <div className="min-w-0"><p className="truncate text-sm font-semibold">Company Portal</p><p className="truncate text-[11px] text-muted-foreground">{companyName}</p></div>
          <div className={`ml-auto flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${connected ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-300" : "border-amber-500/20 bg-amber-500/5 text-amber-300"}`}>{connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}<span>{connected ? "Live" : "Reconnecting"}</span>{activeCalls > 0 && <span className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 font-bold"><Radio className="h-3 w-3 animate-pulse" />{activeCalls}</span>}</div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Switch>
            <Route path={PORTAL}>{() => <LiveDashboard companyId={companyId} numbers={companyNumbers} campaigns={campaignsQuery.data ?? []} calls={callsQuery.data ?? []} messages={messagesQuery.data ?? []} appointments={appointments} connected={connected} lastUpdatedAt={lastUpdatedAt} refresh={() => void refresh()} />}</Route>
            <Route path={`${PORTAL}/numbers/:id`}>{() => <PortalNumberDetail companyId={companyId} />}</Route>
            <Route path={`${PORTAL}/numbers`}>{() => <PhoneNumbersPage companyNumbers={companyNumbers} />}</Route>
            <Route path={`${PORTAL}/campaigns/:id`} component={CampaignDetail} />
            <Route path={`${PORTAL}/campaigns`} component={Campaigns} />
            <Route path={`${PORTAL}/calls`} component={Calls} />
            <Route path={`${PORTAL}/messages`} component={Messages} />
            <Route path={`${PORTAL}/contacts`} component={Contacts} />
            <Route path={`${PORTAL}/bookings`} component={Bookings} />
            <Route>{() => <LiveDashboard companyId={companyId} numbers={companyNumbers} campaigns={campaignsQuery.data ?? []} calls={callsQuery.data ?? []} messages={messagesQuery.data ?? []} appointments={appointments} connected={connected} lastUpdatedAt={lastUpdatedAt} refresh={() => void refresh()} />}</Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
