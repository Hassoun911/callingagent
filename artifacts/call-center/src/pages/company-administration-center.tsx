import { useMemo } from "react";
import { useLocation } from "wouter";
import { Bot, Building2, CalendarDays, Phone, Settings2, Users } from "lucide-react";
import CompanySetupOverview from "@/pages/company-setup-overview";
import PortalVisibilityAdmin from "@/components/portal-visibility-admin";

const CONTROL_LINKS = [
  { label: "Company profile", description: "Business information, contact details, users, and linked phone lines.", icon: Building2, href: (id: number) => `/companies/${id}` },
  { label: "Phone system", description: "Routing, forwarding, AI answering, voicemail, and line configuration.", icon: Phone, href: (id: number) => `/companies/${id}` },
  { label: "AI agent", description: "Voice engine, greeting, speaking style, prompt, services, and behavior.", icon: Bot, href: (id: number) => `/settings?companyId=${id}` },
  { label: "Booking & availability", description: "Services, staff, resources, hours, time off, and booking rules.", icon: CalendarDays, href: (id: number) => `/bookings/setup?companyId=${id}` },
  { label: "Company users", description: "Create company administrators and operational users.", icon: Users, href: (id: number) => `/companies/${id}` },
];

export default function CompanyAdministrationCenter() {
  const [, navigate] = useLocation();
  const companyId = useMemo(
    () => Number(new URLSearchParams(window.location.search).get("companyId") || 0),
    [],
  );

  if (!companyId) {
    return <div className="py-20 text-center text-muted-foreground">Choose a company to open its administration center.</div>;
  }

  return (
    <div className="space-y-8 pb-24">
      <section className="mx-auto max-w-5xl overflow-hidden rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04]">
        <div className="border-b border-cyan-500/15 px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-cyan-400" />
            <h1 className="text-xl font-bold">Company Administration Center</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">All company setup and sub-admin access controls are organized on this page.</p>
        </div>

        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
          {CONTROL_LINKS.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => navigate(item.href(companyId))}
                className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-cyan-500/30 hover:bg-cyan-500/[0.04]"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
                  <Icon className="h-4 w-4" />
                </div>
                <h2 className="mt-3 text-sm font-semibold">{item.label}</h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p>
              </button>
            );
          })}
        </div>
      </section>

      <CompanySetupOverview />

      <section className="mx-auto max-w-5xl space-y-3">
        <div>
          <h2 className="text-xl font-bold">Sub-admin access and visibility</h2>
          <p className="mt-1 text-sm text-muted-foreground">Control exactly what this company can see and manage. These settings affect this company only.</p>
        </div>
        <PortalVisibilityAdmin companyId={companyId} inline />
      </section>
    </div>
  );
}
