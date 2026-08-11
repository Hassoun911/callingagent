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
import { DEFAULT_PORTAL_VISIBILITY, getPortalVisibility, type PortalVisibility } from "@/lib/portal-visibility";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PORTAL = "/portal";
const REFRESH_MS = 15_000;

type Appointment = {
  id: number;
  customerName: string;
  customerPhone: string;
  title: string;
  startTime: string;
  status: string;
  createdAt?: string | null;
};

type Snapshot = {
  numbers: any[];
  campaigns: any[];
  calls: any[];
  messages: any[];
  appointments: Appointment[];
  fetchedAt: string;
};

type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  at: string;
  href: string;
  icon: LucideIcon;
  kind: "call" | "message" | "booking";
  live?: boolean;
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "include", cache: "no-store", signal });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function loadSnapshot(companyId: number, signal?: AbortSignal): Promise<Snapshot> {
  const [numbers, campaigns, calls, messages, appointments] = await Promise.all([
    fetchJson<any[]>(`${BASE}/api/phone-numbers`, signal),
    fetchJson<any[]>(`${BASE}/api/campaigns`, signal),
    fetchJson<any[]>(`${BASE}/api/call-logs?limit=200`, signal),
    fetchJson<any[]>(`${BASE}/api/sms?limit=500`, signal),
    fetchJson<Appointment[]>(`${BASE}/api/companies/${companyId}/appointments`, signal),
  ]);
  return { numbers, campaigns, calls, messages, appointments, fetchedAt: new Date().toISOString() };
}

function formatPhone(value?: string | null): string {
  if (!value) return "Unknown";
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : value;
}

function isActiveCall(call: any): boolean {
  return ["queued", "ringing", "in-progress", "in_progress", "initiated", "answered"].includes(String(call.status ?? "").toLowerCase());
}

function eventTime(item: any): number {
  const value = item.createdAt ?? item.startTime ?? item.updatedAt;
  return value ? new Date(value).getTime() : 0;
}

function Restricted() {
  return <div className="mx-auto max-w-xl p-8"><div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 text-center"><h1 className="text-lg font-semibold text-amber-200">Feature unavailable</h1><p className="mt-2 text-sm text-amber-200/70">This section is managed by the main administrator.</p><Link href={PORTAL} className="mt-5 inline-flex rounded-lg border border-amber-500/20 px-4 py-2 text-sm text-amber-200">Return to dashboard</Link></div></div>;
}

function Stat({ label, value, icon: Icon, style, live = false }: { label: string; value: number; icon: LucideIcon; style: string; live?: boolean }) {
  return <section className="relative overflow-hidden rounded-2xl border border-border bg-card p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-3 text-3xl font-bold tabular-nums">{value}</p></div><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${style}`}><Icon className={`h-5 w-5 ${live ? "animate-pulse" : ""}`} /></div></div>{live && <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-emerald-400" />}</section>;
}

function PhoneNumbersPage({ numbers }: { numbers: any[] }) {
  const [, navigate] = useLocation();
  return <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8"><header><h1 className="text-2xl font-bold">Phone Numbers</h1><p className="mt-1 text-sm text-muted-foreground">Manage the phone lines assigned to this company.</p></header><div className="overflow-hidden rounded-2xl border border-border bg-card">{numbers.length === 0 ? <div className="px-5 py-14 text-center text-sm text-muted-foreground">No phone numbers are assigned.</div> : numbers.map((number, index) => <button key={number.id} type="button" onClick={() => navigate(`${PORTAL}/numbers/${number.id}`)} className={`flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Phone className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-mono text-sm font-medium">{formatPhone(number.number)}</p><p className="truncate text-xs text-muted-foreground">{number.friendlyName || "No friendly name"}</p></div><ChevronRight className="h-4 w-4 text-muted-foreground" /></button>)}</div></div>;
}

