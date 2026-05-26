import { useGetDashboardStats, useGetRecentCalls } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, Users, Clock, PhoneIncoming, PhoneOutgoing, Voicemail, Activity, DollarSign, RefreshCw, AlertCircle, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

type TwilioPerNumber = { phoneNumber: string; friendlyName: string | null; cost: number; breakdown: { category: string; label: string; cost: number; usage: string }[] };
type CostData = {
  period: string;
  twilio: { available: true; totalCost: number; currency: string; breakdown: { category: string; label: string; cost: number; usage: string; usageUnit: string }[]; perNumber: TwilioPerNumber[] } | { available: false; error: string } | null;
  openai: { available: true; totalCost: number; currency: string; breakdown: { model: string; cost: number }[] } | { available: false; error: string } | null;
};

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentCalls, isLoading: callsLoading } = useGetRecentCalls({ limit: 5 });
  const { data: costs, isLoading: costsLoading, refetch: refetchCosts, isFetching: costsFetching } = useQuery<CostData>({
    queryKey: ["costs"],
    queryFn: () => fetch("/api/costs").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatPhone = (raw: string | null | undefined): string => {
    if (!raw || raw === "Anonymous") return raw ?? "Anonymous";
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 11 && digits[0] === "1") {
      const d = digits.slice(1);
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    return raw;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Command Center</h1>
          <p className="text-muted-foreground mt-1">Real-time system overview and activity.</p>
        </div>
        <div className="flex gap-3">
          <Link href="/numbers" className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-9 px-4 py-2">
            Manage Numbers
          </Link>
        </div>
      </div>

      {statsLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Calls (Today)</CardTitle>
                <Activity className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold font-mono text-primary">{stats.callsToday}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  of {stats.totalCalls} total all-time
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Active Numbers</CardTitle>
                <Phone className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold font-mono">{stats.activeNumbers}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  of {stats.totalNumbers} provisioned
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold font-mono">{formatDuration(stats.avgDuration)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across all calls
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/50">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">CRM Records</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold font-mono">{stats.totalContacts}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Contacts across {stats.totalCompanies} companies
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-card/30 border-border/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-500/10 rounded-md">
                    <PhoneIncoming className="h-4 w-4 text-green-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Inbound</p>
                    <p className="text-2xl font-mono font-bold">{stats.inboundCalls}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/30 border-border/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-md">
                    <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Outbound</p>
                    <p className="text-2xl font-mono font-bold">{stats.outboundCalls}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/30 border-border/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 rounded-md">
                    <Activity className="h-4 w-4 text-purple-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">AI Answered</p>
                    <p className="text-2xl font-mono font-bold">{stats.aiAnswered}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card/30 border-border/30">
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/10 rounded-md">
                    <Voicemail className="h-4 w-4 text-orange-500" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">Voicemails</p>
                    <p className="text-2xl font-mono font-bold">{stats.voicemailCount}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}

      {/* ── Usage & Cost ──────────────────────────────────────────────────── */}
      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-green-400" />
            <div>
              <CardTitle className="text-green-400">Usage &amp; Cost</CardTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Current billing period: {costs?.period ?? "loading..."}
              </p>
            </div>
          </div>
          <button
            onClick={() => refetchCosts()}
            disabled={costsFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${costsFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </CardHeader>
        <CardContent>
          {costsLoading ? (
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              {/* Twilio */}
              <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-sm font-semibold text-foreground">Twilio</span>
                  </div>
                  {costs?.twilio?.available && (
                    <a
                      href="https://console.twilio.com/us1/billing/billing-history"
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Console <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>

                {costs?.twilio?.available ? (
                  <>
                    <div>
                      <div className="text-3xl font-bold font-mono text-foreground">
                        ${costs.twilio.totalCost.toFixed(4)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{costs.twilio.currency} this month</p>
                    </div>
                    {/* Per-number breakdown */}
                    {costs.twilio.perNumber?.length > 0 && (
                      <div className="space-y-2 pt-1 border-t border-border/50">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">By Line</p>
                        {costs.twilio.perNumber.map(num => {
                          const fmt = (raw: string | null | undefined) => {
                            if (!raw) return raw ?? "";
                            const d = raw.replace(/\D/g, "");
                            if (d.length === 11 && d[0] === "1") return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
                            if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
                            return raw;
                          };
                          return (
                            <div key={num.phoneNumber} className="rounded-md bg-background/60 border border-border/40 p-2 space-y-1">
                              <div className="flex items-center justify-between">
                                <span className="font-mono text-xs font-medium text-foreground">{fmt(num.phoneNumber)}</span>
                                <span className="font-mono text-xs font-bold text-foreground">${num.cost.toFixed(4)}</span>
                              </div>
                              {num.breakdown.map(r => (
                                <div key={r.category} className="flex items-center justify-between pl-2 text-[11px]">
                                  <span className="text-muted-foreground">{r.label}</span>
                                  <span className="font-mono text-muted-foreground">${r.cost.toFixed(4)}</span>
                                </div>
                              ))}
                              {num.cost === 0 && (
                                <p className="text-[11px] text-muted-foreground pl-2">No charges this month</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Category breakdown */}
                    {costs.twilio.breakdown.length > 0 ? (
                      <div className="space-y-1.5 pt-1 border-t border-border/50">
                        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">By Category</p>
                        {costs.twilio.breakdown.slice(0, 6).map(row => (
                          <div key={row.category} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground truncate mr-2">{row.label}</span>
                            <span className="font-mono text-foreground shrink-0">${row.cost.toFixed(4)}</span>
                          </div>
                        ))}
                        {costs.twilio.breakdown.length > 6 && (
                          <p className="text-xs text-muted-foreground pt-0.5">+{costs.twilio.breakdown.length - 6} more categories</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No charges this month</p>
                    )}
                  </>
                ) : (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>{(costs?.twilio as any)?.error ?? "Not available"}</span>
                  </div>
                )}
              </div>

              {/* OpenAI */}
              <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-sm font-semibold text-foreground">OpenAI</span>
                  </div>
                  <a
                    href="https://platform.openai.com/settings/organization/billing/overview"
                    target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Dashboard <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {costs?.openai?.available ? (
                  <>
                    <div>
                      <div className="text-3xl font-bold font-mono text-foreground">
                        ${(costs.openai as any).totalCost.toFixed(6)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">USD this month</p>
                    </div>
                    {(costs.openai as any).breakdown?.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-border/50">
                        {(costs.openai as any).breakdown.slice(0, 6).map((row: any) => (
                          <div key={row.model} className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-mono truncate mr-2">{row.model}</span>
                            <span className="font-mono text-foreground shrink-0">${row.cost.toFixed(6)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <span>{(costs?.openai as any)?.error ?? "Not available"}</span>
                    </div>
                    <a
                      href="https://platform.openai.com/settings/organization/billing/overview"
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      View on OpenAI platform <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
              </div>

            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Latest calls traversing the network.</p>
          </div>
          <Link href="/calls" className="text-sm text-primary hover:underline">View All</Link>
        </CardHeader>
        <CardContent>
          {callsLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : recentCalls?.length ? (
            <div className="space-y-4">
              {recentCalls.map((call) => (
                <div key={call.id} className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-secondary/20">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-background rounded-md border border-border">
                      {call.direction === 'inbound' ? (
                        <PhoneIncoming className="h-4 w-4 text-green-500" />
                      ) : (
                        <PhoneOutgoing className="h-4 w-4 text-blue-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-mono text-sm font-medium">
                        {call.direction === 'inbound' ? formatPhone(call.fromNumber) : formatPhone(call.toNumber)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(call.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <Badge variant="outline" className="font-mono text-xs">
                      {call.duration ? formatDuration(call.duration) : '--:--'}
                    </Badge>
                    <Badge variant={call.status === 'completed' ? 'default' : 'secondary'} className="capitalize bg-opacity-10">
                      {call.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              No recent calls found.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
