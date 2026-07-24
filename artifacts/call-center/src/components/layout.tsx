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
  ClipboardCheck,
  PhoneCall as PhoneSetup,
} from "lucide-react";
import { useWatches } from "@/hooks/use-watches";
import { useListCompanies, useListPhoneNumbers } from "@workspace/api-client-react";
import { useAuthContext } from "@/App";

function NotificationBell() {
  const { data: watches } = useWatches();
  const available = watches?.filter(w => w.status === "available") ?? [];
  return (
    <Link href="/numbers" className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground sm:h-8 sm:w-8">
      <Bell className="h-5 w-5 sm:h-4 sm:w-4" />
      {available.length > 0 && (
        <span className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground sm:-right-0.5 sm:-top-0.5">
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
    const companyMatch = location.match(/^\/companies\/(\d+)/);
    if (companyMatch) return parseInt(companyMatch[1]);

    const numberMatch = location.match(/^\/numbers\/(\d+)/);
    if (numberMatch) {
      const numberId = parseInt(numberMatch[1]);
      return allNumbers?.find(number => number.id === numberId)?.companyId ?? null;
    }

    const queryCompanyId = new URLSearchParams(window.location.search).get("companyId");
    return queryCompanyId ? parseInt(queryCompanyId) : null;
  })();

  const contextCompany = activeCompanyId ? companies?.find(company => company.id === activeCompanyId) : null;

  const activeNumberId = (() => {
    const numberMatch = location.match(/^\/numbers\/(\d+)/);
    if (numberMatch) return parseInt(numberMatch[1]);

    const queryNumberId = new URLSearchParams(window.location.search).get("numberId");
    return queryNumberId ? parseInt(queryNumberId) : null;
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
      const currentParams = new URLSearchParams(window.location.search);
      for (const [key, value] of hrefParams.entries()) {
        if (currentParams.get(key) !== value) return false;
      }
      return true;
    }

    if (
      (href === "/campaigns" || href === "/numbers" || href === "/calls" || href === "/settings") &&
      window.location.search.includes("companyId=")
    ) return false;

    return location === href || (href !== "/" && location.startsWith(href));
  }

  function navClass(href: string, compact = false) {
    const sizing = compact ? "gap-2.5 px-3 py-2 text-sm" : "gap-3 px-3 py-2 text-sm";
    return isActive(href)
      ? `flex items-center ${sizing} rounded-md bg-primary/10 font-medium text-primary transition-colors`
      : `flex items-center ${sizing} rounded-md font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground`;
  }

  function companyNavClass(href: string, compact = false) {
    const sizing = compact ? "gap-2.5 px-2.5 py-2 text-sm" : "gap-2 px-2 py-1.5 text-xs";
    return `flex items-center ${sizing} rounded-md transition-colors ${
      isActive(href)
        ? "bg-primary/10 font-medium text-primary"
        : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
    }`;
  }

  function SectionLabel({ label, compact = false }: { label: string; compact?: boolean }) {
    return (
      <div className={`${compact ? "px-3 pb-1 pt-3 text-[10px]" : "px-3 pb-1 pt-4 text-[10px]"} font-semibold uppercase tracking-widest text-muted-foreground/50`}>
        {label}
      </div>
    );
  }

  function CompanyGroupLabel({ label, compact = false }: { label: string; compact?: boolean }) {
    return (
      <div className={`${compact ? "px-2.5 pb-1 pt-2.5 text-[9px]" : "px-2 pb-1 pt-3 text-[9px]"} font-bold uppercase tracking-[0.16em] text-muted-foreground/40`}>
        {label}
      </div>
    );
  }

  function NavContent({ onNav, compact = false, onClose }: { onNav?: () => void; compact?: boolean; onClose?: () => void }) {
    const onCompanyDetail = !!location.match(/^\/companies\/\d+/);
    const { logout } = useAuthContext();
    const companyNumbers = contextCompany ? allNumbers?.filter(number => number.companyId === contextCompany.id) ?? [] : [];

    return (
      <>
        <div className={`${compact ? "h-14 px-3" : "h-16 px-4"} flex flex-shrink-0 items-center justify-between border-b border-border`}>
          <img src="/logo.png" alt="CallingAgent" className={`${compact ? "h-7 max-w-[175px]" : "h-8 max-w-[190px]"} w-auto object-contain`} />
          {onClose && (
            <button
              onClick={onClose}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${compact ? "px-2 pb-4 pt-2" : "px-3 py-4"} space-y-0.5`}>
          <SectionLabel label="Overview" compact={compact} />
          <Link href="/" onClick={onNav} className={navClass("/", compact)}>
            <LayoutDashboard className="h-4 w-4 flex-shrink-0" /> Dashboard
          </Link>

          <SectionLabel label="Companies" compact={compact} />
          <Link href="/companies" onClick={onNav} className={navClass("/companies", compact)}>
            <Building2 className="h-4 w-4 flex-shrink-0" /> All Companies
          </Link>

          {contextCompany && (
            <div className={`${compact ? "mt-1 p-1.5" : "ml-1 mt-2 p-2"} space-y-0.5 rounded-lg border border-border/60 bg-background/30`}>
              <Link
                href={`/companies/${contextCompany.id}`}
                onClick={onNav}
                className={`flex items-center gap-2 truncate rounded-md px-2 py-2 font-semibold transition-colors ${compact ? "text-sm" : "text-xs"} ${
                  onCompanyDetail ? "bg-primary/10 text-primary" : "text-primary/80 hover:bg-primary/5 hover:text-primary"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{contextCompany.name}</span>
              </Link>

              <CompanyGroupLabel label="Daily Work" compact={compact} />
              <Link href={`/contacts?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/contacts?companyId=${contextCompany.id}`, compact)}>
                <Users className="h-3.5 w-3.5 flex-shrink-0" /> Contacts
              </Link>
              <Link href={`/calls?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/calls?companyId=${contextCompany.id}`, compact)}>
                <PhoneCall className="h-3.5 w-3.5 flex-shrink-0" /> Call Logs
              </Link>
              <Link href={`/messages?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/messages?companyId=${contextCompany.id}`, compact)}>
                <MessageSquare className="h-3.5 w-3.5 flex-shrink-0" /> Messages
              </Link>
              <Link href={`/leads?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/leads?companyId=${contextCompany.id}`, compact)}>
                <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" /> Leads
              </Link>
              <Link href={`/bookings?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/bookings?companyId=${contextCompany.id}`, compact)}>
                <CalendarDays className="h-3.5 w-3.5 flex-shrink-0" /> Appointments
              </Link>

              <CompanyGroupLabel label="Setup & Control" compact={compact} />
              <Link href={`/company-setup?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/company-setup?companyId=${contextCompany.id}`, compact)}>
                <ClipboardCheck className="h-3.5 w-3.5 flex-shrink-0" /> Setup Overview
              </Link>
              <Link href={`/settings?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/settings?companyId=${contextCompany.id}`, compact)}>
                <Bot className="h-3.5 w-3.5 flex-shrink-0" /> AI Agent Setup
              </Link>
              <Link href={`/bookings/setup?companyId=${contextCompany.id}`} onClick={onNav} className={companyNavClass(`/bookings/setup?companyId=${contextCompany.id}`, compact)}>
                <CalendarCog className="h-3.5 w-3.5 flex-shrink-0" /> Booking & Availability
              </Link>

              {companyNumbers.length > 0 && <CompanyGroupLabel label="Phone System" compact={compact} />}
              {companyNumbers.map(number => {
                const numberActive = activeNumberId === number.id;
                return (
                  <div key={number.id} className="space-y-0.5">
                    <Link
                      href={`/numbers/${number.id}`}
                      onClick={onNav}
                      className={`flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors ${compact ? "text-sm" : "text-xs"} ${
                        numberActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                      }`}
                    >
                      <PhoneSetup className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate">Phone Line Setup</div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground/60">{formatPhone(number.number)}</div>
                      </div>
                    </Link>
                    <Link
                      href={`/campaigns?companyId=${contextCompany.id}&numberId=${number.id}`}
                      onClick={onNav}
                      className={companyNavClass(`/campaigns?companyId=${contextCompany.id}&numberId=${number.id}`, compact)}
                    >
                      <Target className="h-3.5 w-3.5 flex-shrink-0" /> Campaign Setup
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 border-t border-border bg-card">
          <div className={`${compact ? "px-2 py-1.5" : "px-3 py-2"}`}>
            <Link href="/billing" onClick={onNav} className={navClass("/billing", compact)}>
              <CreditCard className="h-4 w-4 flex-shrink-0" /> Billing
            </Link>
          </div>
          <div className={`${compact ? "px-3 py-2" : "px-4 py-3"} border-t border-border/60`}>
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">A</div>
              <div className="min-w-0 flex-1 text-[11px] leading-tight">
                <div className="truncate font-medium text-foreground">Admin User</div>
                <div className="truncate text-muted-foreground">System Operator</div>
              </div>
              <button
                onClick={logout}
                title="Sign out"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background">
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-border bg-card md:flex"><NavContent /></aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 h-[100dvh] md:hidden">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute bottom-0 left-0 top-0 flex h-[100dvh] w-[82vw] max-w-[310px] flex-col overflow-hidden border-r border-border bg-card shadow-2xl">
            <NavContent compact onNav={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <main className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="z-10 flex h-14 flex-shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/60 sm:h-16 sm:px-4 md:px-6">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <button
              className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="h-2.5 w-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] sm:h-2 sm:w-2" />
              <span className="text-xs font-medium text-green-400 sm:hidden">Online</span>
              <span className="hidden sm:inline">Systems Online</span>
              <span className="hidden text-border sm:inline">|</span>
              <span className="hidden font-mono text-xs sm:inline">US-EAST-1</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <NotificationBell />
            <div className="hidden font-mono text-xs text-muted-foreground sm:block">
              {new Date().toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })} ET
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-background p-3 sm:p-4 md:p-6">
          <div className="mx-auto max-w-6xl">{children}</div>
        </div>
      </main>
    </div>
  );
}