function Dashboard({ snapshot, visibility, connected, refreshing, refresh }: { snapshot: Snapshot; visibility: PortalVisibility; connected: boolean; refreshing: boolean; refresh: () => void }) {
  const numbers = snapshot.numbers;
  const numberIds = useMemo(() => new Set(numbers.map(item => Number(item.id))), [numbers]);
  const lines = useMemo(() => new Set(numbers.map(item => String(item.number))), [numbers]);
  const campaigns = snapshot.campaigns.filter(item => numberIds.has(Number(item.fromPhoneNumberId)));
  const calls = snapshot.calls.filter(item => lines.has(String(item.toNumber)) || lines.has(String(item.fromNumber)));
  const messages = snapshot.messages.filter(item => lines.has(String(item.lineNumber ?? (item.direction === "inbound" ? item.to : item.from) ?? "")));
  const activeCalls = calls.filter(isActiveCall);
  const unreadMessages = messages.reduce((sum, item) => sum + Number(item.unread ?? 0), 0);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const todaysBookings = snapshot.appointments.filter(item => { const date = new Date(item.startTime); return date >= today && date < tomorrow && item.status !== "cancelled"; });
  const upcoming = snapshot.appointments.filter(item => new Date(item.startTime) >= now && ["scheduled", "confirmed"].includes(item.status)).sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime));

  const activity = useMemo<ActivityItem[]>(() => {
    const callItems = calls.slice(0, 20).map(item => ({ id: `call-${item.id}`, title: isActiveCall(item) ? "Call in progress" : `${item.direction === "outbound" ? "Outbound" : "Inbound"} call`, detail: formatPhone(item.direction === "outbound" ? item.toNumber : item.fromNumber), at: item.createdAt ?? new Date().toISOString(), href: `${PORTAL}/calls`, icon: item.direction === "outbound" ? PhoneOutgoing : PhoneIncoming, kind: "call" as const, live: isActiveCall(item) }));
    const messageItems = messages.slice(0, 20).map(item => ({ id: `message-${item.id}`, title: item.direction === "outbound" ? "SMS sent" : "New SMS received", detail: `${formatPhone(item.direction === "outbound" ? item.to : item.from)}${item.body ? ` · ${String(item.body).slice(0, 70)}` : ""}`, at: item.createdAt ?? new Date().toISOString(), href: `${PORTAL}/messages`, icon: MessageSquare, kind: "message" as const }));
    const bookingItems = snapshot.appointments.slice(0, 20).map(item => ({ id: `booking-${item.id}`, title: item.status === "cancelled" ? "Booking cancelled" : "Booking scheduled", detail: `${item.customerName || "Customer"} · ${item.title || "Appointment"}`, at: item.createdAt ?? item.startTime, href: `${PORTAL}/bookings`, icon: CalendarDays, kind: "booking" as const }));
    return [...callItems, ...messageItems, ...bookingItems].sort((a, b) => +new Date(b.at) - +new Date(a.at)).slice(0, 12);
  }, [calls, messages, snapshot.appointments]);

  const d = visibility.dashboard;
  return <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8"><header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h1 className="text-2xl font-bold sm:text-3xl">Live Operations</h1><p className="mt-1 text-sm text-muted-foreground">Calls, messages, bookings, and campaigns for your company.</p></div><div className="flex gap-2"><div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${connected ? "border-emerald-500/20 text-emerald-300" : "border-amber-500/20 text-amber-300"}`}>{connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{connected ? "Live" : "Reconnecting"}</div><button onClick={refresh} disabled={refreshing} className="h-10 w-10 rounded-xl border border-border"><RefreshCw className={`mx-auto h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /></button></div></header>

  {d.liveCalls && activeCalls.length > 0 && <section className="rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] px-5 py-4"><div className="flex items-center gap-4"><PhoneCall className="h-6 w-6 animate-pulse text-emerald-300" /><div className="flex-1"><p className="font-semibold text-emerald-200">Active call</p><p className="text-xs text-emerald-300/70">{activeCalls.map(item => formatPhone(item.fromNumber)).join(", ")}</p></div></div></section>}

  <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">{d.liveCalls && <Stat label="Live calls" value={activeCalls.length} icon={PhoneCall} style="bg-emerald-400/10 text-emerald-300" live={activeCalls.length > 0} />}{d.unreadSms && <Stat label="Unread SMS" value={unreadMessages} icon={MessageSquare} style="bg-cyan-400/10 text-cyan-300" />}{d.todaysBookings && <Stat label="Today's bookings" value={todaysBookings.length} icon={CalendarDays} style="bg-violet-400/10 text-violet-300" />}{d.activeCampaigns && <Stat label="Active campaigns" value={campaigns.filter(item => item.status === "active").length} icon={Target} style="bg-amber-400/10 text-amber-300" />}{d.phoneLines && <Stat label="Phone lines" value={numbers.length} icon={Phone} style="bg-blue-400/10 text-blue-300" />}</section>

  <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.8fr]">{d.activityFeed && <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="font-semibold">Live activity</h2><p className="text-xs text-muted-foreground">Newest events appear automatically.</p></div><Activity className="h-4 w-4" /></div>{activity.length === 0 ? <div className="p-12 text-center text-sm text-muted-foreground">No activity yet.</div> : activity.map((item, index) => { const Icon = item.icon; return <Link key={item.id} href={item.href} className={`flex items-center gap-3 px-5 py-4 hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}><div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.kind === "call" ? "bg-emerald-400/10 text-emerald-300" : item.kind === "message" ? "bg-cyan-400/10 text-cyan-300" : "bg-violet-400/10 text-violet-300"}`}><Icon className={`h-4 w-4 ${item.live ? "animate-pulse" : ""}`} /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.title}</p><p className="truncate text-xs text-muted-foreground">{item.detail}</p></div><ChevronRight className="h-4 w-4" /></Link>; })}</div>}
  <div className="space-y-6">{d.upcomingBookings && <div className="overflow-hidden rounded-2xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Upcoming bookings</h2></div>{upcoming.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No upcoming bookings.</div> : upcoming.slice(0, 5).map((item, index) => <Link key={item.id} href={`${PORTAL}/bookings`} className={`block px-5 py-4 hover:bg-muted/30 ${index ? "border-t border-border" : ""}`}><p className="text-sm font-medium">{item.customerName}</p><p className="text-xs text-muted-foreground">{item.title} · {new Date(item.startTime).toLocaleString()}</p></Link>)}</div>}{d.quickActions && <div className="rounded-2xl border border-border bg-card p-5"><h2 className="font-semibold">Quick actions</h2><div className="mt-4 grid grid-cols-2 gap-2">{visibility.pages.callLogs && <Link href={`${PORTAL}/calls`} className="rounded-xl border border-border p-3 text-xs">Call logs</Link>}{visibility.pages.messages && <Link href={`${PORTAL}/messages`} className="rounded-xl border border-border p-3 text-xs">Messages</Link>}{visibility.pages.bookings && <Link href={`${PORTAL}/bookings`} className="rounded-xl border border-border p-3 text-xs">Bookings</Link>}{visibility.pages.contacts && <Link href={`${PORTAL}/contacts`} className="rounded-xl border border-border p-3 text-xs">Contacts</Link>}</div></div>}</div></section></div>;
}

