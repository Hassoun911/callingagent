import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, RefreshCw, AlertCircle, ExternalLink, ChevronDown, ChevronRight, Pencil, Check, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type TwilioPerNumber = {
  phoneNumber: string;
  friendlyName: string | null;
  cost: number;
  breakdown: { category: string; label: string; cost: number; usage: string; isFixed?: boolean }[];
};

type CostData = {
  period: string;
  openaiCreditBalance: number | null;
  openaiCreditUpdatedAt: string | null;
  twilio:
    | { available: true; totalCost: number; currency: string; breakdown: { category: string; label: string; cost: number; usage: string; usageUnit: string }[]; perNumber: TwilioPerNumber[] }
    | { available: false; error: string }
    | null;
  openai:
    | { available: true; totalCost: number; currency: string; breakdown: { model: string; cost: number }[]; viaProxy: boolean }
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
  const [openaiExpanded, setOpenaiExpanded] = useState(false);
  const [editingCredit, setEditingCredit] = useState(false);
  const [creditInput, setCreditInput] = useState("");
  const [savingCredit, setSavingCredit] = useState(false);

  const saveCredit = async () => {
    const val = parseFloat(creditInput);
    if (isNaN(val) || val < 0) return;
    setSavingCredit(true);
    try {
      await fetch("/api/costs/openai-credit", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ balance: val }),
      });
      await refetch();
      setEditingCredit(false);
    } finally {
      setSavingCredit(false);
    }
  };

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-32 md:col-span-2" />
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
                                <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{num.friendlyName}</span>
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

          {/* OpenAI */}
          <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-sm font-semibold text-foreground">OpenAI</span>
              </div>
              <a
                href="https://platform.openai.com/settings/organization/billing/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Dashboard <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {costs?.openai?.available ? (
              <>
                {/* Credit Balance */}
                <div className="flex items-center justify-between rounded-md bg-background/60 border border-border/40 px-3 py-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">Credit Balance</p>
                    {costs.openaiCreditBalance != null ? (
                      <p className="font-mono text-lg font-bold text-foreground">${costs.openaiCreditBalance.toFixed(2)}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">Not set</p>
                    )}
                    {costs.openaiCreditUpdatedAt && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        updated {new Date(costs.openaiCreditUpdatedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  {editingCredit ? (
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={creditInput}
                        onChange={e => setCreditInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveCredit(); if (e.key === "Escape") setEditingCredit(false); }}
                        className="w-20 px-2 py-1 text-sm font-mono bg-background border border-border rounded focus:outline-none focus:border-primary"
                        autoFocus
                      />
                      <button onClick={saveCredit} disabled={savingCredit}
                        className="p-1 text-green-400 hover:text-green-300 transition-colors">
                        <Check className="h-4 w-4" />
                      </button>
                      <button onClick={() => setEditingCredit(false)}
                        className="p-1 text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setCreditInput(costs.openaiCreditBalance?.toFixed(2) ?? ""); setEditingCredit(true); }}
                      className="p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-background"
                      title="Update balance"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div>
                  <div className="text-2xl font-bold font-mono text-foreground">
                    ${(costs.openai as any).totalCost.toFixed(4)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">direct API spend this month</p>
                </div>

                {(costs.openai as any).viaProxy && (
                  <div className="flex items-start gap-2 rounded-md bg-blue-950/40 border border-blue-800/30 px-3 py-2">
                    <AlertCircle className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-300 leading-relaxed">
                      AI voice calls route through Replit's proxy — those costs appear on your Replit bill, not here.
                    </p>
                  </div>
                )}

                {(costs.openai as any).breakdown?.length > 0 ? (
                  <div className="pt-1 border-t border-border/50 space-y-1">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium pb-1">By Model</p>
                    <div className="rounded-md border border-border/40 overflow-hidden">
                      <button
                        onClick={() => setOpenaiExpanded(v => !v)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-background/60 hover:bg-background/90 transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          {openaiExpanded
                            ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                            : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          <span className="text-xs text-muted-foreground">
                            {(costs.openai as any).breakdown.length} model{(costs.openai as any).breakdown.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-foreground">
                          ${(costs.openai as any).totalCost.toFixed(4)}
                        </span>
                      </button>
                      {openaiExpanded && (
                        <div className="px-3 py-2 space-y-1 bg-card/20 border-t border-border/30">
                          {(costs.openai as any).breakdown.slice(0, 8).map((row: any) => (
                            <div key={row.model} className="flex items-center justify-between text-[11px]">
                              <span className="text-muted-foreground font-mono truncate mr-2">{row.model}</span>
                              <span className="font-mono text-foreground shrink-0">${row.cost.toFixed(4)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No direct API charges this month</p>
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
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  View on OpenAI platform <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
          </div>

          {/* Replit */}
          <div className="rounded-lg border border-border bg-card/30 p-4 space-y-3 md:col-span-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-orange-400" />
                <span className="text-sm font-semibold text-foreground">Replit</span>
              </div>
              <a
                href="https://replit.com/account#billing"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Billing <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            <div className="flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Replit does not expose a billing API — costs cannot be fetched programmatically.
                </p>
                <p className="text-xs text-muted-foreground">
                  AI voice calls (TTS + completions) are routed through Replit's AI proxy and billed to your Replit account. Check your usage breakdown on the Replit billing page.
                </p>
                <a
                  href="https://replit.com/account#billing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
                >
                  View Replit billing <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
