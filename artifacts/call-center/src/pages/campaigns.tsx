import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Play, Pause, Trash2, Users, ChevronRight, Target,
  ChevronLeft, FileText, Phone,
} from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  script: string;
  systemPrompt: string | null;
  fromPhoneNumberId: number | null;
  notificationEmail: string | null;
  status: "draft" | "active" | "paused" | "completed";
  maxCallDuration: number | null;
  createdAt: string;
  updatedAt: string;
  totalContacts: number | null;
  pendingContacts: number | null;
  completedContacts: number | null;
  interestedContacts: number | null;
}

interface PhoneNumber {
  id: number;
  number: string;
  friendlyName: string | null;
}

interface CalendarEvent {
  id: number;
  campaignId: number;
  campaignName: string;
  name: string;
  phone: string;
  callOutcome: string | null;
  callSummary: string | null;
  eventType: "hot_lead" | "callback";
  callbackAt: string | null;
  calendarNotes: string | null;
  lastAttemptAt: string | null;
  hasRecording: boolean;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchCampaigns(): Promise<Campaign[]> {
  const r = await fetch(`${BASE}/api/campaigns`);
  if (!r.ok) throw new Error("Failed to fetch campaigns");
  return r.json();
}

async function fetchPhoneNumbers(): Promise<PhoneNumber[]> {
  const r = await fetch(`${BASE}/api/phone-numbers`);
  if (!r.ok) throw new Error("Failed to fetch phone numbers");
  return r.json();
}

async function fetchCalendarEvents(): Promise<CalendarEvent[]> {
  const r = await fetch(`${BASE}/api/campaigns/calendar`);
  if (!r.ok) throw new Error("Failed to fetch calendar events");
  return r.json();
}

function statusBadge(status: Campaign["status"]) {
  const variants: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-green-500/15 text-green-400 border border-green-500/20",
    paused: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
    completed: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${variants[status] ?? ""}`}>
      {status}
    </span>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

// ─── Calendar Tab ─────────────────────────────────────────────────────────────
function CalendarTab() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [currentDate, setCurrentDate] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editCallbackAt, setEditCallbackAt] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["campaigns-calendar"],
    queryFn: fetchCalendarEvents,
    refetchInterval: 30000,
  });

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const dateStr = e.callbackAt ?? e.lastAttemptAt;
      if (!dateStr) continue;
      const d = new Date(dateStr);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [events]);

  function prevMonth() {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }
  function nextMonth() {
    setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
  function goToday() {
    const d = new Date();
    setCurrentDate(new Date(d.getFullYear(), d.getMonth(), 1));
  }

  function openEvent(e: CalendarEvent) {
    setSelectedEvent(e);
    setEditNotes(e.calendarNotes ?? "");
    const dateStr = e.callbackAt ?? e.lastAttemptAt;
    if (dateStr) {
      const d = new Date(dateStr);
      const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
      setEditCallbackAt(local);
    } else {
      setEditCallbackAt("");
    }
  }

  async function saveEvent() {
    if (!selectedEvent) return;
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/campaigns/${selectedEvent.campaignId}/contacts/${selectedEvent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarNotes: editNotes || null,
          callbackAt: editCallbackAt ? new Date(editCallbackAt).toISOString() : null,
        }),
      });
      if (!r.ok) throw new Error("Failed");
      await qc.invalidateQueries({ queryKey: ["campaigns-calendar"] });
      setSelectedEvent(null);
      toast({ title: "Saved" });
    } catch {
      toast({ title: "Failed to save", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const monthName = currentDate.toLocaleString("default", { month: "long", year: "numeric" });
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const hotLeadCount = events.filter(e => e.eventType === "hot_lead").length;
  const callbackCount = events.filter(e => e.eventType === "callback").length;

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-lg px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Hot Leads</div>
          <div className="text-2xl font-bold mt-1 text-green-400">{hotLeadCount}</div>
        </div>
        <div className="bg-card border border-border rounded-lg px-4 py-3">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Callbacks Scheduled</div>
          <div className="text-2xl font-bold mt-1 text-orange-400">{callbackCount}</div>
        </div>
      </div>

      {/* Calendar */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Nav */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
          <button
            onClick={prevMonth}
            className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <span className="font-semibold text-foreground">{monthName}</span>
            <button
              onClick={goToday}
              className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-0.5 transition-colors"
            >
              Today
            </button>
          </div>
          <button
            onClick={nextMonth}
            className="p-1.5 rounded hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAYS.map(d => (
            <div key={d} className="text-center text-[11px] font-semibold uppercase text-muted-foreground py-2 bg-secondary/10">
              {d}
            </div>
          ))}
        </div>

        {/* Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading...</div>
        ) : (
          <div className="grid grid-cols-7">
            {cells.map((day, i) => {
              if (day === null) {
                return (
                  <div
                    key={`blank-${i}`}
                    className={`min-h-[90px] bg-secondary/5 ${i % 7 !== 6 ? "border-r border-border/40" : ""} ${i < cells.length - 7 ? "border-b border-border/40" : ""}`}
                  />
                );
              }
              const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const dayEvents = eventsByDate.get(dateKey) ?? [];
              const isToday =
                today.getFullYear() === year &&
                today.getMonth() === month &&
                today.getDate() === day;
              const col = i % 7;
              const row = Math.floor(i / 7);
              const totalRows = cells.length / 7;

              return (
                <div
                  key={dateKey}
                  className={`min-h-[90px] p-1.5 ${col !== 6 ? "border-r border-border/40" : ""} ${row < totalRows - 1 ? "border-b border-border/40" : ""} ${isToday ? "bg-primary/5" : ""}`}
                >
                  <div
                    className={`text-xs font-mono mb-1 w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground font-bold" : "text-muted-foreground"}`}
                  >
                    {day}
                  </div>
                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 3).map(e => (
                      <button
                        key={e.id}
                        onClick={() => openEvent(e)}
                        className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded truncate font-medium transition-colors ${
                          e.eventType === "hot_lead"
                            ? "bg-green-500/20 text-green-400 hover:bg-green-500/30"
                            : "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                        }`}
                      >
                        {e.name}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] text-muted-foreground px-1">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
          🔥 Hot Lead
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
          📞 Callback
        </span>
      </div>

      {/* All events list */}
      {events.length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-secondary/20">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              All Events — {events.length}
            </span>
          </div>
          <div className="divide-y divide-border/50">
            {events.map(e => {
              const dateStr = e.callbackAt ?? e.lastAttemptAt;
              return (
                <div
                  key={e.id}
                  onClick={() => openEvent(e)}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/20 transition-colors cursor-pointer"
                >
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 ${
                      e.eventType === "hot_lead"
                        ? "bg-green-500/15 text-green-400"
                        : "bg-orange-500/15 text-orange-400"
                    }`}
                  >
                    {e.eventType === "hot_lead" ? "🔥 Hot Lead" : "📞 Callback"}
                  </span>
                  <span className="font-medium text-sm truncate">{e.name}</span>
                  <span className="text-xs text-muted-foreground font-mono flex-shrink-0">{e.phone}</span>
                  <span className="text-xs text-muted-foreground flex-1 truncate text-right">{e.campaignName}</span>
                  {dateStr && (
                    <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                      {new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                  {e.calendarNotes && (
                    <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  )}
                  {e.callbackAt && (
                    <span className="text-[10px] bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded flex-shrink-0">
                      {new Date(e.callbackAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {events.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
          <Target className="h-7 w-7 opacity-25" />
          <div className="text-sm">No callbacks or hot leads yet.</div>
          <div className="text-xs">Events appear here when contacts request a callback or are marked as hot leads.</div>
        </div>
      )}

      {/* Event detail / edit modal */}
      {selectedEvent && (
        <Dialog open onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                    selectedEvent.eventType === "hot_lead"
                      ? "bg-green-500/15 text-green-400"
                      : "bg-orange-500/15 text-orange-400"
                  }`}
                >
                  {selectedEvent.eventType === "hot_lead" ? "🔥 Hot Lead" : "📞 Callback"}
                </span>
                {selectedEvent.name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Phone</div>
                  <div className="font-mono flex items-center gap-1.5">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {selectedEvent.phone}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-0.5">Campaign</div>
                  <div>{selectedEvent.campaignName}</div>
                </div>
              </div>

              {selectedEvent.callSummary && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Call Summary
                  </div>
                  <div className="text-sm bg-secondary/30 rounded-md p-3 text-foreground/80 leading-relaxed">
                    {selectedEvent.callSummary}
                  </div>
                </div>
              )}

              {selectedEvent.hasRecording && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                    Call Recording
                  </div>
                  <audio
                    controls
                    className="w-full h-9 rounded-md"
                    src={`${BASE}/api/campaigns/${selectedEvent.campaignId}/contacts/${selectedEvent.id}/recording`}
                    preload="none"
                  >
                    Your browser does not support audio playback.
                  </audio>
                </div>
              )}

              <div>
                <Label className="text-green-400 text-xs font-semibold uppercase tracking-wider">
                  Callback Date & Time
                </Label>
                <input
                  type="datetime-local"
                  className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={editCallbackAt}
                  onChange={e => setEditCallbackAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Set when an agent should call this contact back.
                </p>
              </div>

              <div>
                <Label className="text-green-400 text-xs font-semibold uppercase tracking-wider">
                  Notes
                </Label>
                <Textarea
                  className="mt-1.5 min-h-[90px] resize-none"
                  placeholder="Add notes about this contact for your agents..."
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-border">
                <Button variant="outline" onClick={() => setSelectedEvent(null)}>Cancel</Button>
                <Button onClick={saveEvent} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function Campaigns() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<"campaigns" | "calendar">("campaigns");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    script: "مرحبا، أنا سارة من The Property Cousins Group. أتواصل معك اليوم بخصوص عقارك. هل أنت مهتم بالبيع؟",
    systemPrompt: "",
    fromPhoneNumberId: "",
    notificationEmail: "",
    maxCallDuration: "300",
  });

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
    refetchInterval: 8000,
  });

  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["phone-numbers"],
    queryFn: fetchPhoneNumbers,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch(`${BASE}/api/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          script: data.script,
          systemPrompt: data.systemPrompt || null,
          fromPhoneNumberId: data.fromPhoneNumberId ? parseInt(data.fromPhoneNumberId, 10) : null,
          notificationEmail: data.notificationEmail || null,
          maxCallDuration: parseInt(data.maxCallDuration, 10) || 300,
        }),
      });
      if (!r.ok) throw new Error("Failed to create campaign");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setShowCreate(false);
      setForm({
        name: "",
        script: "مرحبا، أنا سارة من The Property Cousins Group. أتواصل معك اليوم بخصوص عقارك. هل أنت مهتم بالبيع؟",
        systemPrompt: "",
        fromPhoneNumberId: "",
        notificationEmail: "",
        maxCallDuration: "300",
      });
      toast({ title: "Campaign created" });
    },
    onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/campaigns/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast({ title: "Campaign deleted" });
    },
    onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "start" | "pause" }) => {
      const r = await fetch(`${BASE}/api/campaigns/${id}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`Failed to ${action} campaign`);
      return r.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast({
        title: vars.action === "start" ? "Campaign started — dialing contacts" : "Campaign paused",
      });
    },
    onError: (_, vars) =>
      toast({ title: `Failed to ${vars.action} campaign`, variant: "destructive" }),
  });

  const totalContacts = campaigns.reduce((s, c) => s + (c.totalContacts ?? 0), 0);
  const totalInterested = campaigns.reduce((s, c) => s + (c.interestedContacts ?? 0), 0);
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-green-400">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Outbound cold calling — AI-powered seller qualification
          </p>
        </div>
        {activeTab === "campaigns" && (
          <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New Campaign
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {(["campaigns", "calendar"] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === "calendar" ? (
        <CalendarTab />
      ) : (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Active Campaigns", value: activeCampaigns, accent: activeCampaigns > 0 },
              { label: "Total Contacts", value: totalContacts, accent: false },
              { label: "Hot Leads", value: totalInterested, accent: totalInterested > 0 },
            ].map(({ label, value, accent }) => (
              <div key={label} className="bg-card border border-border rounded-lg px-4 py-3">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {label}
                </div>
                <div className={`text-2xl font-bold mt-1 ${accent ? "text-green-400" : "text-foreground"}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
                Loading campaigns...
              </div>
            ) : campaigns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
                <Target className="h-8 w-8 opacity-30" />
                <div className="text-sm">No campaigns yet. Create your first to start dialing.</div>
                <Button size="sm" onClick={() => setShowCreate(true)} variant="outline">
                  Create Campaign
                </Button>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/30">
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Campaign</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Progress</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Hot Leads</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Created</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c, i) => (
                    <tr
                      key={c.id}
                      className={`border-b border-border/50 hover:bg-secondary/20 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/5"}`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/campaigns/${c.id}`}
                          className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1.5 group"
                        >
                          {c.name}
                          <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </Link>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {c.totalContacts ?? 0} contacts
                        </div>
                      </td>
                      <td className="px-4 py-3">{statusBadge(c.status)}</td>
                      <td className="px-4 py-3 w-40">
                        {(c.totalContacts ?? 0) > 0 ? (
                          <>
                            <ProgressBar value={c.completedContacts ?? 0} max={c.totalContacts ?? 1} />
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {c.completedContacts ?? 0} / {c.totalContacts ?? 0} called
                            </div>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">No contacts</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {(c.interestedContacts ?? 0) > 0 ? (
                          <span className="text-green-400 font-bold text-sm">{c.interestedContacts}</span>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {c.status === "active" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs gap-1"
                              onClick={() => statusMutation.mutate({ id: c.id, action: "pause" })}
                              disabled={statusMutation.isPending}
                            >
                              <Pause className="h-3 w-3" />
                              Pause
                            </Button>
                          ) : c.status !== "completed" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2.5 text-xs gap-1 text-green-400 border-green-500/30 hover:bg-green-500/10"
                              onClick={() => statusMutation.mutate({ id: c.id, action: "start" })}
                              disabled={statusMutation.isPending || (c.totalContacts ?? 0) === 0}
                            >
                              <Play className="h-3 w-3" />
                              {c.status === "paused" ? "Resume" : "Start"}
                            </Button>
                          ) : null}
                          <Link href={`/campaigns/${c.id}`}>
                            <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs gap-1">
                              <Users className="h-3 w-3" />
                              Contacts
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Cold Calling Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label className="text-green-400">Campaign Name</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. Q1 Real Estate Outreach"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-secondary/40 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, systemPrompt: "" }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${!form.systemPrompt ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Script Mode
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, systemPrompt: f.systemPrompt || " " }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${form.systemPrompt ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                AI Prompt Mode
              </button>
            </div>

            {!form.systemPrompt ? (
              <div>
                <Label className="text-green-400">Opening Script (Arabic)</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                  The AI reads this verbatim when the contact answers, then qualifies using the default prompt.
                </p>
                <Textarea
                  className="mt-1.5 min-h-[100px] text-right"
                  dir="rtl"
                  placeholder="مرحبا، أنا سارة..."
                  value={form.script}
                  onChange={e => setForm(f => ({ ...f, script: e.target.value }))}
                />
              </div>
            ) : (
              <div>
                <Label className="text-green-400">AI System Prompt</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                  The AI generates its own opening and drives the entire conversation.
                </p>
                <Textarea
                  className="mt-1.5 min-h-[120px]"
                  placeholder="e.g. You are Sarah, a real estate agent from The Property Cousins Group..."
                  value={form.systemPrompt.trimStart()}
                  onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                />
                <button
                  type="button"
                  className="mt-1.5 text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => setForm(f => ({ ...f, systemPrompt: "" }))}
                >
                  Switch back to Script Mode
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-green-400">From Phone Number</Label>
                <select
                  className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.fromPhoneNumberId}
                  onChange={e => setForm(f => ({ ...f, fromPhoneNumberId: e.target.value }))}
                >
                  <option value="">Select a number...</option>
                  {phoneNumbers.map((p: PhoneNumber) => (
                    <option key={p.id} value={p.id}>
                      {p.friendlyName ?? p.number} — {p.number}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-green-400">Max Call Duration (seconds)</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  min="60"
                  max="600"
                  value={form.maxCallDuration}
                  onChange={e => setForm(f => ({ ...f, maxCallDuration: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label className="text-green-400">Hot Lead Notification Email</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                Receive an email when a contact says they're interested in selling.
              </p>
              <Input
                className="mt-1.5"
                type="email"
                placeholder="agent@example.com"
                value={form.notificationEmail}
                onChange={e => setForm(f => ({ ...f, notificationEmail: e.target.value }))}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                onClick={() => createMutation.mutate(form)}
                disabled={!form.name || !form.script || createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