export default function CompanyPortalControlled({ user }: { user: AuthUser }) {
  const companyId = user.companyId;
  const company = useGetCompany(companyId ?? 0);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const [visibility, setVisibility] = useState<PortalVisibility>(DEFAULT_PORTAL_VISIBILITY);
  const [connected, setConnected] = useState(navigator.onLine);
  const controller = useRef<AbortController | null>(null);
  const refreshing = useRef(false);

  const snapshot = useQuery<Snapshot>({
    queryKey: ["controlled-company-portal", companyId],
    queryFn: ({ signal }) => loadSnapshot(companyId!, signal),
    enabled: Boolean(companyId),
    staleTime: 10_000,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { await snapshot.refetch(); setConnected(true); } catch { setConnected(false); } finally { refreshing.current = false; }
  }, [snapshot.refetch]);

  useEffect(() => {
    if (!companyId) return;
    void getPortalVisibility(companyId).then(setVisibility);
    const source = new EventSource(`${BASE}/api/companies/${companyId}/events`, { withCredentials: true });
    source.onopen = () => setConnected(true);
    source.onmessage = () => void refresh();
    source.onerror = () => setConnected(navigator.onLine);
    return () => { source.close(); controller.current?.abort(); };
  }, [companyId, refresh]);

  useEffect(() => { setMobileOpen(false); }, [location]);
  if (!companyId) return <Restricted />;

  const numbers = (snapshot.data?.numbers ?? []).filter(item => Number(item.companyId) === companyId);
  const lines = new Set(numbers.map(item => String(item.number)));
  const calls = (snapshot.data?.calls ?? []).filter(item => lines.has(String(item.toNumber)) || lines.has(String(item.fromNumber)));
  const messages = (snapshot.data?.messages ?? []).filter(item => lines.has(String(item.lineNumber ?? (item.direction === "inbound" ? item.to : item.from) ?? "")));
  const liveStats = {
    activeCalls: calls.filter(isActiveCall).length,
    unreadMessages: messages.reduce((sum, item) => sum + Number(item.unread ?? 0), 0),
    newBookings: (snapshot.data?.appointments ?? []).filter(item => eventTime(item) >= Date.now() - 86400000 || +new Date(item.startTime) >= Date.now()).length,
    recentCalls: calls.filter(item => eventTime(item) >= Date.now() - 86400000).length,
  };
  const companyName = company.data?.name ?? "Your company";
  const rawCompanyPhone = numbers[0]?.number ?? company.data?.phone ?? null;
  const companyPhone = rawCompanyPhone ? formatPhone(String(rawCompanyPhone)) : null;
  const data = snapshot.data ?? { numbers: [], campaigns: [], calls: [], messages: [], appointments: [], fetchedAt: new Date().toISOString() };

  const allowed = (key: keyof PortalVisibility["pages"], content: JSX.Element) => visibility.pages[key] ? content : <Restricted />;

  return <div className="flex h-dvh overflow-hidden bg-background text-foreground">{mobileOpen && <button className="fixed inset-0 z-40 bg-black/75 lg:hidden" onClick={() => setMobileOpen(false)} />}
    <div className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,292px)] transition-transform lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}><PortalNavigation companyName={companyName} liveStats={liveStats} connected={connected} lastUpdatedAt={snapshot.data ? new Date(snapshot.data.fetchedAt) : null} mobile onClose={() => setMobileOpen(false)} /></div>
    <div className="hidden w-[272px] shrink-0 lg:block"><PortalNavigation companyName={companyName} liveStats={liveStats} connected={connected} lastUpdatedAt={snapshot.data ? new Date(snapshot.data.fetchedAt) : null} /></div>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden"><header className="flex h-16 items-center border-b border-border px-4 sm:px-6"><button onClick={() => setMobileOpen(true)} className="mr-3 h-10 w-10 rounded-xl border border-border lg:hidden"><Menu className="mx-auto h-5 w-5" /></button><div className="flex min-w-0 items-center gap-5"><div className="min-w-0"><p className="text-sm font-semibold">Company Portal</p><p className="truncate text-[11px] text-muted-foreground">{companyName}</p></div>{companyPhone && <div className="flex items-center gap-2 whitespace-nowrap font-mono text-xl font-black tracking-tight text-cyan-300 sm:text-2xl"><Phone className="h-5 w-5 shrink-0" />{companyPhone}</div>}</div><div className="ml-auto flex items-center gap-2 rounded-full border border-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300"><Wifi className="h-3.5 w-3.5" />Live{liveStats.activeCalls > 0 && <><Radio className="h-3 w-3 animate-pulse" />{liveStats.activeCalls}</>}</div></header>
      <main className="min-h-0 flex-1 overflow-y-auto"><Switch>
        <Route path={PORTAL}>{() => allowed("dashboard", <Dashboard snapshot={{ ...data, numbers }} visibility={visibility} connected={connected} refreshing={snapshot.isFetching} refresh={() => void refresh()} />)}</Route>
        <Route path={`${PORTAL}/numbers/:id`}>{() => allowed("phoneNumbers", <PortalNumberDetail companyId={companyId} />)}</Route>
        <Route path={`${PORTAL}/numbers`}>{() => allowed("phoneNumbers", <PhoneNumbersPage numbers={numbers} />)}</Route>
        <Route path={`${PORTAL}/campaigns/:id`}>{() => allowed("campaigns", <CampaignDetail />)}</Route>
        <Route path={`${PORTAL}/campaigns`}>{() => allowed("campaigns", <Campaigns />)}</Route>
        <Route path={`${PORTAL}/calls`}>{() => allowed("callLogs", <Calls />)}</Route>
        <Route path={`${PORTAL}/messages`}>{() => allowed("messages", <Messages />)}</Route>
        <Route path={`${PORTAL}/contacts`}>{() => allowed("contacts", <Contacts />)}</Route>
        <Route path={`${PORTAL}/bookings`}>{() => allowed("bookings", <Bookings />)}</Route>
        <Route>{() => <Restricted />}</Route>
      </Switch></main>
    </div>
  </div>;
}
