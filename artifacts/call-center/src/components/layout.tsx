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

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/numbers", label: "Numbers", icon: Phone },
    { href: "/calls", label: "Call Logs", icon: PhoneCall },
    { href: "/messages", label: "Messages", icon: MessageSquare },
    { href: "/contacts", label: "Contacts", icon: Users },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/settings", label: "AI Settings", icon: Settings },
    { href: "/campaigns", label: "Campaigns", icon: Target },
    { href: "/billing", label: "Billing", icon: CreditCard },
  ];

  function NavContent({ onNav }: { onNav?: () => void }) {
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
        <div className="flex-1 py-6 px-3 space-y-1 overflow-y-auto">
          <div className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Systems
          </div>
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNav}
                className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                }`}
              >
                <item.icon className="h-4 w-4 flex-shrink-0" />
                {item.label}
              </Link>
            );
          })}
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
            {/* Hamburger — mobile only */}
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
                timeZone: "America/Toronto",
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
