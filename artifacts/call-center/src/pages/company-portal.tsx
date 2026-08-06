import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import {
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Menu,
  Phone,
  RefreshCw,
  Settings,
  Target,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetAiVoiceConfigQueryKey,
  useGetAiVoiceConfig,
  useGetCompany,
  useListCampaigns,
  useListPhoneNumbers,
  useUpdateAiVoiceConfig,
} from "@workspace/api-client-react";
import type { AuthUser } from "@/App";
import PortalNavigation from "@/components/portal-navigation";
import Bookings from "@/pages/bookings";
import Calls from "@/pages/calls";
import CampaignDetail from "@/pages/campaign-detail";
import Campaigns from "@/pages/campaigns";
import Contacts from "@/pages/contacts";
import NumberDetail from "@/pages/number-detail";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const PORTAL = "/portal";

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "no_show";

interface Appointment {
  id: number;
  customerName: string;
  customerPhone: string;
  title: string;
  startTime: string;
  status: AppointmentStatus;
}

interface PortalUser {
  id: number;
  username: string;
  email: string | null;
  role: string;
  isActive: boolean;
}

const statusStyles: Record<AppointmentStatus, string> = {
  scheduled: "bg-blue-500/10 text-blue-300",
  confirmed: "bg-emerald-500/10 text-emerald-300",
  cancelled: "bg-red-500/10 text-red-300",
  no_show: "bg-amber-500/10 text-amber-300",
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // Keep the status-based fallback.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function formatPhone(value?: string | null): string {
  if (!value) return "—";
  const isWhatsApp = value.toLowerCase().startsWith("whatsapp:");
  const raw = isWhatsApp ? value.slice("whatsapp:".length) : value;
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const formatted = local.length === 10
    ? `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
    : raw;
  return isWhatsApp ? `WhatsApp: ${formatted}` : formatted;
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const isWhatsApp = trimmed.toLowerCase().startsWith("whatsapp:");
  const raw = isWhatsApp ? trimmed.slice("whatsapp:".length) : trimmed;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) throw new Error("Enter a valid phone number.");
  const number = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return isWhatsApp ? `whatsapp:${number}` : number;
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6 lg:p-8">{children}</div>;
}

function Heading({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-xl border border-border bg-card/50 text-sm text-muted-foreground">
      <RefreshCw className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

function Failure({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-8 text-center">
      <p className="text-sm font-medium text-red-300">{message}</p>
      {retry && (
        <button type="button" onClick={retry} className="rounded-md border border-red-500/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10">
          Try again
        </button>
      )}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

function NotificationPhone({ role }: { role: string }) {
  const client = useQueryClient();
  const { data: config } = useGetAiVoiceConfig();
  const update = useUpdateAiVoiceConfig({
    mutation: {
      onSuccess: () => client.invalidateQueries({ queryKey: getGetAiVoiceConfigQueryKey() }),
    },
  });
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const current = config?.adminNotifyPhone ?? null;

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  if (role !== "company_admin") return null;

  const edit = () => {
    setValue(current ?? "");
    setError("");
    setEditing(true);
  };

  const save = () => {
    try {
      update.mutate(
        { data: { adminNotifyPhone: normalizePhone(value) } },
        {
          onSuccess: () => setEditing(false),
          onError: () => setError("Could not save the notification phone."),
        },
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Enter a valid phone number.");
    }
  };

  return (
    <section className={`rounded-xl border p-4 ${current ? "border-border bg-card" : "border-amber-500/20 bg-amber-500/5"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Bell className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Notification phone</p>
          {editing ? (
            <div className="mt-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  ref={input}
                  value={value}
                  onChange={event => setValue(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === "Enter") save();
                    if (event.key === "Escape") setEditing(false);
                  }}
                  placeholder="2265551234 or WhatsApp:2265551234"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button type="button" onClick={save} disabled={update.isPending} className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
                    <Check className="mr-1 inline h-3.5 w-3.5" />Save
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
                    <X className="mr-1 inline h-3.5 w-3.5" />Cancel
                  </button>
                </div>
              </div>
              {error && <p className="mt-1 text-xs text-red-300">{error}</p>}
            </div>
          ) : (
            <p className={`mt-1 text-sm ${current ? "font-mono text-foreground" : "text-amber-200"}`}>
              {current ? formatPhone(current) : "Not configured — add a number for post-call alerts."}
            </p>
          )}
        </div>
        {!editing && (
          <button type="button" onClick={edit} className="self-start rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted sm:self-center">
            {current ? "Edit" : "Set up"}
          </button>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, icon: Icon, loading }: { label: string; value: number; icon: LucideIcon; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
      </div>
      <p className="mt-3 text-3xl font-bold tabular-nums text-foreground">{loading ? "—" : value}</p>
    </div>
  );
}

function Dashboard({ companyId, role }: { companyId: number; role: string }) {
  const numbers = useListPhoneNumbers();
  const campaigns = useListCampaigns();
  const appointments = useQuery<Appointment[]>({
    queryKey: ["company-portal", companyId, "appointments"],
    queryFn: () => requestJson<Appointment[]>(`${BASE}/api/companies/${companyId}/appointments`),
    staleTime: 30_000,
  });

  const companyNumbers = useMemo(
    () => (numbers.data ?? []).filter(number => number.companyId === companyId),
    [numbers.data, companyId],
  );
  const numberIds = useMemo(() => new Set(companyNumbers.map(number => number.id)), [companyNumbers]);
  const companyCampaigns = useMemo(
    () => (campaigns.data ?? []).filter(campaign => numberIds.has(campaign.fromPhoneNumberId)),
    [campaigns.data, numberIds],
  );
  const schedule = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const records = appointments.data ?? [];
    return {
      today: records.filter(item => {
        const date = new Date(item.startTime);
        return date >= start && date < end && item.status !== "cancelled";
      }),
      upcoming: records
        .filter(item => {
          const date = new Date(item.startTime);
          return date >= now && (item.status === "scheduled" || item.status === "confirmed");
        })
        .sort((a, b) => +new Date(a.startTime) - +new Date(b.startTime)),
    };
  }, [appointments.data]);

  const loading = numbers.isPending || campaigns.isPending || appointments.isPending;
  const failed = numbers.isError || campaigns.isError || appointments.isError;
  const retry = () => {
    void numbers.refetch();
    void campaigns.refetch();
    void appointments.refetch();
  };

  return (
    <Page>
      <Heading title="Dashboard" description="Overview of your company operations" />
      <NotificationPhone role={role} />
      {failed && <Failure message="Some dashboard information could not be loaded." retry={retry} />}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Company summary">
        <Stat label="Phone numbers" value={companyNumbers.length} icon={Phone} loading={loading} />
        <Stat label="Active campaigns" value={companyCampaigns.filter(item => item.status === "active").length} icon={Target} loading={loading} />
        <Stat label="Today's bookings" value={schedule.today.length} icon={CalendarDays} loading={appointments.isPending} />
        <Stat label="Upcoming" value={schedule.upcoming.length} icon={Clock} loading={appointments.isPending} />
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Upcoming bookings</h2>
          <Link href={`${PORTAL}/bookings`} className="flex items-center text-xs font-medium text-primary">
            View all <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
        {appointments.isPending ? (
          <Loading label="Loading bookings…" />
        ) : appointments.isError ? (
          <Failure message="Bookings could not be loaded." retry={() => void appointments.refetch()} />
        ) : !schedule.upcoming.length ? (
          <Empty>No upcoming bookings. New appointments created by the AI receptionist will appear here.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {schedule.upcoming.slice(0, 5).map((item, index) => (
              <div key={item.id} className={`flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${index ? "border-t border-border" : ""}`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{item.customerName || "Unnamed customer"}</p>
                  <p className="truncate text-xs text-muted-foreground">{item.title || "Appointment"} · {formatPhone(item.customerPhone)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <time dateTime={item.startTime} className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(item.startTime))}
                  </time>
                  <span className={`rounded-full px-2 py-1 text-[11px] capitalize ${statusStyles[item.status]}`}>{item.status.replace(/_/g, " ")}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your phone numbers</h2>
          <Link href={`${PORTAL}/numbers`} className="flex items-center text-xs font-medium text-primary">
            Manage <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
        {numbers.isPending ? (
          <Loading label="Loading phone numbers…" />
        ) : numbers.isError ? (
          <Failure message="Phone numbers could not be loaded." retry={() => void numbers.refetch()} />
        ) : !companyNumbers.length ? (
          <Empty>No phone numbers are assigned to this company yet.</Empty>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {companyNumbers.map((number, index) => (
              <Link key={number.id} href={`${PORTAL}/numbers/${number.id}`} className={`flex flex-col gap-3 px-4 py-4 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between ${index ? "border-t border-border" : ""}`}>
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium text-foreground">{formatPhone(number.number)}</p>
                  {number.friendlyName && <p className="truncate text-xs text-muted-foreground">{number.friendlyName}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] capitalize text-muted-foreground">{number.answerMode?.replace(/_/g, " ") || "Not configured"}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </Page>
  );
}

function Numbers({ companyId }: { companyId: number }) {
  const query = useListPhoneNumbers();
  const [, navigate] = useLocation();
  const records = useMemo(
    () => (query.data ?? []).filter(number => number.companyId === companyId),
    [query.data, companyId],
  );

  return (
    <Page>
      <Heading title="Phone Numbers" description="Manage call routing, forwarding, AI voice, and number settings." />
      {query.isPending ? (
        <Loading label="Loading phone numbers…" />
      ) : query.isError ? (
        <Failure message="Phone numbers could not be loaded." retry={() => void query.refetch()} />
      ) : !records.length ? (
        <Empty>No phone numbers are assigned yet. Contact the main administrator.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {records.map((number, index) => (
            <div key={number.id} className={`flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${index ? "border-t border-border" : ""}`}>
              <div>
                <p className="font-mono text-sm font-medium">{formatPhone(number.number)}</p>
                <p className="text-xs text-muted-foreground">{number.friendlyName || "No friendly name"}</p>
              </div>
              <button type="button" onClick={() => navigate(`${PORTAL}/numbers/${number.id}`)} className="self-start rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                <Settings className="mr-1 inline h-3.5 w-3.5" />Configure
              </button>
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}

function PortalUsers({ companyId }: { companyId: number }) {
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ username: "", email: "", password: "", role: "company_user" });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setUsers(await requestJson<PortalUser[]>(`${BASE}/api/platform-users?companyId=${companyId}`));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Users could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await requestJson(`${BASE}/api/platform-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, companyId, email: form.email.trim() || null }),
      });
      setAdding(false);
      setForm({ username: "", email: "", password: "", role: "company_user" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "User could not be created.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (record: PortalUser) => {
    try {
      await requestJson(`${BASE}/api/platform-users/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !record.isActive }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "User could not be updated.");
    }
  };

  const remove = async (record: PortalUser) => {
    if (!window.confirm(`Delete ${record.username}?`)) return;
    try {
      const response = await fetch(`${BASE}/api/platform-users/${record.id}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(`Delete failed (${response.status})`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "User could not be deleted.");
    }
  };

  return (
    <Page>
      <Heading
        title="Users"
        description="Manage who can access this company portal."
        action={<button type="button" onClick={() => setAdding(true)} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Add user</button>}
      />

      {adding && (
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 rounded-xl border border-border bg-card p-5 sm:grid-cols-2">
          <input required placeholder="Username" value={form.username} onChange={event => setForm(value => ({ ...value, username: event.target.value }))} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input type="email" placeholder="Email" value={form.email} onChange={event => setForm(value => ({ ...value, email: event.target.value }))} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <input required type="password" placeholder="Password" value={form.password} onChange={event => setForm(value => ({ ...value, password: event.target.value }))} className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <select value={form.role} onChange={event => setForm(value => ({ ...value, role: event.target.value }))} className="rounded-md border border-border bg-background px-3 py-2 text-sm">
            <option value="company_user">User</option>
            <option value="company_admin">Admin</option>
          </select>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <button type="button" onClick={() => setAdding(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button disabled={saving} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">{saving ? "Creating…" : "Create"}</button>
          </div>
        </form>
      )}

      {error && <Failure message={error} retry={() => void load()} />}
      {loading ? (
        <Loading label="Loading users…" />
      ) : !users.length ? (
        <Empty>No company users have been created yet.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[650px] text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                {["Username", "Email", "Role", "Status", "Actions"].map(label => (
                  <th key={label} className="px-4 py-3 text-left text-xs uppercase tracking-wider text-muted-foreground">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map(record => (
                <tr key={record.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium">{record.username}</td>
                  <td className="px-4 py-3 text-muted-foreground">{record.email ?? "—"}</td>
                  <td className="px-4 py-3 capitalize text-muted-foreground">{record.role.replace(/_/g, " ")}</td>
                  <td className="px-4 py-3">{record.isActive ? "Active" : "Disabled"}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => void toggle(record)} className="mr-3 text-xs text-muted-foreground">{record.isActive ? "Disable" : "Enable"}</button>
                    <button onClick={() => void remove(record)} className="text-xs text-red-300">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}

export default function CompanyPortal({ user }: { user: AuthUser }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [location] = useLocation();
  const companyId = user.companyId;
  const company = useGetCompany(companyId ?? 0);

  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  if (!companyId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <Failure message="This account is not assigned to a company." />
      </div>
    );
  }

  const companyName = company.data?.name ?? "Your company";

  return (
    <div className="flex h-dvh min-h-0 overflow-hidden bg-background text-foreground">
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/75 backdrop-blur-[2px] lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,292px)] transform shadow-2xl transition-transform duration-200 ease-out lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!mobileOpen}
      >
        <PortalNavigation companyName={companyName} mobile onClose={() => setMobileOpen(false)} />
      </div>

      <div className="hidden w-[272px] shrink-0 lg:block">
        <PortalNavigation companyName={companyName} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>

          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">Company Portal</p>
            <p className="truncate text-[11px] text-muted-foreground">{companyName}</p>
          </div>

          <div className="ml-auto hidden min-w-0 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 sm:flex">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="max-w-48 truncate text-xs text-muted-foreground">{companyName}</span>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Switch>
            <Route path={PORTAL}>{() => <Dashboard companyId={companyId} role={user.role ?? ""} />}</Route>
            <Route path={`${PORTAL}/numbers/:id`} component={NumberDetail} />
            <Route path={`${PORTAL}/numbers`}>{() => <Numbers companyId={companyId} />}</Route>
            <Route path={`${PORTAL}/campaigns/:id`} component={CampaignDetail} />
            <Route path={`${PORTAL}/campaigns`} component={Campaigns} />
            <Route path={`${PORTAL}/calls`} component={Calls} />
            <Route path={`${PORTAL}/contacts`} component={Contacts} />
            <Route path={`${PORTAL}/bookings`} component={Bookings} />
            {user.role === "company_admin" && (
              <Route path={`${PORTAL}/users`}>{() => <PortalUsers companyId={companyId} />}</Route>
            )}
            <Route>{() => <Dashboard companyId={companyId} role={user.role ?? ""} />}</Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}
