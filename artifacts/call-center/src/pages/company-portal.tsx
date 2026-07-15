import { useState, useRef } from "react";
import { Switch, Route, Link, useLocation } from "wouter";
import {
  LayoutDashboard, Phone, Target, PhoneIncoming, Users, LogOut,
  PhoneCall, Menu, Building2, Settings, CalendarDays, Bell, Check,
  ChevronRight, Clock,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useListPhoneNumbers, useListCampaigns, useGetCompany,
  useGetAiVoiceConfig, useUpdateAiVoiceConfig, getGetAiVoiceConfigQueryKey,
} from "@workspace/api-client-react";
import type { AuthUser } from "@/App";
import { useAuthContext } from "@/App";
import NumberDetail from "@/pages/number-detail";
import CampaignDetail from "@/pages/campaign-detail";
import Calls from "@/pages/calls";
import Contacts from "@/pages/contacts";
import Campaigns from "@/pages/campaigns";
import Bookings from "@/pages/bookings";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-3 pt-4 pb-1">
      <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground/50">{label}</span>
    </div>
  );
}

function navCls(path: string) {
  const [loc] = useLocation();
  const active = loc === path || (path !== "/portal" && loc.startsWith(path));
  return `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors cursor-pointer ${
    active
      ? "bg-primary/10 text-primary font-medium"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
  }`;
}

function PortalSidebar({ company, onNav }: { company: { name: string } | null; onNav?: () => void }) {
  const { user, logout } = useAuthContext();

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border-r border-border">
      <div className="h-16 flex items-center px-6 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2 text-primary">
          <PhoneCall className="h-5 w-5" />
          <div>
            <span className="font-bold text-sm text-foreground tracking-tight">VANGUARD<span className="text-primary">.OPS</span></span>
            {company && <p className="text-[10px] text-muted-foreground leading-none mt-0.5 truncate max-w-[140px]">{company.name}</p>}
          </div>
        </div>
      </div>

      <div className="flex-1 py-4 px-3 overflow-y-auto space-y-0.5">
        <SectionLabel label="Overview" />
        <Link href="/portal" onClick={onNav} className={navCls("/portal")}>
          <LayoutDashboard className="h-4 w-4 flex-shrink-0" />
          Dashboard
        </Link>

        <SectionLabel label="Operations" />
        <Link href="/portal/numbers" onClick={onNav} className={navCls("/portal/numbers")}>
          <Phone className="h-4 w-4 flex-shrink-0" />
          Phone Numbers
        </Link>
        <Link href="/portal/campaigns" onClick={onNav} className={navCls("/portal/campaigns")}>
          <Target className="h-4 w-4 flex-shrink-0" />
          Campaigns
        </Link>
        <Link href="/portal/calls" onClick={onNav} className={navCls("/portal/calls")}>
          <PhoneIncoming className="h-4 w-4 flex-shrink-0" />
          Call Logs
        </Link>
        <Link href="/portal/contacts" onClick={onNav} className={navCls("/portal/contacts")}>
          <Users className="h-4 w-4 flex-shrink-0" />
          Contacts
        </Link>
        <Link href="/portal/bookings" onClick={onNav} className={navCls("/portal/bookings")}>
          <CalendarDays className="h-4 w-4 flex-shrink-0" />
          Bookings
        </Link>
        {user?.role === "company_admin" && (
          <>
            <SectionLabel label="Admin" />
            <Link href="/portal/users" onClick={onNav} className={navCls("/portal/users")}>
              <Users className="h-4 w-4 flex-shrink-0" />
              Users
            </Link>
          </>
        )}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-center justify-between px-3 py-2">
          <div>
            <p className="text-xs font-medium text-foreground">{user?.firstName ?? user?.id}</p>
            <p className="text-[10px] text-muted-foreground capitalize">{user?.role?.replace("_", " ")}</p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface Appointment {
  id: number;
  companyId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  title: string;
  notes: string | null;
  startTime: string;
  endTime: string | null;
  status: "scheduled" | "confirmed" | "cancelled" | "no_show";
}

const APPT_STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-500/10 text-blue-400",
  confirmed: "bg-emerald-500/10 text-emerald-400",
  cancelled: "bg-red-500/10 text-red-400",
  no_show: "bg-yellow-500/10 text-yellow-400",
};

