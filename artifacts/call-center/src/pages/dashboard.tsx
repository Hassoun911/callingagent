import { useGetDashboardStats, useGetRecentCalls } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, Users, Clock, PhoneIncoming, PhoneOutgoing, Voicemail, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentCalls, isLoading: callsLoading } = useGetRecentCalls({ limit: 5 });

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
