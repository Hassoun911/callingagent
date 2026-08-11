import { useEffect, useState } from "react";
import { Bell, Loader2, Mail, Menu, MessageCircle, Save, ShieldCheck, Wifi } from "lucide-react";
import { Link } from "wouter";
import type { AuthUser } from "@/App";
import PortalNavigation from "@/components/portal-navigation";
import { DEFAULT_PORTAL_VISIBILITY, getPortalVisibility, type PortalVisibility } from "@/lib/portal-visibility";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CompanyNotificationData = {
  id: number;
  name: string;
  adminWhatsapp?: string | null;
  adminNotificationEmail?: string | null;
};

function formatPhoneForInput(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return value;
  return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
}

export default function PortalNotifications({ user }: { user: AuthUser }) {
  const companyId = user.companyId;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [company, setCompany] = useState<CompanyNotificationData | null>(null);
  const [visibility, setVisibility] = useState<PortalVisibility>(DEFAULT_PORTAL_VISIBILITY);
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    Promise.all([
      fetch(`${BASE}/api/companies/${companyId}`, { credentials: "include", cache: "no-store" }).then(async response => {
        if (!response.ok) throw new Error("Could not load company notification settings.");
        return response.json() as Promise<CompanyNotificationData>;
      }),
      getPortalVisibility(companyId),
    ]).then(([companyData, visibilityData]) => {
      if (!active) return;
      setCompany(companyData);
      setVisibility(visibilityData);
      setWhatsapp(formatPhoneForInput(companyData.adminWhatsapp));
      setEmail(companyData.adminNotificationEmail ?? "");
    }).catch(err => {
      if (active) setError(err instanceof Error ? err.message : "Could not load notification settings.");
    }).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [companyId]);

  if (!companyId || user.role !== "company_admin") {
    return <div className="min-h-screen bg-background p-8 text-foreground"><div className="mx-auto max-w-xl rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 text-center"><h1 className="text-lg font-semibold text-amber-200">Feature unavailable</h1><p className="mt-2 text-sm text-amber-200/70">Only the company administrator can manage notification destinations.</p><Link href="/portal" className="mt-5 inline-flex rounded-lg border border-amber-500/20 px-4 py-2 text-sm text-amber-200">Return to dashboard</Link></div></div>;
  }

  const pageAllowed = visibility.pages.notifications;
  const canWhatsapp = visibility.notifications.adminWhatsapp;
  const canEmail = visibility.notifications.notificationEmail;
  const companyName = company?.name ?? "Your company";

  async function save() {
    if (!companyId || !pageAllowed) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const body: Record<string, string> = {};
      if (canWhatsapp) body.adminWhatsapp = whatsapp;
      if (canEmail) body.adminNotificationEmail = email;
      const response = await fetch(`${BASE}/api/companies/${companyId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? `Save failed (${response.status})`);
      setWhatsapp(formatPhoneForInput(result.adminWhatsapp ?? whatsapp));
      setEmail(result.adminNotificationEmail ?? email);
      setMessage("Notification destinations saved for this company.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  const content = !pageAllowed ? (
    <div className="mx-auto max-w-xl p-8"><div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8 text-center"><h1 className="text-lg font-semibold text-amber-200">Notifications are managed by the main administrator</h1><p className="mt-2 text-sm text-amber-200/70">Your company does not currently have permission to change these settings.</p><Link href="/portal" className="mt-5 inline-flex rounded-lg border border-amber-500/20 px-4 py-2 text-sm text-amber-200">Return to dashboard</Link></div></div>
  ) : (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header>
        <div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><Bell className="h-5 w-5" /></div><div><h1 className="text-2xl font-bold">Notifications</h1><p className="mt-1 text-sm text-muted-foreground">Choose where CallingAgent sends company alerts.</p></div></div>
      </header>

      <div className="rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4 text-sm text-cyan-100/80">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" /><p>These settings only change alert destinations for <strong>{companyName}</strong>. Phone routing, Twilio settings, AI instructions, and line configuration remain controlled by the main administrator.</p></div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">Admin alert destinations</h2><p className="mt-1 text-xs text-muted-foreground">Call, booking, and emergency notifications use these company-level destinations.</p></div>
        <div className="space-y-5 p-5">
          {canWhatsapp && <div><label className="mb-2 flex items-center gap-2 text-sm font-medium"><MessageCircle className="h-4 w-4 text-emerald-400" />Admin WhatsApp number</label><input value={whatsapp} onChange={event => setWhatsapp(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="226-555-1234" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10" /><p className="mt-2 text-xs text-muted-foreground">Canadian or US 10-digit number. This becomes the WhatsApp recipient for this company.</p></div>}
          {canEmail && <div><label className="mb-2 flex items-center gap-2 text-sm font-medium"><Mail className="h-4 w-4 text-cyan-400" />Admin notification email</label><input value={email} onChange={event => setEmail(event.target.value)} type="email" autoComplete="email" placeholder="admin@company.com" className="w-full rounded-xl border border-border bg-background px-4 py-3 text-sm outline-none transition focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10" /><p className="mt-2 text-xs text-muted-foreground">Used for company-level booking and administrative notifications where email alerts are enabled.</p></div>}
          {!canWhatsapp && !canEmail && <p className="text-sm text-muted-foreground">The main administrator has not enabled any editable notification destinations.</p>}
        </div>
        {(canWhatsapp || canEmail) && <div className="flex flex-col gap-3 border-t border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div>{message && <p className="text-sm text-emerald-300">{message}</p>}{error && <p className="text-sm text-red-300">{error}</p>}</div><button type="button" onClick={save} disabled={saving || loading} className="inline-flex items-center justify-center rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:opacity-50">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save changes</button></div>}
      </section>
    </div>
  );

  return <div className="flex h-dvh overflow-hidden bg-background text-foreground">
    {mobileOpen && <button className="fixed inset-0 z-40 bg-black/75 lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
    <div className={`fixed inset-y-0 left-0 z-50 w-[min(86vw,292px)] transition-transform lg:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}><PortalNavigation companyName={companyName} mobile onClose={() => setMobileOpen(false)} /></div>
    <div className="hidden w-[272px] shrink-0 lg:block"><PortalNavigation companyName={companyName} /></div>
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-16 items-center border-b border-border px-4 sm:px-6"><button onClick={() => setMobileOpen(true)} className="mr-3 h-10 w-10 rounded-xl border border-border lg:hidden"><Menu className="mx-auto h-5 w-5" /></button><div><p className="text-sm font-semibold">Company Portal</p><p className="text-[11px] text-muted-foreground">{companyName}</p></div><div className="ml-auto flex items-center gap-2 rounded-full border border-emerald-500/20 px-3 py-1.5 text-xs text-emerald-300"><Wifi className="h-3.5 w-3.5" />Live</div></header>
      <main className="min-h-0 flex-1 overflow-y-auto">{loading ? <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading notifications…</div> : content}</main>
    </div>
  </div>;
}
