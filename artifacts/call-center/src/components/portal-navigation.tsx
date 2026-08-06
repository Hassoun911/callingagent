import { useEffect, useMemo, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarDays,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Radio,
  Target,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useAuthContext } from "@/App";

const PORTAL = "/portal";

export type PortalLiveStats = {
  activeCalls: number;
  unreadMessages: number;
  newBookings: number;
  recentCalls: number;
};

type PortalNavigationProps = {
  companyName: string;
  liveStats?: PortalLiveStats;
  connected?: boolean;
  lastUpdatedAt?: Date | null;
  mobile?: boolean;
  onClose?: () => void;
};

type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: keyof PortalLiveStats;
  companyAdminOnly?: boolean;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const navigationGroups: NavigationGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: PORTAL, icon: LayoutDashboard }],
  },
  {
    label: "Operations",
    items: [
      { label: "Phone Numbers", href: `${PORTAL}/numbers`, icon: Phone },
      { label: "Campaigns", href: `${PORTAL}/campaigns`, icon: Target },
      { label: "Call Logs", href: `${PORTAL}/calls`, icon: PhoneIncoming, badgeKey: "recentCalls" },
      { label: "Messages", href: `${PORTAL}/messages`, icon: MessageSquare, badgeKey: "unreadMessages" },
      { label: "Contacts", href: `${PORTAL}/contacts`, icon: Users },
      { label: "Bookings", href: `${PORTAL}/bookings`, icon: CalendarDays, badgeKey: "newBookings" },
    ],
  },
  {
    label: "Administration",
    items: [{ label: "Users", href: `${PORTAL}/users`, icon: Users, companyAdminOnly: true }],
  },
];

function isActivePath(location: string, href: string): boolean {
  if (href === PORTAL) return location === PORTAL || location === `${PORTAL}/`;
  return location === href || location.startsWith(`${href}/`);
}

function displayRole(role?: string | null): string {
  if (!role) return "Portal user";
  if (role === "company_admin") return "Company administrator";
  if (role === "company_user") return "Company user";
  return role.replace(/_/g, " ");
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "U";
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
}

function badgeLabel(value: number): string {
  return value > 99 ? "99+" : String(value);
}

export default function PortalNavigation({
  companyName,
  liveStats = { activeCalls: 0, unreadMessages: 0, newBookings: 0, recentCalls: 0 },
  connected = true,
  lastUpdatedAt,
  mobile = false,
  onClose,
}: PortalNavigationProps) {
  const [location] = useLocation();
  const { user, logout } = useAuthContext();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const visibleGroups = useMemo(
    () => navigationGroups
      .map(group => ({
        ...group,
        items: group.items.filter(item => !item.companyAdminOnly || user?.role === "company_admin"),
      }))
      .filter(group => group.items.length > 0),
    [user?.role],
  );

  useEffect(() => {
    if (!mobile) return;
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [mobile, onClose]);

  const userName = user?.firstName?.trim() || user?.email?.trim() || `User ${user?.id ?? ""}`.trim();

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-white/[0.08] bg-[#090e16] text-slate-100" aria-label="Company portal navigation">
      <div className="flex h-[76px] shrink-0 items-center gap-3 border-b border-white/[0.08] px-5">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.08)]">
          <PhoneCall className="h-5 w-5" aria-hidden="true" />
          {liveStats.activeCalls > 0 && <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full border-2 border-[#090e16] bg-emerald-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-0.5 text-[15px] font-black tracking-[-0.03em]"><span className="text-white">CALLING</span><span className="text-cyan-400">AGENT</span></div>
          <p className="mt-0.5 truncate text-[11px] font-medium text-slate-400">{companyName}</p>
        </div>
        {mobile && <button ref={closeButtonRef} type="button" onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] text-slate-400 transition hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400" aria-label="Close navigation"><X className="h-4 w-4" /></button>}
      </div>

      <div className={`mx-3 mt-3 flex items-center gap-2 rounded-xl border px-3 py-2 ${connected ? "border-emerald-400/15 bg-emerald-400/[0.06] text-emerald-300" : "border-amber-400/15 bg-amber-400/[0.06] text-amber-300"}`}>
        {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold">{connected ? "Live synchronization active" : "Reconnecting…"}</p>
          <p className="truncate text-[10px] opacity-70">{lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}` : "Waiting for first update"}</p>
        </div>
        {liveStats.activeCalls > 0 && <div className="flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-bold"><Radio className="h-3 w-3 animate-pulse" />{liveStats.activeCalls} live</div>}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-5" aria-label="Company portal pages">
        <div className="space-y-6">
          {visibleGroups.map(group => (
            <section key={group.label} aria-labelledby={`portal-nav-${group.label.toLowerCase().replace(/\s+/g, "-")}`}>
              <h2 id={`portal-nav-${group.label.toLowerCase().replace(/\s+/g, "-")}`} className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{group.label}</h2>
              <div className="space-y-1">
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active = isActivePath(location, item.href);
                  const badge = item.badgeKey ? liveStats[item.badgeKey] : 0;
                  return (
                    <Link key={item.href} href={item.href} onClick={onClose} aria-current={active ? "page" : undefined} className={`group relative flex min-h-11 items-center gap-3 overflow-hidden rounded-xl px-3.5 py-2.5 text-sm font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-cyan-400 ${active ? "bg-cyan-400/[0.11] text-cyan-300 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.12)]" : "text-slate-400 hover:bg-white/[0.045] hover:text-slate-100"}`}>
                      <span className={`absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-cyan-400 transition-opacity ${active ? "opacity-100" : "opacity-0"}`} />
                      <Icon className={`h-[18px] w-[18px] shrink-0 transition-colors ${active ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"}`} strokeWidth={1.8} />
                      <span className="truncate">{item.label}</span>
                      {badge > 0 && <span className={`ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${item.badgeKey === "unreadMessages" ? "bg-cyan-400 text-slate-950" : "bg-white/[0.08] text-slate-300"}`}>{badgeLabel(badge)}</span>}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="shrink-0 border-t border-white/[0.08] p-3">
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.025] p-2">
          <div className="flex items-center gap-3 p-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-xs font-bold text-slate-200 ring-1 ring-white/[0.08]">{initials(userName)}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{userName}</p><p className="truncate text-[11px] capitalize text-slate-500">{displayRole(user?.role)}</p></div>
          </div>
          <div className="mt-1 flex items-center gap-2 border-t border-white/[0.07] px-2 pt-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 text-[11px] text-slate-500"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{companyName}</span></div>
            <button type="button" onClick={logout} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-red-500/10 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label="Sign out" title="Sign out"><LogOut className="h-4 w-4" /></button>
          </div>
        </div>
      </div>
    </aside>
  );
}
