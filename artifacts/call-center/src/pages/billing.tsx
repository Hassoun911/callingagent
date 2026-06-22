import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, ExternalLink, ChevronDown, ChevronRight, Building2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type TwilioPerNumber = {
  phoneNumber: string;
  friendlyName: string | null;
  companyId: number | null;
  companyName: string | null;
  cost: number;
  breakdown: { category: string; label: string; cost: number; usage: string; isFixed?: boolean }[];
};

type CostData = {
  period: string;
  twilio:
    | { available: true; totalCost: number; currency: string; breakdown: { category: string; label: string; cost: number; usage: string; usageUnit: string }[]; perNumber: TwilioPerNumber[] }
    | { available: false; error: string }
    | null;
};

type CompanyGroup = {
  companyId: number | null;
  companyName: string | null;
  lines: TwilioPerNumber[];
  total: number;
};

function groupByCompany(perNumber: TwilioPerNumber[]): CompanyGroup[] {
  const map = new Map<string, CompanyGroup>();
  for (const num of perNumber) {
    const key = num.companyId != null ? `c:${num.companyId}` : `u:${num.phoneNumber}`;
    if (!map.has(key)) {
      map.set(key, { companyId: num.companyId, companyName: num.companyName, lines: [], total: 0 });
    }
    const group = map.get(key)!;
    group.lines.push(num);
    group.total += num.cost;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export default function Billing() {
  const { data: costs, isLoading, refetch, isFetching } = useQuery<CostData>({
    queryKey: ["costs"],
    queryFn: () => fetch("/api/costs").then(r => r.json()),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const { data: fxData } = useQuery<{ rate: number; updatedAt: string }>({
    queryKey: ["fx-usd-cad"],
    queryFn: async () => {
      const r = await fetch("https://open.er-api.com/v6/latest/USD");
      const body = await r.json();
      return { rate: body.rates?.CAD ?? 1.36, updatedAt: body.time_last_update_utc ?? "" };
    },
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [currency, setCurrency] = useState<"USD" | "CAD">("CAD");
  const [expandedLine, setExpandedLine] = useState<string | null>(null);

  const fxRate = currency === "CAD" ? (fxData?.rate ?? 1.36) : 1;
  const convert = (usd: number) => usd * fxRate;
  const fmtMoney = (usd: number) => {
    const val = convert(usd);
    return `${currency === "CAD" ? "CA" : ""}$${val.toFixed(4)}`;
  };
  const fmt = (raw: string | null | undefined) => {
    if (!raw) return raw ?? "";
    const d = raw.replace(/\D/g, "");
    if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return raw;
  };

  const groups = costs?.twilio?.available ? groupByCompany(costs.twilio.perNumber) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Billing</h1>
          <p className="text-muted-foreground mt-1">
            Usage and costs for the current billing period: {costs?.period ?? "loading..."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center rounded-md border border-border overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setCurrency("USD")}
              className={`px-3 py-1.5 transition-colors ${currency === "USD" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"}`}
            >USD</button>
            <button
              onClick={() => setCurrency("CAD")}
              className={`px-3 py-1.5 transition-colors ${currency === "CAD" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"}`}
            >CAD</button>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {currency === "CAD" && fxData && (
        <p className="text-[11px] text-muted-foreground -mt-3">
          Rate: 1 USD = {fxData.rate.toFixed(4)} CAD
          {fxData.updatedAt ? ` · ${new Date(fxData.updatedAt).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}` : ""}
        </p>
      )}

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : !costs?.twilio?.available ? (
        <div className="rounded-lg border border-border bg-card/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-sm font-semibold text-foreground">Twilio</span>
          </div>
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <span>{(costs?.twilio as any)?.error ?? "Not available"}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Twilio header card */}
          <div className="rounded-lg border border-border bg-card/30 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-sm font-semibold text-foreground">Twilio</span>
              <span className="text-[11px] text-muted-foreground uppercase tracking-widest">Total this month</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold font-mono text-foreground">{fmtMoney(costs.twilio.totalCost)}</span>
              <a
                href="https://console.twilio.com/us1/billing/billing-history"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Console <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>

          {/* Per-company cards */}
          {groups.map(group => {
            const multiLine = group.lines.length > 1;
            const label = group.companyName ?? "Unassigned";
            return (
              <div key={group.companyId ?? `u-${group.lines[0]?.phoneNumber}`} className="rounded-lg border border-border bg-card/30 overflow-hidden">
                {/* Company header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-semibold text-foreground">{label}</span>
                    <span className="text-[10px] text-muted-foreground border border-border/50 rounded px-1.5 py-0.5">
                      {group.lines.length} {group.lines.length === 1 ? "line" : "lines"}
                    </span>
                  </div>
                  <span className="font-mono text-sm font-bold text-foreground">{fmtMoney(group.total)}</span>
                </div>

                {/* Lines */}
                <div className="divide-y divide-border/30">
                  {group.lines.map(num => {
                    const isOpen = expandedLine === num.phoneNumber;
                    return (
                      <div key={num.phoneNumber}>
                        <button
                          onClick={() => setExpandedLine(isOpen ? null : num.phoneNumber)}
                          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-background/40 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2">
                            {isOpen
                              ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                              : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                            <span className="font-mono text-xs font-medium text-foreground">{fmt(num.phoneNumber)}</span>
                            {num.friendlyName && (
                              <span className="text-[10px] text-muted-foreground truncate max-w-[200px]">{num.friendlyName}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            {multiLine && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {num.cost > 0 ? `${((num.cost / group.total) * 100).toFixed(0)}%` : "—"}
                              </span>
                            )}
                            <span className="font-mono text-xs font-bold text-foreground shrink-0">{fmtMoney(num.cost)}</span>
                          </div>
                        </button>
                        {isOpen && (
                          <div className="px-8 py-2.5 space-y-1.5 bg-card/20 border-t border-border/30">
                            {num.breakdown.length > 0 ? num.breakdown.map((r: any) => (
                              <div key={r.category} className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-muted-foreground truncate">{r.label}</span>
                                  {r.isFixed
                                    ? <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-slate-700/60 text-slate-400 border border-slate-600/40">Fixed</span>
                                    : <span className="shrink-0 text-[10px] font-bold text-sky-500/70">+</span>}
                                </div>
                                <span className="font-mono text-muted-foreground shrink-0 ml-2">{fmtMoney(r.cost)}</span>
                              </div>
                            )) : (
                              <p className="text-[11px] text-muted-foreground">No charges this month</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
