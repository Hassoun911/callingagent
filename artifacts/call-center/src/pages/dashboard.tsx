import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardStats, useGetRecentCalls } from "@workspace/api-client-react";
import { Phone, Users, Clock, PhoneIncoming, PhoneOutgoing, Voicemail, Activity, Target, CalendarClock, MessageSquare, PhoneForwarded, Building2, ChevronRight, TrendingUp, ChevronDown } from "lucide-react";
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
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw || raw === "Anonymous") return raw ?? "Anonymous";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
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
    <Link href={href}>
      <div className="bg-card border border-border rounded-lg px-4 py-3.5 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
          <Icon className={`h-4 w-4 ${iconColor ?? "text-muted-foreground"} group-hover:scale-110 transition-transform`} />
        </div>
        <div className={`text-3xl font-bold font-mono ${accent ? "text-green-400" : "text-foreground"}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
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
    <Link href={href}>
      <div className="bg-card border border-border rounded-lg p-3.5 flex items-center gap-3 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
        <div className={`p-2 rounded-md ${iconBg} flex-shrink-0`}>
          <Icon className={`h-4 w-4 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide leading-tight">{label}</div>
          <div className="text-xl font-bold font-mono leading-tight group-hover:text-primary transition-colors">{value}</div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 ml-auto flex-shrink-0 transition-colors" />
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
      const r = await fetch(`${BASE}/api/campaigns`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30000,
  });

  const { data: calendarEvents = [] } = useQuery<CalendarEvent[]>({
    queryKey: ["campaigns-calendar-dashboard"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/calendar`);
      if (!r.ok) return [];
      return r.json();
    },
    refetchInterval: 30000,
  });

  const activeCampaigns = campaigns.filter(c => c.status === "active").length;
  const totalHotLeads = calendarEvents.filter(e => e.eventType === "hot_lead").length;
  const callbacksDue = calendarEvents.filter(e => e.eventType === "callback").length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingEvents = calendarEvents
    .filter(e => {
      const d = e.callbackAt ?? e.lastAttemptAt;
      if (!d) return false;
      return d.slice(0, 10) >= todayStr;
    })
    .sort((a, b) => {
      const da = a.callbackAt ?? a.lastAttemptAt ?? "";
      const db_ = b.callbackAt ?? b.lastAttemptAt ?? "";
      return da.localeCompare(db_);
    })
    .slice(0, 5);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Command Center</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Real-time system overview and activity.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/numbers">
            <button className="h-8 px-3 text-xs font-medium rounded-md border border-border bg-background hover:bg-secondary transition-colors">
              Manage Numbers
            </button>
          </Link>
          <Link href="/campaigns">
            <button className="h-8 px-3 text-xs font-medium rounded-md border border-green-500/30 bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors">
              Campaigns
            </button>
          </Link>
        </div>
      </div>

      {/* Primary KPIs — row 1 */}
      {statsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : stats ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard
              label="Calls Today"
              value={stats.callsToday}
              sub={`${stats.totalCalls} total all-time`}
              icon={Activity}
              iconColor="text-primary"
              accent
              href="/calls"
            />
            <StatCard
              label="Active Numbers"
              value={stats.activeNumbers}
              sub={`of ${stats.totalNumbers} provisioned`}
              icon={Phone}
              iconColor="text-blue-400"
              href="/numbers"
            />
            <StatCard
              label="CRM Records"
              value={stats.totalContacts}
              sub={`contacts across ${stats.totalCompanies} companies`}
              icon={Users}
              iconColor="text-purple-400"
              href="/contacts"
            />
            <StatCard
              label="Hot Leads"
              value={totalHotLeads}
              sub={`${callbacksDue} callback${callbacksDue !== 1 ? "s" : ""} scheduled`}
              icon={TrendingUp}
              iconColor="text-green-400"
              accent={totalHotLeads > 0}
              href="/campaigns"
            />
          </div>

          {/* Secondary metrics — row 2 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <MiniCard label="Inbound" value={stats.inboundCalls} icon={PhoneIncoming} iconBg="bg-green-500/10" iconColor="text-green-400" href="/calls" />
            <MiniCard label="Outbound" value={stats.outboundCalls} icon={PhoneOutgoing} iconBg="bg-blue-500/10" iconColor="text-blue-400" href="/calls" />
            <MiniCard label="AI Answered" value={stats.aiAnswered} icon={Activity} iconBg="bg-purple-500/10" iconColor="text-purple-400" href="/calls" />
            <MiniCard label="Voicemails" value={stats.voicemailCount} icon={Voicemail} iconBg="bg-orange-500/10" iconColor="text-orange-400" href="/calls" />
            <MiniCard label="Forwarded" value={stats.forwardedCalls} icon={PhoneForwarded} iconBg="bg-cyan-500/10" iconColor="text-cyan-400" href="/calls" />
            <MiniCard label="Avg Duration" value={formatDuration(stats.avgDuration)} icon={Clock} iconBg="bg-secondary" iconColor="text-muted-foreground" href="/calls" />
          </div>
        </>
      ) : null}

      {/* Campaign + Calendar panels — row 3 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Campaign overview */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-green-400" />
              <span className="text-sm font-semibold">Campaigns</span>
            </div>
            <Link href="/campaigns" className="text-xs text-primary hover:underline flex items-center gap-1">
              View all
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <Target className="h-6 w-6 opacity-25" />
              <span className="text-xs">No campaigns yet</span>
            </div>
          ) : (
            <>
              {/* Campaign stats */}
              <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
                {[
                  { label: "Active", value: activeCampaigns, accent: activeCampaigns > 0 },
                  { label: "Total", value: campaigns.length, accent: false },
                  {
                    label: "Hot Leads",
                    value: campaigns.reduce((s, c) => s + (c.interestedContacts ?? 0), 0),
                    accent: true,
                  },
                ].map(({ label, value, accent }) => (
                  <div key={label} className="px-4 py-3 text-center">
                    <div className={`text-xl font-bold font-mono ${accent && value > 0 ? "text-green-400" : "text-foreground"}`}>{value}</div>
                    <div className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              {/* Campaign list */}
              <div className="divide-y divide-border/50">
                {campaigns.slice(0, 4).map(c => (
                  <Link key={c.id} href={`/campaigns/${c.id}`}>
                    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition-colors cursor-pointer">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground">{c.totalContacts ?? 0} contacts</div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(c.interestedContacts ?? 0) > 0 && (
                          <span className="text-xs font-bold text-green-400">{c.interestedContacts} leads</span>
                        )}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${
                          c.status === "active" ? "bg-green-500/15 text-green-400" :
                          c.status === "paused" ? "bg-yellow-500/15 text-yellow-400" :
                          c.status === "completed" ? "bg-blue-500/15 text-blue-400" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {c.status}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Upcoming callbacks & hot leads */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-orange-400" />
              <span className="text-sm font-semibold">Callbacks & Hot Leads</span>
            </div>
            <Link href="/campaigns" className="text-xs text-primary hover:underline flex items-center gap-1">
              Calendar
              <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          {upcomingEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
              <CalendarClock className="h-6 w-6 opacity-25" />
              <span className="text-xs">No upcoming callbacks or hot leads</span>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {upcomingEvents.map(e => {
                const dateStr = e.callbackAt ?? e.lastAttemptAt;
                const isToday = dateStr?.slice(0, 10) === todayStr;
                return (
                  <div
                    key={e.id}
                    onClick={() => navigate("/campaigns")}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition-colors cursor-pointer"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${e.eventType === "hot_lead" ? "bg-green-400" : "bg-orange-400"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{e.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{e.campaignName}</div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${
                        e.eventType === "hot_lead"
                          ? "bg-green-500/15 text-green-400"
                          : "bg-orange-500/15 text-orange-400"
                      }`}>
                        {e.eventType === "hot_lead" ? "Hot Lead" : "Callback"}
                      </div>
                      {dateStr && (
                        <div className={`text-[10px] mt-0.5 ${isToday ? "text-orange-400 font-semibold" : "text-muted-foreground"}`}>
                          {isToday ? "Today" : new Date(dateStr).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}
                          {e.callbackAt && ` · ${new Date(e.callbackAt).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}`}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Quick access row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Link href="/numbers">
          <div className="bg-card border border-border rounded-lg p-3.5 flex items-center gap-3 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
            <div className="p-2 rounded-md bg-blue-500/10"><Phone className="h-4 w-4 text-blue-400" /></div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Phone Numbers</div>
              <div className="text-sm font-semibold group-hover:text-primary transition-colors">Manage Lines</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 ml-auto flex-shrink-0 transition-colors" />
          </div>
        </Link>
        <Link href="/contacts">
          <div className="bg-card border border-border rounded-lg p-3.5 flex items-center gap-3 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
            <div className="p-2 rounded-md bg-purple-500/10"><Users className="h-4 w-4 text-purple-400" /></div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Contacts</div>
              <div className="text-sm font-semibold group-hover:text-primary transition-colors">View CRM</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 ml-auto flex-shrink-0 transition-colors" />
          </div>
        </Link>
        <Link href="/companies">
          <div className="bg-card border border-border rounded-lg p-3.5 flex items-center gap-3 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
            <div className="p-2 rounded-md bg-cyan-500/10"><Building2 className="h-4 w-4 text-cyan-400" /></div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Companies</div>
              <div className="text-sm font-semibold group-hover:text-primary transition-colors">Directory</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 ml-auto flex-shrink-0 transition-colors" />
          </div>
        </Link>
        <Link href="/messages">
          <div className="bg-card border border-border rounded-lg p-3.5 flex items-center gap-3 hover:border-primary/40 hover:bg-card/80 transition-all cursor-pointer group">
            <div className="p-2 rounded-md bg-green-500/10"><MessageSquare className="h-4 w-4 text-green-400" /></div>
            <div className="min-w-0">
              <div className="text-xs text-muted-foreground">Messages</div>
              <div className="text-sm font-semibold group-hover:text-primary transition-colors">SMS Inbox</div>
            </div>
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 ml-auto flex-shrink-0 transition-colors" />
          </div>
        </Link>
      </div>

      {/* Recent Activity — collapsed by default */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center justify-between px-4 py-3 bg-secondary/20 hover:bg-secondary/40 transition-colors"
          onClick={() => setActivityOpen(o => !o)}
        >
          <div className="flex items-center gap-2">
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${activityOpen ? "" : "-rotate-90"}`} />
            <div className="text-left">
              <div className="text-sm font-semibold">Recent Activity</div>
              <div className="text-xs text-muted-foreground">Latest calls traversing the network</div>
            </div>
          </div>
          {activityOpen && (
            <Link
              href="/calls"
              className="text-xs text-primary hover:underline flex items-center gap-1 flex-shrink-0"
              onClick={e => e.stopPropagation()}
            >
              View all
              <ChevronRight className="h-3 w-3" />
            </Link>
          )}
        </button>
        {activityOpen && (
          <>
            {callsLoading && (
              <div className="p-4 space-y-3">
                {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            )}
            {!callsLoading && recentCalls && recentCalls.length > 0 && (
              <div className="divide-y divide-border/50">
                {recentCalls.map(call => {
                  const isInbound = call.direction === "inbound";
                  const externalNumber = isInbound ? call.fromNumber : call.toNumber;
                  const callerLabel = call.campaignContactName || call.callerName || call.contactName || call.callerIdName || null;
                  const lineName = call.phoneFriendlyName || call.phoneNumber || null;
                  const lineLabel = call.campaignName
                    ? `${call.campaignName}${lineName ? ` · ${lineName}` : ""}`
                    : call.companyName
                      ? `${call.companyName}${lineName ? ` · ${lineName}` : ""}`
                      : lineName;
                  return (
                    <Link key={call.id} href="/calls">
                      <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition-colors cursor-pointer">
                        {/* Direction icon */}
                        <div className={`flex-shrink-0 p-1.5 rounded-md border border-border ${isInbound ? "bg-green-500/5" : "bg-blue-500/5"}`}>
                          {isInbound
                            ? <PhoneIncoming className="h-3.5 w-3.5 text-green-400" />
                            : <PhoneOutgoing className="h-3.5 w-3.5 text-blue-400" />
                          }
                        </div>

                        {/* Main info */}
                        <div className="flex-1 min-w-0">
                          {/* Row 1: direction badge + external number + caller name */}
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={`text-[9px] px-1 py-0.5 rounded font-bold uppercase tracking-widest flex-shrink-0 ${
                              isInbound ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"
                            }`}>
                              {isInbound ? "IN" : "OUT"}
                            </span>
                            <span className="text-sm font-mono font-medium">{formatPhone(externalNumber)}</span>
                            {callerLabel && (
                              <span className="text-xs text-muted-foreground truncate">— {callerLabel}</span>
                            )}
                          </div>
                          {/* Row 2: via line · company · timestamp */}
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-0.5">
                            {lineLabel && (
                              <>
                                <span className="text-muted-foreground/50">via</span>
                                <span className="font-medium text-foreground/55 truncate max-w-[150px]">{lineLabel}</span>
                                <span className="text-border/60">·</span>
                              </>
                            )}
                            <span>
                              {new Date(call.createdAt).toLocaleString("en-US", {
                                timeZone: "America/New_York",
                                month: "short", day: "numeric",
                                hour: "2-digit", minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>

                        {/* Right side: duration + status + chevron */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {call.duration
                            ? <span className="text-xs font-mono text-muted-foreground">{formatDuration(call.duration)}</span>
                            : <span className="text-xs text-muted-foreground/30">—</span>
                          }
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wide ${
                            call.status === "completed" ? "bg-green-500/10 text-green-400" :
                            call.status === "no-answer" ? "bg-red-500/10 text-red-400" :
                            "bg-secondary text-muted-foreground"
                          }`}>
                            {call.status}
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/30" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
            {!callsLoading && (!recentCalls || recentCalls.length === 0) && (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                <Phone className="h-6 w-6 opacity-25" />
                <span className="text-xs">No recent calls</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
