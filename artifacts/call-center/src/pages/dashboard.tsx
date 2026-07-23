import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardStats, useGetRecentCalls } from "@workspace/api-client-react";
import {
  Activity,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  MessageSquare,
  Phone,
  PhoneForwarded,
  PhoneIncoming,
  PhoneOutgoing,
  Target,
  TrendingUp,
  Users,
  Voicemail,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Campaign {
  id: number;
  name: string;
  status: string;
  totalContacts: number | null;
  interestedContacts: number | null;
}

interface CalendarEvent {
  id: number;
  campaignId: number;
  campaignName: string;
  name: string;
  phone: string;
  eventType: "hot_lead" | "callback";
  callbackAt: string | null;
  calendarNotes: string | null;
  lastAttemptAt: string | null;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw || raw === "Anonymous") return raw ?? "Anonymous";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const number = digits.slice(1);
    return `(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
  }
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon: Icon,
  iconColor,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  icon: React.ElementType;
  iconColor?: string;
  href: string;
}) {
  return (
    <Link href={href} className="block h-full">
      <div className="h-full min-h-[112px] rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40 hover:bg-card/80 active:scale-[0.99] group">
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-xs">{label}</span>
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-background/60">
            <Icon className={`h-4 w-4 ${iconColor ?? "text-muted-foreground"} transition-transform group-hover:scale-110`} />
          </div>
        </div>
        <div className={`font-mono text-2xl font-bold sm:text-3xl ${accent ? "text-green-400" : "text-foreground"}`}>{value}</div>
        {sub && <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{sub}</div>}
      </div>
    </Link>
  );
}

function MiniCard({
  label,
  value,
  icon: Icon,
  iconBg,
  iconColor,
  href,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  href: string;
}) {
  return (
    <Link href={href} className="block min-w-0">
      <div className="flex min-h-[76px] items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:border-primary/40 hover:bg-card/80 active:scale-[0.99] group">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconBg}`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:text-[11px]">{label}</div>
          <div className="truncate font-mono text-lg font-bold leading-tight transition-colors group-hover:text-primary sm:text-xl">{value}</div>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary/60" />
      </div>
    </Link>
  );
}

