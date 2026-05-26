import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type TwilioPerNumber = {
  phoneNumber: string;
  friendlyName: string | null;
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

export default function Billing() {
  const { data: costs, isLoading, refetch, isFetching } = useQuery<CostData>({
    queryKey: ["costs"],
    queryFn: () => fetch("/api/costs").then(r => r.json()),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [expandedLine, setExpandedLine] = useState<string | null>(null);

  const fmt = (raw: string | null | undefined) => {
    if (!raw) return raw ?? "";
    const d = raw.replace(/\D/g, "");
    if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    return raw;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Billing</h1>
          <p className="text-muted-foreground mt-1">
            Usage and costs for the current billing period: {costs?.period ?? "loading..."}
          </p>
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

      {isLoading ? (
        <Skeleton className="h-64" />
      ) : (
        <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-sm font-semibold text-foreground">Twilio</span>
            </div>
            {costs?.twilio?.available && (
              <a
                href="https://console.twilio.com/us1/billing/billing-history"
                target="_blank"
                rel="noopener noreferrer"
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

              {costs.twilio.perNumber?.length > 0 && (
                <div className="pt-1 border-t border-border/50 space-y-1">
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium pb-1">By Line</p>
                  {costs.twilio.perNumber.map(num => {
                    const isOpen = expandedLine === num.phoneNumber;
                    return (
                      <div key={num.phoneNumber} className="rounded-md border border-border/40 overflow-hidden">
                        <button
                          onClick={() => setExpandedLine(isOpen ? null : num.phoneNumber)}
                          className="w-full flex items-center justify-between px-3 py-2 bg-background/60 hover:bg-background/90 transition-colors text-left"
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
                          <span className="font-mono text-xs font-bold text-foreground shrink-0">${num.cost.toFixed(4)}</span>
                        </button>
                        {isOpen && (
                          <div className="px-3 py-2 space-y-1 bg-card/20 border-t border-border/30">
                            {num.breakdown.length > 0 ? num.breakdown.map((r: any) => (
                              <div key={r.category} className="flex items-center justify-between text-[11px]">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="text-muted-foreground truncate">{r.label}</span>
                                  {r.isFixed
                                    ? <span className="shrink-0 px-1 py-0.5 rounded text-[9px] font-medium uppercase tracking-wide bg-slate-700/60 text-slate-400 border border-slate-600/40">Fixed</span>
                                    : <span className="shrink-0 text-[10px] font-bold text-sky-500/70" title="Per-use charge">+</span>
                                  }
                                </div>
                                <span className="font-mono text-muted-foreground shrink-0 ml-2">${r.cost.toFixed(4)}</span>
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
              )}
            </>
          ) : (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span>{(costs?.twilio as any)?.error ?? "Not available"}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
