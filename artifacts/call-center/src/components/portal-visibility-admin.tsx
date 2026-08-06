import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, Loader2, Save, Settings2, X } from "lucide-react";
import {
  DEFAULT_PORTAL_VISIBILITY,
  getPortalVisibility,
  savePortalVisibility,
  type PortalVisibility,
} from "@/lib/portal-visibility";

const GROUPS: Array<{
  key: keyof PortalVisibility;
  title: string;
  description: string;
  labels: Record<string, string>;
}> = [
  {
    key: "pages",
    title: "Portal pages",
    description: "Show or hide complete pages in this company's sub-admin portal.",
    labels: {
      dashboard: "Dashboard",
      phoneNumbers: "Phone numbers",
      campaigns: "Campaigns",
      callLogs: "Call logs",
      messages: "Messages",
      contacts: "Contacts",
      bookings: "Bookings",
      users: "Users",
    },
  },
  {
    key: "dashboard",
    title: "Dashboard sections",
    description: "Choose what appears on this company's live dashboard.",
    labels: {
      liveCalls: "Live calls card",
      unreadSms: "Unread SMS card",
      todaysBookings: "Today's bookings card",
      activeCampaigns: "Active campaigns card",
      phoneLines: "Phone lines card",
      activityFeed: "Live activity feed",
      upcomingBookings: "Upcoming bookings",
      quickActions: "Quick actions",
    },
  },
  {
    key: "phoneNumber",
    title: "Phone-number controls",
    description: "Choose which line settings this company's sub-admin may see and change.",
    labels: {
      answerMode: "Call handling mode",
      forwarding: "Forwarding settings",
      greeting: "AI greeting",
      language: "AI language",
      aiInstructions: "Full AI instructions",
      voice: "Voice selection",
      voicemailGreeting: "Voicemail greeting",
      lineIdentity: "Line identity",
      notificationEmail: "Notification email",
      testCall: "Test call",
      twilioStatus: "Twilio line status",
    },
  },
];

function companyIdFromPath(): number | null {
  const match = window.location.pathname.match(/^\/companies\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : null;
}

export default function PortalVisibilityAdmin() {
  const [companyId, setCompanyId] = useState<number | null>(() => companyIdFromPath());
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<PortalVisibility>(DEFAULT_PORTAL_VISIBILITY);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const sync = () => setCompanyId(companyIdFromPath());
    window.addEventListener("popstate", sync);
    const timer = window.setInterval(sync, 500);
    return () => {
      window.removeEventListener("popstate", sync);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open || !companyId) return;
    setLoading(true);
    setMessage("");
    getPortalVisibility(companyId)
      .then(setSettings)
      .catch(() => setMessage("Could not load visibility settings."))
      .finally(() => setLoading(false));
  }, [companyId, open]);

  const hiddenCount = useMemo(
    () => Object.values(settings).reduce((total, group) => total + Object.values(group).filter(value => !value).length, 0),
    [settings],
  );

  if (!companyId) return null;

  const toggle = (group: keyof PortalVisibility, key: string) => {
    setSettings(current => ({
      ...current,
      [group]: {
        ...current[group],
        [key]: !(current[group] as Record<string, boolean>)[key],
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      setSettings(await savePortalVisibility(companyId, settings));
      setMessage("Saved for this company only.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-[80] inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-[#08111f] px-4 py-3 text-sm font-semibold text-cyan-300 shadow-2xl transition hover:bg-[#0b1a2d]"
      >
        <Settings2 className="h-4 w-4" />
        Sub-admin visibility
        {hiddenCount > 0 && <span className="rounded-full bg-cyan-400 px-2 py-0.5 text-[10px] font-bold text-slate-950">{hiddenCount} hidden</span>}
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1220] text-slate-100 shadow-2xl">
            <header className="flex items-start justify-between border-b border-slate-800 px-6 py-5">
              <div>
                <h2 className="text-xl font-bold">Sub-admin visibility</h2>
                <p className="mt-1 text-sm text-slate-400">Company #{companyId}. Changes apply only to this company.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading controls…</div>
              ) : (
                <div className="space-y-6">
                  {GROUPS.map(group => (
                    <section key={group.key} className="rounded-2xl border border-slate-800 bg-slate-900/50">
                      <div className="border-b border-slate-800 px-5 py-4">
                        <h3 className="font-semibold">{group.title}</h3>
                        <p className="mt-1 text-xs text-slate-500">{group.description}</p>
                      </div>
                      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                        {Object.entries(group.labels).map(([key, label]) => {
                          const visible = (settings[group.key] as Record<string, boolean>)[key];
                          return (
                            <button
                              key={key}
                              type="button"
                              onClick={() => toggle(group.key, key)}
                              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${visible ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200" : "border-slate-700 bg-slate-950/70 text-slate-400"}`}
                            >
                              <span className="text-sm font-medium">{label}</span>
                              {visible ? <Eye className="h-4 w-4 shrink-0" /> : <EyeOff className="h-4 w-4 shrink-0" />}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>

            <footer className="flex flex-col gap-3 border-t border-slate-800 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-slate-400">{message || "Visible items are available to this company. Hidden items remain under main-admin control."}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setSettings(DEFAULT_PORTAL_VISIBILITY)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Reset defaults</button>
                <button type="button" onClick={save} disabled={saving || loading} className="inline-flex items-center rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save for this company
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