function QuickLink({
  href,
  icon: Icon,
  iconClass,
  eyebrow,
  title,
}: {
  href: string;
  icon: React.ElementType;
  iconClass: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <Link href={href} className="block min-w-0">
      <div className="flex min-h-[72px] items-center gap-3 rounded-xl border border-border bg-card p-3.5 transition-all hover:border-primary/40 hover:bg-card/80 active:scale-[0.99] group">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${iconClass}`}><Icon className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs text-muted-foreground">{eyebrow}</div>
          <div className="truncate text-sm font-semibold transition-colors group-hover:text-primary">{title}</div>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground/40 transition-colors group-hover:text-primary/60" />
      </div>
    </Link>
  );
}

export default function Dashboard() {
  const [, navigate] = useLocation();
  const [activityOpen, setActivityOpen] = useState(false);
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentCalls, isLoading: callsLoading } = useGetRecentCalls({ limit: 6 });

  const { data: campaigns = [] } = useQuery<Campaign[]>({
    queryKey: ["campaigns-dashboard"],
    queryFn: async () => {
      const response = await fetch(`${BASE}/api/campaigns`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 30000,
  });

  const { data: calendarEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["campaigns-calendar-dashboard"],
    queryFn: async () => {
      const response = await fetch(`${BASE}/api/campaigns/calendar`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    refetchInterval: 30000,
  });

  const activeCampaigns = campaigns.filter(campaign => campaign.status === "active").length;
  const totalHotLeads = calendarEvents.filter(event => event.eventType === "hot_lead").length;
  const callbacksDue = calendarEvents.filter(event => event.eventType === "callback").length;
  const today = new Date().toISOString().slice(0, 10);
  const upcomingEvents = calendarEvents
    .filter(event => {
      const date = event.callbackAt ?? event.lastAttemptAt;
      return !!date && date.slice(0, 10) >= today;
    })
    .sort((a, b) => (a.callbackAt ?? a.lastAttemptAt ?? "").localeCompare(b.callbackAt ?? b.lastAttemptAt ?? ""))
    .slice(0, 5);

  return (
    <div className="space-y-4 pb-24 sm:space-y-5 sm:pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Command Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">Real-time system overview and activity.</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Link href="/numbers" className="block">
            <button className="min-h-11 w-full rounded-lg border border-border bg-background px-3 text-xs font-medium transition-colors hover:bg-secondary sm:min-h-9 sm:w-auto">
              Manage Numbers
            </button>
          </Link>
          <Link href="/campaigns" className="block">
            <button className="min-h-11 w-full rounded-lg border border-green-500/30 bg-green-500/10 px-3 text-xs font-medium text-green-400 transition-colors hover:bg-green-500/20 sm:min-h-9 sm:w-auto">
              Campaigns
            </button>
          </Link>
        </div>
      </header>

      {statsLoading ? (
        <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Calls Today" value={stats.callsToday} sub={`${stats.totalCalls} total all-time`} icon={Activity} iconColor="text-primary" accent href="/calls" />
            <StatCard label="Active Numbers" value={stats.activeNumbers} sub={`of ${stats.totalNumbers} provisioned`} icon={Phone} iconColor="text-blue-400" href="/numbers" />
            <StatCard label="CRM Records" value={stats.totalContacts} sub={`contacts across ${stats.totalCompanies} companies`} icon={Users} iconColor="text-purple-400" href="/contacts" />
            <StatCard label="Hot Leads" value={totalHotLeads} sub={`${callbacksDue} callback${callbacksDue !== 1 ? "s" : ""} scheduled`} icon={TrendingUp} iconColor="text-green-400" accent={totalHotLeads > 0} href="/campaigns" />
          </div>

          <div className="grid grid-cols-1 gap-3 min-[390px]:grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            <MiniCard label="Inbound" value={stats.inboundCalls} icon={PhoneIncoming} iconBg="bg-green-500/10" iconColor="text-green-400" href="/calls" />
            <MiniCard label="Outbound" value={stats.outboundCalls} icon={PhoneOutgoing} iconBg="bg-blue-500/10" iconColor="text-blue-400" href="/calls" />
            <MiniCard label="AI Answered" value={stats.aiAnswered} icon={Activity} iconBg="bg-purple-500/10" iconColor="text-purple-400" href="/calls" />
            <MiniCard label="Voicemails" value={stats.voicemailCount} icon={Voicemail} iconBg="bg-orange-500/10" iconColor="text-orange-400" href="/calls" />
            <MiniCard label="Forwarded" value={stats.forwardedCalls} icon={PhoneForwarded} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" href="/calls" />
            <MiniCard label="Avg Duration" value={formatDuration(stats.avgDuration)} icon={Clock} iconBg="bg-secondary" iconColor="text-muted-foreground" href="/calls" />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">Dashboard statistics are temporarily unavailable.</div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-secondary/20 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2"><Target className="h-4 w-4 flex-shrink-0 text-green-400" /><span className="truncate text-sm font-semibold">Campaigns</span></div>
            <Link href="/campaigns" className="flex min-h-9 flex-shrink-0 items-center gap-1 px-2 text-xs text-primary hover:underline">View all<ChevronRight className="h-3 w-3" /></Link>
          </div>
          {campaigns.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"><Target className="h-6 w-6 opacity-25" /><span className="text-xs">No campaigns yet</span></div>
          ) : (
            <>
              <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                {[
                  { label: "Active", value: activeCampaigns, accent: activeCampaigns > 0 },
                  { label: "Total", value: campaigns.length, accent: false },
                  { label: "Hot Leads", value: campaigns.reduce((sum, campaign) => sum + (campaign.interestedContacts ?? 0), 0), accent: true },
                ].map(item => (
                  <div key={item.label} className="px-2 py-3 text-center sm:px-4">
                    <div className={`font-mono text-lg font-bold sm:text-xl ${item.accent && item.value > 0 ? "text-green-400" : "text-foreground"}`}>{item.value}</div>
                    <div className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">{item.label}</div>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-border/50">
                {campaigns.slice(0, 4).map(campaign => (
                  <Link key={campaign.id} href={`/campaigns/${campaign.id}`} className="block">
                    <div className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors hover:bg-secondary/20">
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{campaign.name}</div><div className="text-[11px] text-muted-foreground">{campaign.totalContacts ?? 0} contacts</div></div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {(campaign.interestedContacts ?? 0) > 0 && <span className="hidden text-xs font-bold text-green-400 min-[390px]:inline">{campaign.interestedContacts} leads</span>}
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide sm:text-[10px] ${campaign.status === "active" ? "bg-green-500/15 text-green-400" : campaign.status === "paused" ? "bg-yellow-500/15 text-yellow-400" : campaign.status === "completed" ? "bg-blue-500/15 text-blue-400" : "bg-muted text-muted-foreground"}`}>{campaign.status}</span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-secondary/20 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2"><CalendarClock className="h-4 w-4 flex-shrink-0 text-orange-400" /><span className="truncate text-sm font-semibold">Callbacks & Hot Leads</span></div>
            <Link href="/campaigns" className="flex min-h-9 flex-shrink-0 items-center gap-1 px-2 text-xs text-primary hover:underline">Calendar<ChevronRight className="h-3 w-3" /></Link>
          </div>
          {upcomingEvents.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"><CalendarClock className="h-6 w-6 opacity-25" /><span className="text-xs">No upcoming callbacks or hot leads</span></div>
          ) : (
            <div className="divide-y divide-border/50">
              {upcomingEvents.map(event => {
                const date = event.callbackAt ?? event.lastAttemptAt;
                const isToday = date?.slice(0, 10) === today;
                return (
                  <button key={event.id} onClick={() => navigate("/campaigns")} className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-secondary/20">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${event.eventType === "hot_lead" ? "bg-green-400" : "bg-orange-400"}`} />
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{event.name}</div><div className="truncate text-[11px] text-muted-foreground">{event.campaignName}</div></div>
                    <div className="flex-shrink-0 text-right">
                      <div className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide sm:text-[10px] ${event.eventType === "hot_lead" ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"}`}>{event.eventType === "hot_lead" ? "Hot Lead" : "Callback"}</div>
                      {date && <div className={`mt-0.5 text-[9px] sm:text-[10px] ${isToday ? "font-semibold text-orange-400" : "text-muted-foreground"}`}>{isToday ? "Today" : new Date(date).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}{event.callbackAt && ` · ${new Date(event.callbackAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}`}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 lg:grid-cols-4">
        <QuickLink href="/numbers" icon={Phone} iconClass="bg-blue-500/10 text-blue-400" eyebrow="Phone Numbers" title="Manage Lines" />
        <QuickLink href="/contacts" icon={Users} iconClass="bg-purple-500/10 text-purple-400" eyebrow="Contacts" title="View CRM" />
        <QuickLink href="/companies" icon={Building2} iconClass="bg-cyan-500/10 text-cyan-400" eyebrow="Companies" title="Directory" />
        <QuickLink href="/messages" icon={MessageSquare} iconClass="bg-green-500/10 text-green-400" eyebrow="Messages" title="SMS Inbox" />
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <button className="flex min-h-14 w-full items-center justify-between gap-3 bg-secondary/20 px-4 py-3 text-left transition-colors hover:bg-secondary/40" onClick={() => setActivityOpen(open => !open)} aria-expanded={activityOpen}>
          <div className="flex min-w-0 items-center gap-2">
            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 ${activityOpen ? "" : "-rotate-90"}`} />
            <div className="min-w-0"><div className="text-sm font-semibold">Recent Activity</div><div className="truncate text-xs text-muted-foreground">Latest calls traversing the network</div></div>
          </div>
          {activityOpen && <span className="flex flex-shrink-0 items-center gap-1 text-xs text-primary">View all<ChevronRight className="h-3 w-3" /></span>}
        </button>

        {activityOpen && (
          <>
            {callsLoading && <div className="space-y-3 p-4">{[...Array(5)].map((_, index) => <Skeleton key={index} className="h-16 w-full rounded-lg" />)}</div>}
            {!callsLoading && recentCalls && recentCalls.length > 0 && (
              <div className="divide-y divide-border/50">
                {recentCalls.map(call => {
                  const inbound = call.direction === "inbound";
                  const externalNumber = inbound ? call.fromNumber : call.toNumber;
                  const callerLabel = call.campaignContactName || call.callerName || call.contactName || call.callerIdName || null;
                  const lineName = call.phoneFriendlyName || call.phoneNumber || null;
                  const lineLabel = call.campaignName ? `${call.campaignName}${lineName ? ` · ${lineName}` : ""}` : call.companyName ? `${call.companyName}${lineName ? ` · ${lineName}` : ""}` : lineName;
                  return (
                    <Link key={call.id} href="/calls" className="block">
                      <div className="flex min-h-16 items-start gap-3 px-4 py-3 transition-colors hover:bg-secondary/20 sm:items-center">
                        <div className={`mt-0.5 flex-shrink-0 rounded-lg border border-border p-2 sm:mt-0 ${inbound ? "bg-green-500/5" : "bg-blue-500/5"}`}>{inbound ? <PhoneIncoming className="h-4 w-4 text-green-400" /> : <PhoneOutgoing className="h-4 w-4 text-blue-400" />}</div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5"><span className={`flex-shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-widest ${inbound ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"}`}>{inbound ? "IN" : "OUT"}</span><span className="font-mono text-sm font-medium">{formatPhone(externalNumber)}</span>{callerLabel && <span className="max-w-full truncate text-xs text-muted-foreground">— {callerLabel}</span>}</div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[10px] text-muted-foreground sm:text-[11px]">{lineLabel && <><span className="text-muted-foreground/50">via</span><span className="max-w-[180px] truncate font-medium text-foreground/55">{lineLabel}</span><span className="text-border/60">·</span></>}<span>{new Date(call.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
                          <div className="mt-2 flex items-center gap-2 sm:hidden">{call.duration ? <span className="font-mono text-xs text-muted-foreground">{formatDuration(call.duration)}</span> : <span className="text-xs text-muted-foreground/30">—</span>}<span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${call.status === "completed" ? "bg-green-500/10 text-green-400" : call.status === "no-answer" ? "bg-red-500/10 text-red-400" : "bg-secondary text-muted-foreground"}`}>{call.status}</span></div>
                        </div>
                        <div className="hidden flex-shrink-0 items-center gap-2 sm:flex">{call.duration ? <span className="font-mono text-xs text-muted-foreground">{formatDuration(call.duration)}</span> : <span className="text-xs text-muted-foreground/30">—</span>}<span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${call.status === "completed" ? "bg-green-500/10 text-green-400" : call.status === "no-answer" ? "bg-red-500/10 text-red-400" : "bg-secondary text-muted-foreground"}`}>{call.status}</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" /></div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
            {!callsLoading && (!recentCalls || recentCalls.length === 0) && <div className="flex h-32 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"><Phone className="h-6 w-6 opacity-25" /><span className="text-xs">No recent calls</span></div>}
          </>
        )}
      </section>
    </div>
  );
}
