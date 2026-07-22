import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Phone,
  PhoneCall,
  Users,
  Building2,
  Bell,
  CreditCard,
  MessageSquare,
  Target,
  Menu,
  X,
  LogOut,
  CalendarDays,
  TrendingUp,
  Bot,
  CalendarCog,
  PhoneCall as PhoneSetup,
} from "lucide-react";
import { useWatches } from "@/hooks/use-watches";
import { useListCompanies, useListPhoneNumbers } from "@workspace/api-client-react";
import { useAuthContext } from "@/App";

function NotificationBell() {
  const { data: watches } = useWatches();
  const available = watches?.filter(w => w.status === "available") ?? [];
  return (
    <Link href="/numbers" className="relative flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
      <Bell className="h-4 w-4" />
      {available.length > 0 && (
        <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
          {available.length}
        </span>
      )}
    </Link>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: companies } = useListCompanies();
  const { data: allNumbers } = useListPhoneNumbers();

  const activeCompanyId = (() => {
    const cm = location.match(/^\/companies\/(\d+)/);
    if (cm) return parseInt(cm[1]);
    const nm = location.match(/^\/numbers\/(\d+)/);
    if (nm) {
      const numId = parseInt(nm[1]);
      return allNumbers?.find(n => n.id === numId)?.companyId ?? null;
    }
    const qp = new URLSearchParams(window.location.search).get("companyId");
    return qp ? parseInt(qp) : null;
  })();

  const contextCompany = activeCompanyId ? companies?.find(c => c.id === activeCompanyId) : null;

  const activeNumberId = (() => {
    const nm = location.match(/^\/numbers\/(\d+)/);
    if (nm) return parseInt(nm[1]);
    const qp = new URLSearchParams(window.location.search).get("numberId");
    return qp ? parseInt(qp) : null;
  })();

  function formatPhone(raw: string): string {
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 11 && digits[0] === "1") {
      return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }
    return raw;
  }

  function isActive(href: string) {
    const [hrefPath, hrefSearch] = href.split("?");
    if (hrefSearch) {
      if (location !== hrefPath) return false;
      const hrefParams = new URLSearchParams(hrefSearch);
      const curParams = new URLSearchParams(window.location.search);
      for (const [key, value] of hrefParams.entries()) {
        if (curParams.get(key) !== value) return false;
      }
      return true;
    }
    if (
      (href === "/campaigns" || href === "/numbers" || href === "/calls" || href === "/settings") &&
      window.location.search.includes("companyId=")
    ) return false;
    return location === href || (href !== "/" && location.startsWith(href));
  }

  function navCls(href: string) {
    return isActive(href)
      ? "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors bg-primary/10 text-primary"
      : "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/50";
  }

  function companyNavCls(href: string) {
    return `flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
      isActive(href)
        ? "bg-primary/10 text-primary font-medium"
        : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
    }`;
  }

  function SectionLabel({ label }: { label: string }) {
    return <div className="px-3 pt-4 pb-1 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">{label}</div>;
  }

  function CompanyGroupLabel({ label }: { label: string }) {
    return <div className="px-2 pt-3 pb-1 text-[9px] font-bold text-muted-foreground/40 uppercase tracking-[0.16em]">{label}</div>;
  }

  function NavContent({ onNav }: { onNav?: () => void }) {
    const onCompanyDetail = !!location.match(/^\/companies\/\d+/);
    const { logout } = useAuthContext();
    const companyNumbers = contextCompany ? allNumbers?.filter(n => n.companyId === contextCompany.id) ?? [] : [];

    return (
      <>
        <div className="h-16 flex items-center px-4 border-b border-border flex-shrink-0">
          <img src="/logo.png" alt="CallingAgent" className="w-full h-auto object-contain" />
        </div>

        <div className="flex-1 py-4 px-3 overflow-y-auto space-y-0.5">
          <SectionLabel label="Overview" />
          <Link href="/" onClick={onNav} className={navCls("/")}>
            <LayoutDashboard className="h-4 w-4 flex-shrink-0" /> Dashboard
          </Link>

          <SectionLabel label="Companies" />
          <Link href="/companies" onClick={onNav} className={navCls("/companies")}>
            <Building2 className="h-4 w-4 flex-shrink-0" /> All Companies
          </Link>

          {contextCompany && (
            <div className="mt-2 ml-1 rounded-lg border border-border/60 bg-background/30 p-2 space-y-0.5">
              <Link
                href={`/companies/${contextCompany.id}`}
                onClick={onNav}
                className={`flex items-center gap-2 px-2 py-2 rounded-md text-xs font-semibold transition-colors truncate ${
                  onCompanyDetail ? "bg-primary/10 text-primary" : "text-primary/80 hover:text-primary hover:bg-primary/5"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{contextCompany.name}</span>
              </Link>

              <CompanyGroupLabel label="Daily Work" />
              <Link href={`/contacts?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/contacts?companyId=${contextCompany.id}`)}>
                <Users className="h-3 w-3 flex-shrink-0" /> Contacts
              </Link>
              <Link href={`/calls?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/calls?companyId=${contextCompany.id}`)}>
                <PhoneCall className="h-3 w-3 flex-shrink-0" /> Call Logs
              </Link>
              <Link href={`/messages?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/messages?companyId=${contextCompany.id}`)}>
                <MessageSquare className="h-3 w-3 flex-shrink-0" /> Messages
              </Link>
              <Link href={`/leads?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/leads?companyId=${contextCompany.id}`)}>
                <TrendingUp className="h-3 w-3 flex-shrink-0" /> Leads
              </Link>
              <Link href={`/bookings?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/bookings?companyId=${contextCompany.id}`)}>
                <CalendarDays className="h-3 w-3 flex-shrink-0" /> Appointments
              </Link>

              <CompanyGroupLabel label="Setup & Control" />
              <Link href={`/settings?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/settings?companyId=${contextCompany.id}`)}>
                <Bot className="h-3 w-3 flex-shrink-0" /> AI Agent Setup
              </Link>
              <Link href={`/bookings/setup?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavCls(`/bookings/setup?companyId=${contextCompany.id}`)}>
                <CalendarCog className="h-3 w-3 flex-shrink-0" /> Booking & Availability
              </Link>

              {companyNumbers.length > 0 && <CompanyGroupLabel label="Phone System" />}
              {companyNumbers.map(number => {
                const numberActive = activeNumberId === number.id;
                return (
                  <div key={number.id} className="space-y-0.5">
                    <Link
                      href={`/numbers/${number.id}`}
                      onClick={onNav}
                      className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                        numberActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      <PhoneSetup className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="truncate">Phone Line Setup</div>
                        <div className="font-mono text-[10px] text-muted-foreground/60 truncate">{formatPhone(number.number)}</div>
                      </div>
                    </Link>
                    <Link
                      href={`/campaigns?companyId=${contextCompany.id}&numberId=${number.id}`}
                      onClick={onNav}
                      className={companyNavCls(`/campaigns?companyId=${contextCompany.id}&numberId=${number.id}`)}
                    >
                      <Target className="h-3 w-3 flex-shrink-0" /> Campaign Setup
                    </Link>
                  </div>
                );
              })}
            </div>
          )}

          <SectionLabel label="System" />
          <Link href="/billing" onClick={onNav} className={navCls("/billing")}>
            <CreditCard className="h-4 w-4 flex-shrink-0" /> Billing
          </Link>
        </div>

        <div className="p-4 border-t border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">A</div>
            <div className="text-xs min-w-0 flex-1">
              <div className="font-medium text-foreground">Admin User</div>
              <div className="text-muted-foreground">System Operator</div>
            </div>
            <button onClick={logout} title="Sign out" className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex-shrink-0">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      <aside className="hidden md:flex w-64 flex-shrink-0 border-r border-border bg-card flex-col"><NavContent /></aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-64 bg-card border-r border-border flex flex-col shadow-2xl">
            <div className="absolute top-3 right-3">
              <button onClick={() => setMobileOpen(false)} className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavContent onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <main className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
        <div className="h-16 flex-shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-4 md:px-6 justify-between z-10">
          <div className="flex items-center gap-3">
            <button className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
              <span className="hidden sm:inline">Systems Online</span>
              <span className="hidden sm:inline text-border">|</span>
              <span className="hidden sm:inline font-mono text-xs">US-EAST-1</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="hidden sm:block font-mono text-xs text-muted-foreground">
              {new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })} ET
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-background p-4 md:p-6">
          <div className="max-w-6xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
