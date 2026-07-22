import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Bot,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  Circle,
  Loader2,
  Phone,
  RefreshCw,
  Settings2,
  TestTube2,
  Users,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface Company { id: number; name: string; industry?: string | null; phone?: string | null; email?: string | null; website?: string | null; }
interface SetupItem {
  key: string;
  title: string;
  description: string;
  status: "complete" | "attention" | "missing" | "error";
  detail: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

async function getJson(url: string) {
  const response = await fetch(url, { credentials: "include" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}

export default function CompanySetupOverview() {
  const [, navigate] = useLocation();
  const companyId = useMemo(() => Number(new URLSearchParams(window.location.search).get("companyId") || 0), []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [company, setCompany] = useState<Company | null>(null);
  const [items, setItems] = useState<SetupItem[]>([]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setLoadError("");
    try {
      const results = await Promise.allSettled([
        getJson(`/api/companies/${companyId}`),
        getJson(`/api/phone-numbers`),
        getJson(`/api/ai-voice/config?companyId=${companyId}`),
        getJson(`/api/booking/resources?companyId=${companyId}`),
        getJson(`/api/booking/services?companyId=${companyId}`),
        getJson(`/api/booking/availability?companyId=${companyId}`),
        getJson(`/api/booking/settings?companyId=${companyId}`),
        getJson(`/api/platform-users?companyId=${companyId}`),
      ]);

      const value = <T,>(index: number, fallback: T): T => results[index].status === "fulfilled" ? (results[index] as PromiseFulfilledResult<T>).value : fallback;
      const companyData = value<Company | null>(0, null);
      const numbers = value<any[]>(1, []).filter(number => Number(number.companyId) === companyId);
      const aiConfig = value<any>(2, null);
      const resources = value<any[]>(3, []);
      const services = value<any[]>(4, []);
      const availability = value<any[]>(5, []);
      const bookingSettings = value<any>(6, null);
      const users = value<any[]>(7, []);

      setCompany(companyData);

      const companyInfoComplete = !!companyData?.name && !!(companyData?.industry || companyData?.phone || companyData?.email || companyData?.website);
      const hasPhone = numbers.length > 0;
      const hasAiPrompt = !!String(aiConfig?.systemPrompt || "").trim();
      const hasGreeting = !!String(aiConfig?.initialGreeting || "").trim();
      const bookingEnabled = bookingSettings?.enabled !== false;
      const hasResources = resources.some(row => row.active !== false);
      const hasServices = services.some(row => row.active !== false);
      const hasHours = availability.length > 0;
      const hasAdmin = users.some(user => user.role === "company_admin" && user.isActive !== false);

      setItems([
        {
          key: "company",
          title: "Company Information",
          description: "Business name, industry, contact information and notification details.",
          status: companyInfoComplete ? "complete" : "attention",
          detail: companyInfoComplete ? "Basic company profile is entered." : "Add industry and at least one contact method.",
          href: `/companies/${companyId}`,
          icon: Building2,
        },
        {
          key: "phone",
          title: "Phone Line Connected",
          description: "At least one phone number must belong to this company.",
          status: hasPhone ? "complete" : "missing",
          detail: hasPhone ? `${numbers.length} phone line${numbers.length === 1 ? "" : "s"} connected.` : "No phone line is connected.",
          href: hasPhone ? `/numbers/${numbers[0].id}` : `/companies/${companyId}`,
          icon: Phone,
        },
        {
          key: "ai",
          title: "AI Agent Configured",
          description: "Greeting, speaking style and business instructions used during calls.",
          status: hasAiPrompt && hasGreeting ? "complete" : hasAiPrompt ? "attention" : "missing",
          detail: hasAiPrompt && hasGreeting ? "AI instructions and greeting are configured." : hasAiPrompt ? "AI instructions exist, but the initial greeting is blank." : "AI instructions have not been configured.",
          href: `/settings?companyId=${companyId}`,
          icon: Bot,
        },
        {
          key: "services",
          title: "Services and Pricing",
          description: "Bookable services, durations and approved customer-facing price information.",
          status: hasServices ? "complete" : "missing",
          detail: hasServices ? `${services.filter(row => row.active !== false).length} active service${services.filter(row => row.active !== false).length === 1 ? "" : "s"}. Review pricing in AI Agent Setup.` : "No structured booking services are entered.",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: Settings2,
        },
        {
          key: "resources",
          title: "Staff or Bookable Resources",
          description: "Barbers, technicians, agents, chairs, rooms, vehicles or other capacity.",
          status: hasResources ? "complete" : "missing",
          detail: hasResources ? `${resources.filter(row => row.active !== false).length} active resource${resources.filter(row => row.active !== false).length === 1 ? "" : "s"}.` : "No staff or bookable resources are entered.",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: Users,
        },
        {
          key: "hours",
          title: "Availability and Working Hours",
          description: "Hours, breaks and time off used to prevent invalid bookings.",
          status: hasHours ? "complete" : "missing",
          detail: hasHours ? `${availability.length} availability row${availability.length === 1 ? "" : "s"} configured.` : "No working hours are configured.",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: CalendarCheck,
        },
        {
          key: "booking",
          title: "Booking Rules",
          description: "Timezone, notice, automatic assignment and approval requirements.",
          status: bookingSettings ? (bookingEnabled ? "complete" : "attention") : "missing",
          detail: bookingSettings ? (bookingEnabled ? "Booking engine is enabled." : "Booking engine is currently disabled.") : "Booking rules have not been saved.",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: CalendarCheck,
        },
        {
          key: "users",
          title: "Company Admin Access",
          description: "A company administrator should be able to manage company configuration.",
          status: hasAdmin ? "complete" : "attention",
          detail: hasAdmin ? "At least one active company admin exists." : "Create a company admin account.",
          href: `/companies/${companyId}`,
          icon: Users,
        },
        {
          key: "test",
          title: "End-to-End Test Call",
          description: "Confirm incoming voice, AI response, call logging, booking and SMS confirmation.",
          status: "attention",
          detail: "Manual verification is still required after the setup items above are complete.",
          href: hasPhone ? `/numbers/${numbers[0].id}` : `/companies/${companyId}`,
          icon: TestTube2,
        },
      ]);
    } catch (error: any) {
      setLoadError(error?.message || "Could not load company setup status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [companyId]);

  if (!companyId) return <div className="py-20 text-center text-muted-foreground">Choose a company to view its setup checklist.</div>;

  const completeCount = items.filter(item => item.status === "complete").length;
  const percent = items.length ? Math.round((completeCount / items.length) * 100) : 0;

  const styles = {
    complete: { icon: CheckCircle2, label: "Complete", className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    attention: { icon: AlertTriangle, label: "Needs attention", className: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
    missing: { icon: Circle, label: "Not configured", className: "text-muted-foreground bg-secondary/50 border-border" },
    error: { icon: XCircle, label: "Error", className: "text-red-400 bg-red-500/10 border-red-500/20" },
  } as const;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Company Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">{company?.name || "Company"} · Complete each item before relying on live customer calls.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Refresh
        </Button>
      </div>

      {loadError && <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{loadError}</div>}

      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div><div className="text-sm font-semibold">Setup progress</div><div className="text-xs text-muted-foreground mt-1">{completeCount} of {items.length} items complete</div></div>
          <div className="text-2xl font-bold text-primary">{percent}%</div>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
      </section>

      {loading && !items.length ? (
        <div className="rounded-lg border border-border p-12 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-3" />Checking company configuration…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map(item => {
            const style = styles[item.status];
            const StatusIcon = style.icon;
            const ItemIcon = item.icon;
            return (
              <button key={item.key} onClick={() => navigate(item.href)} className="text-left rounded-lg border border-border bg-card p-4 hover:border-primary/40 hover:bg-card/80 transition-colors group">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><ItemIcon className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-sm">{item.title}</h2><ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary flex-shrink-0" /></div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</p>
                    <div className="flex items-center gap-2 mt-3"><span className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-semibold ${style.className}`}><StatusIcon className="h-3 w-3" />{style.label}</span><span className="text-[11px] text-muted-foreground truncate">{item.detail}</span></div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