function AdminNotifyWidget({ role }: { role: string }) {
  const qc = useQueryClient();
  const { data: config } = useGetAiVoiceConfig();
  const update = useUpdateAiVoiceConfig({
    mutation: {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetAiVoiceConfigQueryKey() }); },
    },
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  if (role !== "company_admin") return null;

  const current = config?.adminNotifyPhone ?? null;

  function startEdit() {
    setValue(current ?? "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function save() {
    update.mutate({ data: { adminNotifyPhone: value.trim() || null } });
    setEditing(false);
  }

  if (!current && !editing) {
    return (
      <div className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3">
        <Bell className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-amber-300">Post-call notifications not configured</p>
          <p className="text-xs text-muted-foreground mt-0.5">Set an admin phone number to receive SMS or WhatsApp alerts after each call.</p>
        </div>
        <button
          onClick={startEdit}
          className="text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 px-3 py-1.5 rounded font-medium transition-colors flex-shrink-0"
        >
          Set up
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 bg-card border border-border rounded-lg px-4 py-3">
      <Bell className="h-4 w-4 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">Notification Phone</p>
        {editing ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="+1... or whatsapp:+1..."
              className="flex-1 bg-background border border-border rounded px-2 py-1 text-sm text-foreground focus:outline-none focus:border-primary font-mono"
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            />
            <button onClick={save} className="p-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
              <Check className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <p className="text-sm font-mono text-foreground">{current}</p>
        )}
      </div>
      {!editing && (
        <button onClick={startEdit} className="text-xs text-muted-foreground hover:text-foreground underline">Edit</button>
      )}
    </div>
  );
}

