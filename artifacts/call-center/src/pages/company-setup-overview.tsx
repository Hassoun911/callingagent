import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Bot,
  Building2,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ExternalLink,
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
  missing: string;
  howToFix: string[];
  actionLabel: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

async function getJson(url: string) {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
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
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    setLoadError("");
    try {
      const results = await Promise.allSettled([
        getJson(`/api/companies/${companyId}`),
        getJson(`/api/phone-numbers`),
        getJson(`/api/ai-voice/config?companyId=${companyId}&_=${Date.now()}`),
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
      const hasGreeting = !!String(aiConfig?.greeting ?? aiConfig?.initialGreeting ?? "").trim();
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
          detail: companyInfoComplete ? "Basic company profile is entered." : "Industry or contact information is incomplete.",
          missing: companyInfoComplete ? "Nothing required right now." : "Add an industry and at least one contact method: phone, email, or website.",
          howToFix: ["Open the company profile.", "Click Edit Company.", "Enter the industry and at least one contact method.", "Save the company profile."],
          actionLabel: "Open Company Profile",
          href: `/companies/${companyId}`,
          icon: Building2,
        },
        {
          key: "phone",
          title: "Phone Line Connected",
          description: "At least one phone number must belong to this company.",
          status: hasPhone ? "complete" : "missing",
          detail: hasPhone ? `${numbers.length} phone line${numbers.length === 1 ? "" : "s"} connected.` : "No phone line is connected.",
          missing: hasPhone ? "Nothing required right now." : "This company does not have a phone number assigned to it.",
          howToFix: ["Open the company profile.", "Choose Link Phone Number.", "Select an available Twilio number.", "Save and confirm the line appears under Phone System."],
          actionLabel: hasPhone ? "Review Phone Line" : "Connect Phone Line",
          href: hasPhone ? `/numbers/${numbers[0].id}` : `/companies/${companyId}`,
          icon: Phone,
        },
        {
          key: "ai",
          title: "AI Agent Configured",
          description: "Greeting, speaking style and business instructions used during calls.",
          status: hasAiPrompt && hasGreeting ? "complete" : hasAiPrompt ? "attention" : "missing",
          detail: hasAiPrompt && hasGreeting ? "AI instructions and greeting are configured." : hasAiPrompt ? "AI instructions exist, but the initial greeting is blank." : "AI instructions have not been configured.",
          missing: hasAiPrompt && hasGreeting ? "Nothing required right now." : hasAiPrompt ? "The Initial Greeting field is empty. This is the first sentence callers hear." : "The System Prompt and Initial Greeting are both missing.",
          howToFix: hasAiPrompt
            ? ["Open AI Agent Setup.", "Find the Initial Greeting field near the top.", "Enter the exact first sentence the agent should say.", "Save the AI settings, then return here and click Refresh."]
            : ["Open AI Agent Setup.", "Enter the agent identity, business rules, services, prices, and escalation instructions.", "Add an Initial Greeting.", "Save the AI settings, then return here and click Refresh."],
          actionLabel: "Open AI Agent Setup",
          href: `/settings?companyId=${companyId}`,
          icon: Bot,
        },
        {
          key: "services",
          title: "Services and Pricing",
          description: "Bookable services, durations and approved customer-facing price information.",
          status: hasServices ? "complete" : "missing",
          detail: hasServices ? `${services.filter(row => row.active !== false).length} active service${services.filter(row => row.active !== false).length === 1 ? "" : "s"}. Review pricing in AI Agent Setup.` : "No structured booking services are entered.",
          missing: hasServices ? "Services exist. Confirm that approved prices are also written in AI Agent Setup." : "No active bookable services have been created.",
          howToFix: ["Open Booking & Availability.", "Add every service the company accepts appointments for.", "Enter the duration and buffers.", "Keep approved customer-facing prices in AI Agent Setup until structured pricing is added."],
          actionLabel: "Manage Services",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: Settings2,
        },
        {
          key: "resources",
          title: "Staff or Bookable Resources",
          description: "Barbers, technicians, agents, chairs, rooms, vehicles or other capacity.",
          status: hasResources ? "complete" : "missing",
          detail: hasResources ? `${resources.filter(row => row.active !== false).length} active resource${resources.filter(row => row.active !== false).length === 1 ? "" : "s"}.` : "No staff or bookable resources are entered.",
          missing: hasResources ? "Nothing required right now." : "The booking engine has no person, chair, room, table, technician, or vehicle to assign.",
          howToFix: ["Open Booking & Availability.", "Add each bookable person or capacity item.", "Choose whether automatic assignment is allowed.", "Assign the services each resource can perform."],
          actionLabel: "Manage Resources",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: Users,
        },
        {
          key: "hours",
          title: "Availability and Working Hours",
          description: "Hours, breaks and time off used to prevent invalid bookings.",
          status: hasHours ? "complete" : "missing",
          detail: hasHours ? `${availability.length} availability row${availability.length === 1 ? "" : "s"} configured.` : "No working hours are configured.",
          missing: hasHours ? "Nothing required right now." : "No resource has working hours, so the system cannot safely confirm availability.",
          howToFix: ["Open Booking & Availability.", "Select a resource.", "Add one working-hours row for every day it is available.", "Add breaks, vacation, and time off where needed."],
          actionLabel: "Set Working Hours",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: CalendarCheck,
        },
        {
          key: "booking",
          title: "Booking Rules",
          description: "Timezone, notice, automatic assignment and approval requirements.",
          status: bookingSettings ? (bookingEnabled ? "complete" : "attention") : "missing",
          detail: bookingSettings ? (bookingEnabled ? "Booking engine is enabled." : "Booking engine is currently disabled.") : "Booking rules have not been saved.",
          missing: bookingSettings ? (bookingEnabled ? "Nothing required right now." : "AI and dashboard bookings are disabled for this company.") : "The company has not saved its booking timezone, notice, assignment, and approval rules.",
          howToFix: ["Open Booking & Availability.", "Review the Company Booking Rules section.", "Enable AI and dashboard bookings if this company accepts appointments.", "Confirm timezone, notice, advance window, assignment, and approval settings, then save."],
          actionLabel: "Review Booking Rules",
          href: `/bookings/setup?companyId=${companyId}`,
          icon: CalendarCheck,
        },
        {
          key: "users",
          title: "Company Admin Access",
          description: "A company administrator should be able to manage company configuration.",
          status: hasAdmin ? "complete" : "attention",
          detail: hasAdmin ? "At least one active company admin exists." : "No active company admin account exists.",
          missing: hasAdmin ? "Nothing required right now." : "Create at least one active user with the Company Admin role.",
          howToFix: ["Open the company profile.", "Find Company Portal Users.", "Create a new user or update an existing user.", "Set the role to Company Admin and confirm the account is active."],
          actionLabel: "Manage Company Users",
          href: `/companies/${companyId}`,
          icon: Users,
        },
        {
          key: "test",
          title: "End-to-End Test Call",
          description: "Confirm incoming voice, AI response, call logging, booking and SMS confirmation.",
          status: "attention",
          detail: "Manual verification is still required after the setup items above are complete.",
          missing: "The system cannot automatically prove that the full customer journey has been tested successfully yet.",
          howToFix: ["Call the company phone number from another phone.", "Confirm the AI answers with the correct greeting and business information.", "Ask it to create a test booking and verify the appointment appears.", "Confirm the call log, recording, and SMS confirmation are saved.", "Delete or cancel the test appointment afterward."],
          actionLabel: hasPhone ? "Open Phone Line" : "Connect Phone Line First",
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
          <p className="text-sm text-muted-foreground mt-1">{company?.name || "Company"} · Click a card to see exactly what is missing and how to fix it.</p>
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {items.map(item => {
            const style = styles[item.status];
            const StatusIcon = style.icon;
            const ItemIcon = item.icon;
            const expanded = expandedKey === item.key;
            return (
              <section key={item.key} className={`rounded-lg border bg-card transition-colors ${expanded ? "border-primary/50" : "border-border"}`}>
                <button onClick={() => setExpandedKey(expanded ? null : item.key)} className="w-full text-left p-4 hover:bg-card/80 transition-colors group rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0"><ItemIcon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3"><h2 className="font-semibold text-sm">{item.title}</h2>{expanded ? <ChevronDown className="h-4 w-4 text-primary flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary flex-shrink-0" />}</div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</p>
                      <div className="flex items-center gap-2 mt-3"><span className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-[10px] font-semibold ${style.className}`}><StatusIcon className="h-3 w-3" />{style.label}</span><span className="text-[11px] text-muted-foreground">{item.detail}</span></div>
                    </div>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-border px-4 py-4 space-y-4">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60 mb-1">What is missing</div>
                      <p className="text-sm text-foreground/90 leading-relaxed">{item.missing}</p>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-widest font-bold text-muted-foreground/60 mb-2">How to fix it</div>
                      <ol className="space-y-2">
                        {item.howToFix.map((step, index) => (
                          <li key={index} className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed">
                            <span className="h-5 w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 text-[10px] font-bold">{index + 1}</span>
                            <span className="pt-0.5">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                    <Button size="sm" onClick={() => navigate(item.href)} className="gap-2">
                      {item.actionLabel}<ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
