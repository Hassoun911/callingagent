import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Phone,
  PhoneCall,
  Users,
  Building2,
  Settings,
  Bell,
  CreditCard,
  MessageSquare,
  Target,
  Menu,
  X,
} from "lucide-react";
import { useWatches } from "@/hooks/use-watches";
import { useListCompanies, useListPhoneNumbers } from "@workspace/api-client-react";

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

  // Derive active company from current route or ?companyId= query param
  const activeCompanyId = (() => {
    const cm = location.match(/^\/companies\/(\d+)/);
    if (cm) return parseInt(cm[1]);
    const nm = location.match(/^\/numbers\/(\d+)/);
    if (nm) {
      const numId = parseInt(nm[1]);
      return allNumbers?.find(n => n.id === numId)?.companyId ?? null;
    }
    const qp = new URLSearchParams(window.location.search).get("companyId");
    if (qp) return parseInt(qp);
    return null;
  })();
  const contextCompany = activeCompanyId ? companies?.find(c => c.id === activeCompanyId) : null;

  // Active number: from /numbers/:id URL or ?numberId= param
  const activeNumberId = (() => {
    const nm = location.match(/^\/numbers\/(\d+)/);
    if (nm) return parseInt(nm[1]);
    const qp = new URLSearchParams(window.location.search).get("numberId");
    if (qp) return parseInt(qp);
    return null;
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
      for (const [k, v] of hrefParams.entries()) {
        if (curParams.get(k) !== v) return false;
      }
      return true;
    }
    // When there's a ?companyId= param active, don't highlight the generic top-level links
    if (
      (href === "/campaigns" || href === "/numbers" || href === "/calls" || href === "/settings") &&
      window.location.search.includes("companyId=")
    ) {
      return false;
    }
    return location === href || (href !== "/" && location.startsWith(href));
  }

  function navCls(href: string, asAncestor = false) {
    const active = isActive(href);
    if (active) return "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors bg-primary/10 text-primary";
    if (asAncestor) return "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground/60 hover:text-foreground hover:bg-secondary/50";
    return "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-secondary/50";
  }

  function SectionLabel({ label }: { label: string }) {
    return (
      <div className="px-3 pt-4 pb-1 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-widest">
        {label}
      </div>
    );
  }

  function NavContent({ onNav }: { onNav?: () => void }) {
    const onCompanyDetail = !!location.match(/^\/companies\/\d+/);

    return (
      <>
        <div className="h-16 flex items-center px-6 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 text-primary">
            <PhoneCall className="h-6 w-6" />
            <span className="font-bold text-lg text-foreground tracking-tight">
              VANGUARD<span className="text-primary">.OPS</span>
            </span>
          </div>
        </div>

        <div className="flex-1 py-4 px-3 overflow-y-auto space-y-0.5">

          {/* ── OVERVIEW ── */}
          <SectionLabel label="Overview" />
          <Link href="/" onClick={onNav} className={navCls("/")}>
            <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
            Dashboard
          </Link>

          {/* ── STRUCTURE ── */}
          <SectionLabel label="Structure" />

          {/* Companies */}
          <Link href="/companies" onClick={onNav} className={navCls("/companies")}>
            <Building2 className="h-4 w-4 flex-shrink-0" />
            Companies
          </Link>

          {/* Context: company name + its numbers shown when drilling into a company or its numbers */}
          {contextCompany ? (
            <div className="ml-4 space-y-0.5">
              <Link
                href={`/companies/${contextCompany.id}`}
                onClick={onNav}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors truncate ${
                  onCompanyDetail
                    ? "bg-primary/10 text-primary"
                    : "text-primary/60 hover:text-primary hover:bg-primary/5"
                }`}
              >
                <Building2 className="h-3 w-3 flex-shrink-0" />
                <span className="truncate">{contextCompany.name}</span>
              </Link>
              {/* Each number with its own sub-items */}
              {allNumbers?.filter(n => n.companyId === contextCompany.id).map(n => {
                const numActive = activeNumberId === n.id;
                return (
                  <div key={n.id} className="ml-2 space-y-0.5">
                    <Link
                      href={`/numbers/${n.id}`}
                      onClick={onNav}
                      className={`flex items-start gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                        numActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      <Phone className="h-3 w-3 flex-shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="font-mono truncate">{formatPhone(n.number)}</div>
                        {n.friendlyName && (
                          <div className="text-[10px] text-muted-foreground/70 truncate">{n.friendlyName}</div>
                        )}
                      </div>
                    </Link>
                    {/* Campaigns scoped to this number */}
                    <Link
                      href={`/campaigns?companyId=${contextCompany.id}&numberId=${n.id}`}
                      onClick={onNav}
                      className={`flex items-center gap-2 px-3 py-1 ml-3 rounded-md text-xs transition-colors ${
                        isActive(`/campaigns?companyId=${contextCompany.id}&numberId=${n.id}`)
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                      }`}
                    >
                      <Target className="h-3 w-3 flex-shrink-0" />
                      Campaigns
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Numbers */}
              <div className="ml-4 space-y-0.5">
                <Link href="/numbers" onClick={onNav} className={navCls("/numbers")}>
                  <Phone className="h-4 w-4 flex-shrink-0" />
                  Numbers
                </Link>
              </div>
              {/* Campaigns */}
              <div className="ml-8 space-y-0.5">
                <Link href="/campaigns" onClick={onNav} className={navCls("/campaigns")}>
                  <Target className="h-4 w-4 flex-shrink-0" />
                  Campaigns
                </Link>
              </div>
            </>
          )}

          {/* ── RECORDS ── */}
          <SectionLabel label="Records" />
          {/* Call Logs: scoped to company when in context, global otherwise */}
          {contextCompany ? (
            <Link href={`/calls?companyId=${contextCompany.id}`} onClick={onNav} className={navCls(`/calls?companyId=${contextCompany.id}`)}>
              <PhoneCall className="h-4 w-4 flex-shrink-0" />
              Call Logs
            </Link>
          ) : (
            <Link href="/calls" onClick={onNav} className={navCls("/calls")}>
              <PhoneCall className="h-4 w-4 flex-shrink-0" />
              Call Logs
            </Link>
          )}
          <Link href="/contacts" onClick={onNav} className={navCls("/contacts")}>
            <Users className="h-4 w-4 flex-shrink-0" />
            Contacts
          </Link>
          <Link href="/messages" onClick={onNav} className={navCls("/messages")}>
            <MessageSquare className="h-4 w-4 flex-shrink-0" />
            Messages
          </Link>

          {/* ── SYSTEM ── */}
          <SectionLabel label="System" />
          {/* AI Settings: scoped to company when in context, global otherwise */}
          {contextCompany ? (
            <Link href={`/settings?companyId=${contextCompany.id}`} onClick={onNav} className={navCls(`/settings?companyId=${contextCompany.id}`)}>
              <Settings className="h-4 w-4 flex-shrink-0" />
              AI Settings
            </Link>
          ) : (
            <Link href="/settings" onClick={onNav} className={navCls("/settings")}>
              <Settings className="h-4 w-4 flex-shrink-0" />
              AI Settings
            </Link>
          )}
          <Link href="/billing" onClick={onNav} className={navCls("/billing")}>
            <CreditCard className="h-4 w-4 flex-shrink-0" />
            Billing
          </Link>

        </div>

        <div className="p-4 border-t border-border flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
              A
            </div>
            <div className="text-xs min-w-0">
              <div className="font-medium text-foreground">Admin User</div>
              <div className="text-muted-foreground">System Operator</div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-64 flex-shrink-0 border-r border-border bg-card flex-col">
        <NavContent />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-card border-r border-border flex flex-col shadow-2xl">
            <div className="absolute top-3 right-3">
              <button
                onClick={() => setMobileOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavContent onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative min-w-0">
        <div className="h-16 flex-shrink-0 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex items-center px-4 md:px-6 justify-between z-10">
          <div className="flex items-center gap-3">
            <button
              className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
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
              {new Date().toLocaleTimeString("en-US", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
              })}{" "}
              ET
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-background p-4 md:p-6">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