function PortalDashboard({ companyId, role }: { companyId: number; role: string }) {
  const { data: numbers } = useListPhoneNumbers();
  const { data: campaigns } = useListCampaigns();
  const { data: appointments } = useQuery<Appointment[]>({
    queryKey: ["appointments", companyId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/companies/${companyId}/appointments`, { credentials: "include" });
      if (!r.ok) return [];
      return r.json();
    },
  });

  const myNumbers = numbers?.filter(n => n.companyId === companyId) ?? [];
  const myCampaigns = campaigns?.filter(c => myNumbers.some(n => n.id === c.fromPhoneNumberId)) ?? [];

  const now = new Date();
  const upcoming = (appointments ?? []).filter(a =>
    (a.status === "scheduled" || a.status === "confirmed") && new Date(a.startTime) >= now
  ).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const todayAppts = (appointments ?? []).filter(a => {
    const d = new Date(a.startTime);
    return d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
  });

  function fmtTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your company operations</p>
      </div>

      <AdminNotifyWidget role={role} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Phone Numbers", value: myNumbers.length, icon: Phone },
          { label: "Active Campaigns", value: myCampaigns.filter(c => c.status === "active").length, icon: Target },
          { label: "Today's Bookings", value: todayAppts.length, icon: CalendarDays },
          { label: "Upcoming", value: upcoming.length, icon: Clock },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
              <Icon className="h-4 w-4 text-muted-foreground/40" />
            </div>
            <p className="text-3xl font-bold text-foreground tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Upcoming Bookings</h2>
          <Link href="/portal/bookings" className="text-xs text-primary hover:text-primary/80 flex items-center gap-1">
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            No upcoming bookings. AI voice will schedule them automatically.
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.slice(0, 5).map(a => (
              <div key={a.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <CalendarDays className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{a.customerName}</p>
                    <p className="text-xs text-muted-foreground">{a.title} &middot; {a.customerPhone}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground font-mono">{fmtTime(a.startTime)}</span>
                  <span className={`text-xs px-2 py-0.5 rounded capitalize font-medium ${APPT_STATUS_COLORS[a.status] ?? "bg-muted text-muted-foreground"}`}>
                    {a.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Your Phone Numbers</h2>
        {myNumbers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            No phone numbers assigned to your company yet.
          </div>
        ) : (
          <div className="space-y-2">
            {myNumbers.map(n => (
              <div key={n.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-primary" />
                  <span className="font-mono text-sm text-foreground">{n.number}</span>
                  {n.friendlyName && <span className="text-xs text-muted-foreground">{n.friendlyName}</span>}
                </div>
                <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded capitalize">
                  {n.answerMode?.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PortalNumbers({ companyId }: { companyId: number }) {
  const { data: numbers } = useListPhoneNumbers();
  const [, navigate] = useLocation();
  const myNumbers = numbers?.filter(n => n.companyId === companyId) ?? [];

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Phone Numbers</h1>
        <p className="text-sm text-muted-foreground mt-1">Your company's phone numbers — click Configure to manage routing, AI, and settings</p>
      </div>
      <div className="space-y-2">
        {myNumbers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
            No phone numbers assigned yet. Contact your administrator.
          </div>
        ) : myNumbers.map(n => (
          <div key={n.id} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-4">
            <div className="flex items-center gap-4">
              <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
                <Phone className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-mono text-sm font-medium text-foreground">{n.number}</p>
                {n.friendlyName && <p className="text-xs text-muted-foreground">{n.friendlyName}</p>}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs bg-muted text-muted-foreground px-2 py-1 rounded capitalize">
                {n.answerMode?.replace("_", " ")}
              </span>
              {n.forwardTo && (
                <span className="text-xs text-muted-foreground">Fwd: {n.forwardTo}</span>
              )}
              <button
                onClick={() => navigate(`/portal/numbers/${n.id}`)}
                className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 rounded transition-colors font-medium"
              >
                <Settings className="h-3 w-3" /> Configure
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PortalUsers({ companyId }: { companyId: number }) {
  const [users, setUsers] = useState<Array<{ id: number; username: string; email: string | null; role: string; isActive: boolean }>>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "company_user" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    const r = await fetch(`${BASE}/api/platform-users?companyId=${companyId}`, { credentials: "include" });
    const data = await r.json();
    setUsers(data);
    setLoading(false);
  }

  useState(() => { load(); });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const r = await fetch(`${BASE}/api/platform-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...form, companyId, email: form.email || null }),
      });
      if (!r.ok) {
        const d = await r.json();
        setError(d.error ?? "Failed to create user");
      } else {
        setShowAdd(false);
        setForm({ username: "", email: "", password: "", role: "company_user" });
        load();
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(id: number, isActive: boolean) {
    await fetch(`${BASE}/api/platform-users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  async function deleteUser(id: number) {
    await fetch(`${BASE}/api/platform-users/${id}`, { method: "DELETE", credentials: "include" });
    load();
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage your company's portal users</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground text-sm font-semibold px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
        >
          Add User
        </button>
      </div>

      {showAdd && (
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-sm font-semibold mb-4">New User</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Username *</label>
              <input required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="username" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="email@company.com" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Password *</label>
              <input required type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="password" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
              <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
                className="w-full bg-background border border-border rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary">
                <option value="company_user">User</option>
                <option value="company_admin">Admin</option>
              </select>
            </div>
            {error && <p className="col-span-2 text-xs text-red-400">{error}</p>}
            <div className="col-span-2 flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAdd(false)} className="text-sm px-4 py-1.5 rounded border border-border hover:bg-muted text-muted-foreground">Cancel</button>
              <button type="submit" disabled={saving} className="text-sm px-4 py-1.5 rounded bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50">
                {saving ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm border border-dashed border-border rounded-lg">
          No users yet. Add the first user above.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 border-b border-border">
              <tr>
                {["Username", "Email", "Role", "Status", ""].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u, i) => (
                <tr key={u.id} className={i % 2 === 0 ? "bg-card" : "bg-muted/10"}>
                  <td className="px-4 py-3 font-medium text-foreground">{u.username}</td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email ?? "—"}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{u.role.replace("_", " ")}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
                      {u.isActive ? "Active" : "Disabled"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => toggleActive(u.id, u.isActive)}
                        className="text-xs text-muted-foreground hover:text-foreground underline">
                        {u.isActive ? "Disable" : "Enable"}
                      </button>
                      <button onClick={() => deleteUser(u.id)}
                        className="text-xs text-red-400 hover:text-red-300 underline">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function CompanyPortal({ user }: { user: AuthUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const companyId = user.companyId!;
  const { data: companyData } = useGetCompany(companyId);
  const company = companyData ?? null;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      <div className={`fixed inset-y-0 left-0 z-50 w-56 transform transition-transform duration-200 lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <PortalSidebar company={company} onNav={() => setMobileOpen(false)} />
      </div>
      <div className="hidden lg:flex w-56 flex-shrink-0">
        <PortalSidebar company={company} />
      </div>

      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="h-14 border-b border-border flex items-center justify-between px-6 flex-shrink-0 bg-background">
          <button className="lg:hidden p-1.5 rounded hover:bg-muted" onClick={() => setMobileOpen(true)}>
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 ml-auto">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">{company?.name ?? "Your Company"}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <Switch>
            <Route path="/portal" component={() => <PortalDashboard companyId={companyId} role={user.role ?? ""} />} />
            <Route path="/portal/numbers/:id" component={NumberDetail} />
            <Route path="/portal/numbers" component={() => <PortalNumbers companyId={companyId} />} />
            <Route path="/portal/campaigns/:id" component={CampaignDetail} />
            <Route path="/portal/campaigns" component={Campaigns} />
            <Route path="/portal/calls" component={Calls} />
            <Route path="/portal/contacts" component={Contacts} />
            <Route path="/portal/bookings" component={() => <Bookings />} />
            {user.role === "company_admin" && (
              <Route path="/portal/users" component={() => <PortalUsers companyId={companyId} />} />
            )}
            <Route component={() => <PortalDashboard companyId={companyId} role={user.role ?? ""} />} />
          </Switch>
        </div>
      </div>
    </div>
  );
}
