import React, { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useListContacts, useListCompanies } from "@workspace/api-client-react";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Play, Pause, Phone, Trash2, Plus, Upload,
  ChevronDown, ChevronRight, ChevronLeft, CheckCircle2, XCircle, Clock,
  PhoneOff, AlertCircle, Volume2, RefreshCw, Settings2, FileText,
  Calendar, Mic, Maximize2, Copy, Check, Download, CalendarClock, Pencil, X, Bot, Users2, Search, Building2,
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
  maxConcurrentCalls: number | null;
  scheduleConfig: string | null;
  createdAt: string;
  updatedAt: string;
  totalContacts: number | null;
  pendingContacts: number | null;
  completedContacts: number | null;
  interestedContacts: number | null;
}

interface CampaignContact {
  id: number;
  campaignId: number;
  name: string;
  phone: string;
  address: string | null;
  callStatus: "pending" | "calling" | "in_progress" | "completed" | "no_answer" | "failed" | "skipped";
  callOutcome: string | null;
  twilioCallSid: string | null;
  callSummary: string | null;
  transcription: string | null;
  recordingUrl: string | null;
  recordingSid: string | null;
  callDuration: number | null;
  interestedInSelling: boolean | null;
  timeline: string | null;
  askingPrice: string | null;
  propertyType: string | null;
  additionalNotes: string | null;
  attemptCount: number | null;
  lastAttemptAt: string | null;
  scheduledCallAt: string | null;
  userNotes: string | null;
  createdAt: string;
}

interface CampaignCallLog {
  id: number;
  contactId: number;
  campaignId: number;
  twilioCallSid: string | null;
  callStatus: string;
  callOutcome: string | null;
  callDuration: number | null;
  callSummary: string | null;
  transcription: string | null;
  recordingUrl: string | null;
  recordingSid: string | null;
  interestedInSelling: boolean | null;
  timeline: string | null;
  askingPrice: string | null;
  propertyType: string | null;
  additionalNotes: string | null;
  calledAt: string;
}

interface PhoneNumber {
  id: number;
  number: string;
  friendlyName: string | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function statusIcon(status: string, size = "h-3.5 w-3.5") {
  const map: Record<string, React.ReactElement> = {
    pending: <Clock className={`${size} text-muted-foreground`} />,
    calling: <Phone className={`${size} text-yellow-400 animate-pulse`} />,
    in_progress: <Phone className={`${size} text-emerald-400 animate-pulse`} />,
    completed: <CheckCircle2 className={`${size} text-green-400`} />,
    no_answer: <PhoneOff className={`${size} text-muted-foreground`} />,
    failed: <AlertCircle className={`${size} text-destructive`} />,
    skipped: <XCircle className={`${size} text-muted-foreground/50`} />,
  };
  return map[status] ?? <Clock className={`${size} text-muted-foreground`} />;
}

function outcomeBadge(interestedInSelling: boolean | null, callStatus: string, callOutcome: string | null, attemptCount?: number) {
  if (callStatus === "skipped") return <span className="text-xs text-muted-foreground/50 italic">Skipped</span>;
  if (callStatus === "pending") {
    if (attemptCount && attemptCount > 0)
      return <span className="text-xs text-muted-foreground/60 italic">No outcome</span>;
    return <span className="text-xs text-muted-foreground">Pending</span>;
  }
  if (callStatus === "calling") return <span className="text-xs text-yellow-400 font-semibold animate-pulse">Ringing...</span>;
  if (callStatus === "in_progress") return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300 bg-emerald-500/15 px-2 py-0.5 rounded border border-emerald-500/30">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
      Live
    </span>
  );
  if (callStatus === "no_answer") return <span className="text-xs text-muted-foreground">No answer</span>;
  if (callStatus === "failed") return <span className="text-xs text-destructive">Failed</span>;
  const isHot = interestedInSelling === true || callOutcome === "hot_lead" || callOutcome === "callback_requested";
  if (isHot) return (
    <span className="inline-flex items-center gap-1 text-xs font-bold text-green-400 bg-green-500/10 px-2 py-0.5 rounded border border-green-500/25">
      {callOutcome === "callback_requested" ? "Callback" : "Hot Lead"}
    </span>
  );
  if (interestedInSelling === false) return <span className="text-xs text-muted-foreground">Not interested</span>;
  if (callOutcome) return <span className="text-xs text-muted-foreground capitalize">{callOutcome.replace(/_/g, " ")}</span>;
  return <span className="text-xs text-muted-foreground">Completed</span>;
}

function formatDuration(secs: number | null) {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatTime(secs: number): string {
  if (!isFinite(secs) || isNaN(secs)) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

function RecordingPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [errored, setErrored] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  if (errored) return (
    <span className="text-xs text-destructive/70 italic">Recording unavailable</span>
  );

  return (
    <div className="flex items-center gap-1.5 bg-black/20 border border-border/40 rounded px-2 py-1">
      <button
        className="text-muted-foreground hover:text-green-400 transition-colors"
        onClick={() => {
          if (!audioRef.current) return;
          if (playing) { audioRef.current.pause(); setPlaying(false); }
          else { audioRef.current.play().catch(() => setErrored(true)); setPlaying(true); }
        }}
      >
        {playing ? <Pause className="h-3 w-3 text-green-400" /> : <Play className="h-3 w-3" />}
      </button>
      <button
        className="text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => {
          if (!audioRef.current) return;
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
          setPlaying(false);
          setCurrentTime(0);
        }}
      >
        <span className="inline-block h-2 w-2 bg-current rounded-sm" />
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        className="w-16 h-1 accent-green-500 cursor-pointer"
        onChange={e => {
          const t = parseFloat(e.target.value);
          setCurrentTime(t);
          if (audioRef.current) audioRef.current.currentTime = t;
        }}
      />
      <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap tabular-nums">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <audio
        ref={audioRef}
        src={src}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        onError={() => setErrored(true)}
      />
    </div>
  );
}

function CallLogEntry({ log, campaignId, onDeleted }: { log: CampaignCallLog; campaignId: number; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [copied, setCopied] = useState<"summary" | "transcript" | null>(null);
  const { toast } = useToast();

  function copyText(text: string, field: "summary" | "transcript") {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(field);
      setTimeout(() => setCopied(null), 2000);
    });
  }
  const hasRecording = !!(log.recordingSid || log.recordingUrl);
  const hasDetail = !!(log.callSummary || log.transcription || log.timeline || log.askingPrice || log.propertyType);
  const recordingUrl = hasRecording
    ? `${BASE}/api/campaigns/${campaignId}/call-logs/${log.id}/recording`
    : null;

  const isHot = log.interestedInSelling === true;

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this call record?")) return;
    setDeleting(true);
    try {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/call-logs/${log.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed");
      onDeleted();
    } catch {
      toast({ title: "Failed to delete call record", variant: "destructive" });
      setDeleting(false);
    }
  }

  return (
    <div className={`rounded border ${isHot ? "border-green-500/30 bg-green-500/5" : "border-border/40 bg-black/10"} overflow-hidden`}>
      {/* Log header row */}
      <div
        className={`flex items-center gap-3 px-3 py-2 ${hasDetail ? "cursor-pointer hover:bg-white/5" : ""} transition-colors`}
        onClick={() => hasDetail && setExpanded(e => !e)}
      >
        {/* Expand toggle */}
        <span className="flex-shrink-0 w-4">
          {hasDetail ? (
            expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
          ) : null}
        </span>

        {/* Status icon + outcome */}
        <span className="flex items-center gap-1.5 min-w-[100px]">
          {statusIcon(log.callStatus)}
          {outcomeBadge(log.interestedInSelling, log.callStatus, log.callOutcome)}
        </span>

        {/* Duration */}
        <span className="text-xs text-muted-foreground w-16 shrink-0 tabular-nums">{formatDuration(log.callDuration)}</span>

        {/* Recording player + download */}
        <span className="flex-1 min-w-0 flex items-center gap-2">
          {recordingUrl && <RecordingPlayer src={recordingUrl} />}
          {recordingUrl && (
            <a
              href={`${recordingUrl}?download=1`}
              download={`call-${log.id}.mp3`}
              onClick={e => e.stopPropagation()}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              title="Download recording"
            >
              <Download className="h-3.5 w-3.5" />
            </a>
          )}
        </span>

        {/* Date/time + delete */}
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 flex items-center gap-2 ml-auto">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formatDateTime(log.calledAt)}
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
            title="Delete this call record"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div className="border-t border-border/30 px-4 py-3">
          <div className="flex justify-end mb-2">
            <button
              onClick={(e) => { e.stopPropagation(); setDetailOpen(true); }}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground border border-border/40 hover:border-border px-2 py-1 rounded transition-colors"
              title="Open full view"
            >
              <Maximize2 className="h-3 w-3" />
              Full view
            </button>
          </div>
          <div className="grid grid-cols-2 gap-5">
            {/* Left: summary + fields */}
            <div className="space-y-3">
              {log.callSummary && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-green-400 mb-1">AI Summary</div>
                  <div className="text-sm text-foreground leading-relaxed">{log.callSummary}</div>
                </div>
              )}
              {(log.propertyType || log.askingPrice || log.timeline) && (
                <div className="grid grid-cols-3 gap-3">
                  {log.propertyType && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Property</div>
                      <div className="text-sm font-medium capitalize">{log.propertyType}</div>
                    </div>
                  )}
                  {log.askingPrice && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Price</div>
                      <div className="text-sm font-semibold text-green-400">{log.askingPrice}</div>
                    </div>
                  )}
                  {log.timeline && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Timeline</div>
                      <div className="text-sm font-medium">{log.timeline}</div>
                    </div>
                  )}
                </div>
              )}
              {log.additionalNotes && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-0.5">Notes</div>
                  <div className="text-xs text-muted-foreground">{log.additionalNotes}</div>
                </div>
              )}
            </div>

            {/* Right: transcript */}
            {log.transcription && (
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Transcript</div>
                <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-52 overflow-y-auto scrollbar-thin">{log.transcription}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Full-view modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-5 pb-4 border-b border-border/40 flex-shrink-0">
            <DialogTitle className="flex items-center gap-3 text-base">
              {outcomeBadge(log.interestedInSelling, log.callStatus, log.callOutcome)}
              <span className="text-muted-foreground font-normal text-sm">{formatDuration(log.callDuration)}</span>
              <span className="text-muted-foreground font-normal text-sm ml-auto">{formatDateTime(log.calledAt)}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Summary */}
            {log.callSummary && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-green-400">AI Summary</div>
                  <button
                    onClick={() => copyText(log.callSummary!, "summary")}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "summary" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "summary" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="text-base text-foreground leading-relaxed">{log.callSummary}</div>
              </div>
            )}

            {/* Fields row */}
            {(log.propertyType || log.askingPrice || log.timeline || log.additionalNotes) && (
              <div className="grid grid-cols-4 gap-4 p-4 rounded-lg bg-white/5 border border-border/30">
                {log.propertyType && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Property</div>
                    <div className="text-sm font-medium capitalize">{log.propertyType}</div>
                  </div>
                )}
                {log.askingPrice && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Price</div>
                    <div className="text-sm font-semibold text-green-400">{log.askingPrice}</div>
                  </div>
                )}
                {log.timeline && (
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Timeline</div>
                    <div className="text-sm font-medium">{log.timeline}</div>
                  </div>
                )}
                {log.additionalNotes && (
                  <div className="col-span-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Notes</div>
                    <div className="text-sm text-muted-foreground">{log.additionalNotes}</div>
                  </div>
                )}
              </div>
            )}

            {/* Transcript */}
            {log.transcription && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Transcript</div>
                  <button
                    onClick={() => copyText(log.transcription!, "transcript")}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copied === "transcript" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === "transcript" ? "Copied" : "Copy"}
                  </button>
                </div>
                <div
                  className="text-sm text-muted-foreground whitespace-pre-wrap leading-7 p-4 rounded-lg bg-black/20 border border-border/20"
                  dir="auto"
                >
                  {log.transcription}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getMonthDays(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const days: (Date | null)[] = [];
  for (let i = 0; i < first.getDay(); i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) days.push(new Date(year, month, d));
  return days;
}
const TIME_SLOTS = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21];
function fmtHour(h: number) { return h === 12 ? "12 PM" : h > 12 ? `${h-12} PM` : `${h} AM`; }

function fmtSlotTime(t: string) {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${mStr} ${ampm}`;
}
const DAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function fmtSlot(slot: ScheduleSlot) {
  const days = slot.days.map(d => DAY_SHORT[d]).join("/");
  return `${days} ${fmtSlotTime(slot.startTime)}–${fmtSlotTime(slot.endTime)}`;
}

function ContactRow({ contact, campaignId, campaignHasSchedule, campaignScheduleSlots, onRefresh }: { contact: CampaignContact; campaignId: number; campaignHasSchedule: boolean; campaignScheduleSlots: ScheduleSlot[]; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [notesDraft, setNotesDraft] = useState(contact.userNotes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  const [notesEditing, setNotesEditing] = useState(false);
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Schedule picker state
  const [showSchedPicker, setShowSchedPicker] = useState(false);
  const initSched = contact.scheduledCallAt ? new Date(contact.scheduledCallAt) : null;
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const d = initSched ?? new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pickedDay, setPickedDay] = useState<Date | null>(
    initSched ? new Date(initSched.getFullYear(), initSched.getMonth(), initSched.getDate()) : null
  );
  const [pickedHour, setPickedHour] = useState<number | null>(initSched ? initSched.getHours() : null);
  const { toast } = useToast();
  const qc = useQueryClient();

  async function saveNotes(value: string) {
    try {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userNotes: value || null }),
      });
      if (!r.ok) throw new Error("Failed");
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    } catch {
      toast({ title: "Failed to save notes", variant: "destructive" });
    }
  }

  function handleNotesChange(val: string) {
    setNotesDraft(val);
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => saveNotes(val), 1200);
  }

  const { data: callLogs = [], isLoading: logsLoading } = useQuery<CampaignCallLog[]>({
    queryKey: ["call-logs", contact.id],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts/${contact.id}/call-logs`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    enabled: expanded,
    staleTime: 0,
  });


  const callMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts/${contact.id}/call`, { method: "POST" });
      if (!r.ok) throw new Error("Failed to call");
    },
    onSuccess: () => {
      onRefresh();
      qc.invalidateQueries({ queryKey: ["call-logs", contact.id] });
      toast({ title: `Calling ${contact.name}...` });
    },
    onError: () => toast({ title: "Failed to initiate call", variant: "destructive" }),
  });

  const patchContactMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts/${contact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
    },
    onError: () => toast({ title: "Failed to update contact", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts/${contact.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      qc.invalidateQueries({ queryKey: ["call-logs", contact.id] });
    },
    onError: () => toast({ title: "Failed to delete contact", variant: "destructive" }),
  });

  const attemptCount = contact.attemptCount ?? 0;
  const isHot = contact.interestedInSelling === true;
  const isSkipped = contact.callStatus === "skipped";
  const lastAttempt = contact.lastAttemptAt ? formatDateTime(contact.lastAttemptAt) : null;

  return (
    <>
      {/* Contact row */}
      <tr
        className={`border-b border-border/40 transition-colors cursor-pointer ${
          isHot ? "bg-green-500/5 hover:bg-green-500/10" : "hover:bg-secondary/20"
        }`}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Expand chevron */}
        <td className="px-3 py-3 w-7 text-center">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </td>

        {/* Name + address */}
        <td className="px-3 py-3">
          <div className={`font-semibold text-sm ${isHot ? "text-green-400" : "text-foreground"}`}>{contact.name}</div>
          {contact.address && <div className="text-[11px] text-muted-foreground mt-0.5">{contact.address}</div>}
        </td>

        {/* Phone */}
        <td className="px-3 py-3 font-mono text-sm text-muted-foreground whitespace-nowrap">{contact.phone}</td>

        {/* Outcome */}
        <td className="px-3 py-3">
          <div className="flex items-center gap-1.5">
            {statusIcon(contact.callStatus)}
            {outcomeBadge(contact.interestedInSelling, contact.callStatus, contact.callOutcome, contact.attemptCount ?? 0)}
          </div>
        </td>

        {/* Duration of last call */}
        <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
          {formatDuration(contact.callDuration)}
        </td>

        {/* Last called + scheduled */}
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          <div className="flex flex-col gap-0.5">
            {lastAttempt
              ? <span>{lastAttempt}</span>
              : <span className="text-muted-foreground/50">Never</span>}
            {contact.scheduledCallAt
              ? <span className="text-blue-400 font-medium">{formatDateTime(contact.scheduledCallAt)}</span>
              : campaignHasSchedule && campaignScheduleSlots.length > 0 && (
                <span className="text-blue-400/70 font-medium">
                  {campaignScheduleSlots.map(fmtSlot).join(", ")}
                </span>
              )}
          </div>
        </td>

        {/* Attempts */}
        <td className="px-3 py-3 text-center">
          {attemptCount > 0 ? (
            <span className="inline-flex items-center justify-center text-xs font-semibold bg-secondary/60 border border-border/50 rounded-full px-2 py-0.5 min-w-[28px]">
              {attemptCount}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground/40">—</span>
          )}
        </td>

        {/* Actions */}
        <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1 justify-end">
            {/* Schedule picker — opens calendar + time slot popover */}
            <Popover open={showSchedPicker} onOpenChange={setShowSchedPicker}>
              <PopoverTrigger asChild>
                <Button
                  size="sm" variant="ghost"
                  className={`h-7 w-7 px-0 transition-colors ${
                    isSkipped
                      ? "text-muted-foreground/40 hover:text-muted-foreground"
                      : contact.scheduledCallAt
                        ? "text-blue-400 hover:text-blue-300"
                        : campaignHasSchedule
                          ? "text-blue-400/60 hover:text-blue-300"
                          : "text-muted-foreground hover:text-green-400"
                  }`}
                  title={
                    isSkipped ? "Excluded from campaign — click to schedule"
                    : contact.scheduledCallAt ? `Scheduled: ${formatDateTime(contact.scheduledCallAt)}`
                    : "Schedule specific call time"
                  }
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3 space-y-2" align="end" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Schedule call for</div>

                {/* Selected preview */}
                {pickedDay && pickedHour !== null ? (
                  <div className="text-xs text-green-400 font-semibold bg-green-500/10 rounded px-2 py-1">
                    {pickedDay.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    {" · "}
                    {fmtHour(pickedHour)}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground/60 italic">Pick a date and time below</div>
                )}

                {/* Month navigation */}
                <div className="flex items-center justify-between">
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="text-xs font-semibold">
                    {calMonth.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                  </span>
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Day grid */}
                <div className="grid grid-cols-7 gap-0.5">
                  {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
                    <div key={d} className="text-[9px] text-center text-muted-foreground font-semibold py-0.5">{d}</div>
                  ))}
                  {getMonthDays(calMonth.getFullYear(), calMonth.getMonth()).map((day, i) => {
                    if (!day) return <div key={i} />;
                    const isToday = day.toDateString() === new Date().toDateString();
                    const isPicked = pickedDay?.toDateString() === day.toDateString();
                    const isPast = day < new Date(new Date().setHours(0,0,0,0));
                    return (
                      <button
                        key={i}
                        disabled={isPast}
                        onClick={() => setPickedDay(day)}
                        className={`text-[11px] rounded py-0.5 text-center transition-colors font-medium ${
                          isPicked
                            ? "bg-green-500 text-white"
                            : isToday
                              ? "border border-green-500/50 text-green-400"
                              : isPast
                                ? "text-muted-foreground/30 cursor-not-allowed"
                                : "text-foreground hover:bg-secondary/70"
                        }`}
                      >
                        {day.getDate()}
                      </button>
                    );
                  })}
                </div>

                {/* Time slots */}
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground pt-1">Time</div>
                <div className="grid grid-cols-3 gap-1">
                  {TIME_SLOTS.map(h => (
                    <button
                      key={h}
                      onClick={() => setPickedHour(h)}
                      className={`text-[11px] px-1.5 py-1 rounded text-center transition-colors font-medium ${
                        pickedHour === h
                          ? "bg-green-500 text-white"
                          : "text-foreground hover:bg-secondary/70 border border-border/50"
                      }`}
                    >
                      {fmtHour(h)}
                    </button>
                  ))}
                </div>

                {/* Footer buttons */}
                <div className="flex gap-1.5 pt-2 border-t border-border">
                  <Button
                    size="sm" className="h-7 flex-1 text-xs"
                    disabled={!pickedDay || pickedHour === null || patchContactMutation.isPending}
                    onClick={() => {
                      if (!pickedDay || pickedHour === null) return;
                      const dt = new Date(pickedDay);
                      dt.setHours(pickedHour, 0, 0, 0);
                      patchContactMutation.mutate({ scheduledCallAt: dt.toISOString(), callStatus: "pending" });
                      setShowSchedPicker(false);
                    }}
                  >Set</Button>
                  {contact.scheduledCallAt && (
                    <Button
                      size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => {
                        setPickedDay(null); setPickedHour(null);
                        patchContactMutation.mutate({ scheduledCallAt: null });
                        setShowSchedPicker(false);
                      }}
                    >Clear</Button>
                  )}
                  <Button
                    size="sm" variant="ghost"
                    className={`h-7 text-xs px-2 ${isSkipped ? "text-green-400 hover:text-green-300" : "text-muted-foreground hover:text-yellow-400"}`}
                    disabled={contact.callStatus === "calling" || contact.callStatus === "in_progress"}
                    onClick={() => {
                      patchContactMutation.mutate({ callStatus: isSkipped ? "pending" : "skipped" });
                      setShowSchedPicker(false);
                    }}
                  >
                    {isSkipped ? "Include" : "Exclude"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
            {!isSkipped && contact.callStatus !== "calling" && contact.callStatus !== "in_progress" && (
              <Button
                size="sm" variant="ghost"
                className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground"
                title="Call now"
                onClick={() => callMutation.mutate()}
                disabled={callMutation.isPending}
              >
                <Phone className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive"
              onClick={() => { if (confirm(`Delete ${contact.name}? This will remove the contact and all call history.`)) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      {/* Expanded: notes + call history */}
      {expanded && (
        <tr className="border-b border-border/40">
          <td colSpan={8} className="px-6 py-4 bg-secondary/10">
            <div className="space-y-4">
              {/* Notes section */}
              <div onClick={e => e.stopPropagation()}>
                {notesEditing ? (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Notes</span>
                      {notesSaved && <span className="text-[10px] text-green-400 tracking-wider">Saved</span>}
                    </div>
                    <Textarea
                      value={notesDraft}
                      onChange={e => handleNotesChange(e.target.value)}
                      onBlur={() => {
                        if (notesTimerRef.current) { clearTimeout(notesTimerRef.current); notesTimerRef.current = null; }
                        saveNotes(notesDraft);
                        setNotesEditing(false);
                      }}
                      placeholder="Add notes about this contact..."
                      rows={3}
                      autoFocus
                      className="text-sm bg-background/60 border-border/50 resize-none w-full"
                    />
                  </div>
                ) : notesDraft ? (
                  <div
                    className="flex items-start gap-2 cursor-pointer group/note"
                    onClick={() => setNotesEditing(true)}
                    title="Click to edit note"
                  >
                    <FileText className="h-3 w-3 text-amber-400 mt-0.5 shrink-0" />
                    <span className="text-xs text-muted-foreground leading-relaxed group-hover/note:text-foreground transition-colors">{notesDraft}</span>
                  </div>
                ) : (
                  <button
                    onClick={() => setNotesEditing(true)}
                    className="flex items-center gap-1.5 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    title="Add note"
                  >
                    <FileText className="h-3 w-3" />
                    <span className="text-[10px] uppercase tracking-wider">Add note</span>
                  </button>
                )}
              </div>

              {/* Call history */}
              {logsLoading ? (
                <div className="text-xs text-muted-foreground py-2">Loading call history...</div>
              ) : callLogs.length === 0 ? (
                <div className="text-xs text-muted-foreground italic">No calls made yet for this contact.</div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Mic className="h-3 w-3 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Call History — {callLogs.length} {callLogs.length === 1 ? "attempt" : "attempts"}
                    </span>
                  </div>
                  {callLogs.map(log => (
                    <CallLogEntry key={log.id} log={log} campaignId={campaignId} onDeleted={() => qc.invalidateQueries({ queryKey: ["call-logs", contact.id] })} />
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Schedule types & helpers ─────────────────────────────────────────────────
interface ScheduleSlot { days: number[]; startTime: string; endTime: string; }
interface ScheduleConfig { enabled: boolean; timezone: string; slots: ScheduleSlot[]; }

const TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Denver", label: "Mountain (MT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "America/Toronto", label: "Toronto (ET)" },
  { value: "America/Vancouver", label: "Vancouver (PT)" },
  { value: "Europe/London", label: "London (GMT)" },
  { value: "Europe/Paris", label: "Paris (CET)" },
  { value: "Europe/Berlin", label: "Berlin (CET)" },
  { value: "Asia/Dubai", label: "Dubai (GST)" },
  { value: "Asia/Riyadh", label: "Riyadh (AST)" },
  { value: "Asia/Beirut", label: "Beirut (EET)" },
  { value: "Australia/Sydney", label: "Sydney (AEDT)" },
];

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function parseSchedule(raw: string | null | undefined): ScheduleConfig {
  try {
    const p = JSON.parse(raw ?? "{}");
    return {
      enabled: p.enabled ?? false,
      timezone: p.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      slots: Array.isArray(p.slots) ? p.slots : [],
    };
  } catch {
    return { enabled: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, slots: [] };
  }
}

function ScheduleEditor({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) {
  const cfg = parseSchedule(value);

  function update(next: ScheduleConfig) { onChange(JSON.stringify(next)); }

  return (
    <div className="border border-border/50 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 bg-secondary/20">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-blue-400" />
          <span className="text-sm font-semibold">Auto-Schedule</span>
          <span className="text-xs text-muted-foreground">(starts campaign automatically)</span>
        </div>
        <button
          type="button"
          aria-label="Toggle schedule"
          className={`relative inline-flex h-5 w-9 flex-shrink-0 rounded-full transition-colors ${cfg.enabled ? "bg-green-500" : "bg-secondary border border-border"}`}
          onClick={() => update({ ...cfg, enabled: !cfg.enabled })}
        >
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${cfg.enabled ? "translate-x-4" : "translate-x-0.5"}`} />
        </button>
      </div>

      {cfg.enabled && (
        <div className="p-3 space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Timezone</Label>
            <select
              className="mt-1 flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={cfg.timezone}
              onChange={e => update({ ...cfg, timezone: e.target.value })}
            >
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wide">Time Slots</Label>
            {cfg.slots.length === 0 && (
              <p className="text-xs text-muted-foreground/60 italic py-1">No slots configured — campaign won't auto-run. Add a slot below.</p>
            )}
            {cfg.slots.map((slot, i) => (
              <div key={i} className="border border-border/50 rounded-md p-2.5 space-y-2 bg-background/40">
                <div className="flex items-center gap-1">
                  {DAY_LABELS.map((day, d) => (
                    <button
                      key={d}
                      type="button"
                      title={["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]}
                      className={`h-6 w-6 rounded text-[10px] font-bold transition-colors ${slot.days.includes(d) ? "bg-green-500/20 text-green-400 border border-green-500/40" : "bg-secondary text-muted-foreground border border-transparent hover:border-border"}`}
                      onClick={() => {
                        const newDays = slot.days.includes(d) ? slot.days.filter(x => x !== d) : [...slot.days, d].sort((a, b) => a - b);
                        const newSlots = cfg.slots.map((s, j) => j === i ? { ...s, days: newDays } : s);
                        update({ ...cfg, slots: newSlots });
                      }}
                    >
                      {day}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="ml-auto text-muted-foreground/40 hover:text-red-400 transition-colors"
                    onClick={() => update({ ...cfg, slots: cfg.slots.filter((_, j) => j !== i) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Start</label>
                    <input
                      type="time"
                      value={slot.startTime}
                      className="mt-0.5 flex h-7 w-full rounded border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      onChange={e => {
                        const newSlots = cfg.slots.map((s, j) => j === i ? { ...s, startTime: e.target.value } : s);
                        update({ ...cfg, slots: newSlots });
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground text-sm mt-4">–</span>
                  <div className="flex-1">
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">End</label>
                    <input
                      type="time"
                      value={slot.endTime}
                      className="mt-0.5 flex h-7 w-full rounded border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      onChange={e => {
                        const newSlots = cfg.slots.map((s, j) => j === i ? { ...s, endTime: e.target.value } : s);
                        update({ ...cfg, slots: newSlots });
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
            <button
              type="button"
              className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors mt-1"
              onClick={() => update({ ...cfg, slots: [...cfg.slots, { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" }] })}
            >
              <Plus className="h-3 w-3" />
              Add Time Slot
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = parseInt(id, 10);
  const [, navigate] = useLocation();
  const scopedCompanyId = new URLSearchParams(window.location.search).get("companyId");
  const scopedCompanyIdNum = scopedCompanyId ? parseInt(scopedCompanyId, 10) : null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAddContact, setShowAddContact] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<number>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showTestCall, setShowTestCall] = useState(false);
  const [testCallNumber, setTestCallNumber] = useState("");
  const [newContact, setNewContact] = useState({ name: "", phone: "", address: "" });
  const [importText, setImportText] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "interested" | "no_answer" | "skipped">("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: companies = [] } = useListCompanies();
  const scopedCompany = scopedCompanyIdNum ? companies.find((c: any) => c.id === scopedCompanyIdNum) : null;

  const { data: campaign, isLoading: campLoading } = useQuery<Campaign>({
    queryKey: ["campaign", campaignId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    refetchInterval: 5000,
  });

  const { data: contacts = [], isLoading: contactsLoading } = useQuery<CampaignContact[]>({
    queryKey: ["campaign-contacts", campaignId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 5000,
  });

  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["phone-numbers"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/phone-numbers`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  // CRM contact library — for "From Library" picker
  const { data: libraryContacts = [] } = useListContacts(
    showLibrary ? { search: librarySearch || undefined } : undefined
  );

  const [settingsForm, setSettingsForm] = useState<Partial<Campaign>>({});
  const [editingScript, setEditingScript] = useState(false);
  const [scriptDraft, setScriptDraft] = useState("");

  const statusMutation = useMutation({
    mutationFn: async (action: "start" | "pause") => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`Failed to ${action}`);
      return r.json();
    },
    onSuccess: (data, action) => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      if (action === "start") toast({ title: `Campaign started — ${data.queued} contacts queued for calling` });
      else toast({ title: "Campaign paused" });
    },
    onError: (_, action) => toast({ title: `Failed to ${action} campaign`, variant: "destructive" }),
  });

  const retryNoAnswerMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/retry-no-answer`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      return data as { queued: number; reset: number };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast({ title: `Retrying ${data.reset} no-answer contacts — ${data.queued} calls queued` });
    },
    onError: (err: Error) => toast({ title: `Failed: ${err.message}`, variant: "destructive" }),
  });

  const testCallMutation = useMutation({
    mutationFn: async (toNumber: string) => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/test-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toNumber }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Failed");
      return data as { callSid: string };
    },
    onSuccess: () => {
      toast({ title: "Test call initiated — your phone should ring shortly" });
      setShowTestCall(false);
    },
    onError: (err: Error) => toast({ title: `Test call failed: ${err.message}`, variant: "destructive" }),
  });

  const addContactMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newContact.name, phone: newContact.phone, address: newContact.address || null }),
      });
      if (!r.ok) throw new Error("Failed");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      setShowAddContact(false);
      setNewContact({ name: "", phone: "", address: "" });
      toast({ title: "Contact added" });
    },
    onError: () => toast({ title: "Failed to add contact", variant: "destructive" }),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}/contacts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: importText }),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json() as Promise<{ imported: number; skipped: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      setShowImport(false);
      toast({ title: `Imported ${data.imported} contacts${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}` });
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  const updateCampaignMutation = useMutation({
    mutationFn: async (data: Partial<Campaign>) => {
      const r = await fetch(`${BASE}/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setShowSettings(false);
      toast({ title: "Campaign updated" });
    },
    onError: () => toast({ title: "Failed to update campaign", variant: "destructive" }),
  });

  const refreshContacts = () => {
    qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
    qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
  };

  const filteredContacts = contacts.filter(c => {
    const matchSearch = !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm) || (c.address ?? "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchFilter =
      filter === "all" ? true :
      filter === "pending" ? c.callStatus === "pending" :
      filter === "completed" ? c.callStatus === "completed" :
      filter === "interested" ? c.interestedInSelling === true :
      filter === "no_answer" ? c.callStatus === "no_answer" :
      filter === "skipped" ? c.callStatus === "skipped" : true;
    return matchSearch && matchFilter;
  });

  if (campLoading) return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>;
  if (!campaign) return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Campaign not found.</div>;

  const canStart = campaign.status !== "active" && campaign.status !== "completed" && (campaign.totalContacts ?? 0) > 0 && !!campaign.fromPhoneNumberId;
  const scriptFullText = campaign.systemPrompt?.trim() || campaign.script || "";
  const scriptFirstLine = scriptFullText.split("\n")[0] ?? "";
  const scriptHasMore = scriptFullText.length > scriptFirstLine.length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0 mt-0.5" onClick={() => navigate(scopedCompanyId ? `/campaigns?companyId=${scopedCompanyId}` : "/campaigns")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            {scopedCompanyId && (
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground mb-0.5">
                <Building2 className="h-3 w-3" />
                <span>Company</span>
                <ChevronRight className="h-3 w-3" />
                <span>Campaigns</span>
                <ChevronRight className="h-3 w-3" />
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-green-400">{campaign.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                campaign.status === "active" ? "bg-green-500/15 text-green-400 border border-green-500/20" :
                campaign.status === "paused" ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20" :
                campaign.status === "completed" ? "bg-blue-500/15 text-blue-400 border border-blue-500/20" :
                "bg-muted text-muted-foreground"
              }`}>{campaign.status}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {campaign.fromPhoneNumberId
                ? `Calling from ${phoneNumbers.find(p => p.id === campaign.fromPhoneNumberId)?.number ?? "—"}`
                : "No phone number configured"}
              {campaign.notificationEmail && <span> · Alerts to {campaign.notificationEmail}</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => { setSettingsForm({ name: campaign.name, script: campaign.script, systemPrompt: campaign.systemPrompt, fromPhoneNumberId: campaign.fromPhoneNumberId, notificationEmail: campaign.notificationEmail, maxCallDuration: campaign.maxCallDuration, maxConcurrentCalls: campaign.maxConcurrentCalls, scheduleConfig: campaign.scheduleConfig }); setShowSettings(true); }}>
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 w-8 px-0 ${parseSchedule(campaign.scheduleConfig).enabled ? "text-blue-400" : ""}`}
            title="Schedule"
            onClick={() => setShowSchedule(true)}
          >
            <CalendarClock className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3" title="Test Call" onClick={() => setShowTestCall(true)}>
            <Phone className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-3" onClick={refreshContacts}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {campaign.status === "active" ? (
            <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => statusMutation.mutate("pause")} disabled={statusMutation.isPending}>
              <Pause className="h-3.5 w-3.5" />
              Pause Campaign
            </Button>
          ) : (
            <Button size="sm" className="h-8 gap-1.5" onClick={() => statusMutation.mutate("start")} disabled={!canStart || statusMutation.isPending} title={!campaign.fromPhoneNumberId ? "Configure a phone number first" : !campaign.totalContacts ? "Add contacts first" : ""}>
              <Play className="h-3.5 w-3.5" />
              {campaign.status === "paused" ? "Resume" : "Start Dialing"}
            </Button>
          )}
          {(() => {
            const noAnswerCount = contacts.filter(c => c.callOutcome === "no_answer").length;
            if (noAnswerCount === 0) return null;
            return (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-orange-500/30 text-orange-400 hover:bg-orange-500/10 hover:text-orange-300"
                onClick={() => retryNoAnswerMutation.mutate()}
                disabled={retryNoAnswerMutation.isPending || campaign.status === "active"}
                title={campaign.status === "active" ? "Pause campaign first" : `Re-call ${noAnswerCount} no-answer contacts`}
              >
                <Phone className="h-3.5 w-3.5" />
                Retry No Answer ({noAnswerCount})
              </Button>
            );
          })()}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: "Total", value: campaign.totalContacts ?? 0, color: "" },
          { label: "Pending", value: campaign.pendingContacts ?? 0, color: "" },
          { label: "Completed", value: campaign.completedContacts ?? 0, color: "" },
          { label: "Hot Leads", value: campaign.interestedContacts ?? 0, color: "text-green-400" },
          { label: "No Answer", value: contacts.filter(c => c.callStatus === "no_answer").length, color: "" },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-card border border-border rounded-lg px-3 py-2.5 text-center">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{label}</div>
            <div className={`text-2xl font-bold tabular-nums ${color || "text-foreground"}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* AI Script & Instructions — inline editable */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Bot className="h-3.5 w-3.5 text-primary" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">AI Script &amp; Instructions</span>
          <span className="ml-auto flex items-center gap-1">
            {editingScript ? (
              <>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" onClick={() => setEditingScript(false)}>
                  <X className="h-3 w-3 mr-1" />Cancel
                </Button>
                <Button size="sm" className="h-6 px-2 text-xs" onClick={async () => {
                  await fetch(`${BASE}/api/campaigns/${campaignId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ script: scriptDraft, systemPrompt: null }),
                  });
                  qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
                  setEditingScript(false);
                  toast({ title: "Script saved" });
                }}>
                  <Check className="h-3 w-3 mr-1" />Save
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => {
                setScriptDraft(campaign.systemPrompt?.trim() || campaign.script || "");
                setEditingScript(true);
              }}>
                <Pencil className="h-3 w-3 mr-1" />Edit
              </Button>
            )}
          </span>
        </div>
        {editingScript ? (
          <Textarea
            autoFocus
            className="min-h-[140px] bg-background font-mono text-sm"
            placeholder="Describe how the AI should behave on this call — who it is, what to say, the goal, the tone, the language. The AI will read these as instructions, not as a script to recite."
            value={scriptDraft}
            onChange={e => setScriptDraft(e.target.value)}
          />
        ) : (
          <div
            className="text-sm text-foreground cursor-pointer hover:opacity-80 transition-opacity flex items-baseline gap-2 min-w-0"
            onClick={() => {
              setScriptDraft(scriptFullText);
              setEditingScript(true);
            }}
          >
            {scriptFullText ? (
              <>
                <span className="truncate">{scriptFirstLine}</span>
                {scriptHasMore && <span className="text-[10px] text-muted-foreground flex-shrink-0">click to expand</span>}
              </>
            ) : (
              <span className="text-muted-foreground italic">No AI script configured. Click Edit to add instructions for the AI agent on this campaign.</span>
            )}
          </div>
        )}
        {!editingScript && (
          <p className="text-[10px] text-muted-foreground mt-2">The AI uses these as behavioral instructions — it will never read them word-for-word.</p>
        )}
      </div>

      {/* Contacts table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/10">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Search contacts..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="h-7 w-48 text-xs"
            />
            <div className="flex gap-1">
              {(["all", "pending", "interested", "completed", "no_answer", "skipped"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                    filter === f
                      ? f === "interested" ? "bg-green-500/15 text-green-400 border border-green-500/20"
                      : f === "skipped" ? "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20"
                      : "bg-primary/15 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {f === "all" ? "All" : f === "no_answer" ? "No Answer" : f === "interested" ? "Hot Leads" : f === "skipped" ? "Skipped" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={() => { setShowLibrary(true); setSelectedLibraryIds(new Set()); }}>
              <Users2 className="h-3 w-3" />
              From Library
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={() => setShowImport(true)}>
              <Upload className="h-3 w-3" />
              Bulk Import
            </Button>
            <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={() => setShowAddContact(true)}>
              <Plus className="h-3 w-3" />
              Add Contact
            </Button>
          </div>
        </div>

        {contactsLoading ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Loading contacts...</div>
        ) : filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <div className="text-sm">{contacts.length === 0 ? "No contacts yet. Add contacts or bulk import to start." : "No contacts match the current filter."}</div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/20">
                <th className="w-7 px-3" />
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Name</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Phone</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Outcome</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Duration</th>
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Last Called / Scheduled</th>
                <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Calls</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.map((c) => (
                <ContactRow key={c.id} contact={c} campaignId={campaignId} campaignHasSchedule={parseSchedule(campaign.scheduleConfig).enabled} campaignScheduleSlots={parseSchedule(campaign.scheduleConfig).slots} onRefresh={refreshContacts} />
              ))}
            </tbody>
          </table>
        )}

        {filteredContacts.length > 0 && (
          <div className="px-4 py-2 border-t border-border/50 text-xs text-muted-foreground bg-secondary/5">
            {filteredContacts.length} contact{filteredContacts.length !== 1 ? "s" : ""} shown
            {searchTerm || filter !== "all" ? ` (filtered from ${contacts.length} total)` : ""}
          </div>
        )}
      </div>

      {/* Add Contact Dialog */}
      {/* Test Call Dialog */}
      <Dialog open={showTestCall} onOpenChange={setShowTestCall}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Test Call</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Calls your phone right now using this campaign's AI script — ignores the campaign schedule. Nothing is recorded in the contact list.</p>
            <div>
              <Label className="text-green-400">Phone Number to Call</Label>
              <Input
                className="mt-1 font-mono"
                value={testCallNumber}
                onChange={e => setTestCallNumber(e.target.value)}
                placeholder="+15190000000"
                onKeyDown={e => { if (e.key === "Enter" && testCallNumber) testCallMutation.mutate(testCallNumber); }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <Button variant="outline" onClick={() => setShowTestCall(false)}>Cancel</Button>
              <Button
                onClick={() => testCallMutation.mutate(testCallNumber)}
                disabled={!testCallNumber || testCallMutation.isPending}
                className="gap-1.5"
              >
                <Phone className="h-3.5 w-3.5" />
                {testCallMutation.isPending ? "Calling..." : "Call Now"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showAddContact} onOpenChange={setShowAddContact}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label className="text-green-400">Name</Label><Input className="mt-1" value={newContact.name} onChange={e => setNewContact(f => ({ ...f, name: e.target.value }))} placeholder="Ahmed Al-Sayed" /></div>
            <div><Label className="text-green-400">Phone</Label><Input className="mt-1" value={newContact.phone} onChange={e => setNewContact(f => ({ ...f, phone: e.target.value }))} placeholder="+1-555-000-0000" /></div>
            <div><Label className="text-green-400">Address <span className="text-muted-foreground font-normal">(optional)</span></Label><Input className="mt-1" value={newContact.address} onChange={e => setNewContact(f => ({ ...f, address: e.target.value }))} placeholder="123 Main St, Toronto ON" /></div>
            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <Button variant="outline" onClick={() => setShowAddContact(false)}>Cancel</Button>
              <Button onClick={() => addContactMutation.mutate()} disabled={!newContact.name || !newContact.phone || addContactMutation.isPending}>
                {addContactMutation.isPending ? "Adding..." : "Add Contact"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* From Library Dialog */}
      <Dialog open={showLibrary} onOpenChange={v => { setShowLibrary(v); if (!v) { setLibrarySearch(""); setSelectedLibraryIds(new Set()); } }}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col gap-0 p-0">
          <div className="px-6 py-4 border-b border-border flex-shrink-0">
            <DialogTitle>Add from Contact Library</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">Select CRM contacts to add to this campaign.</p>
          </div>
          <div className="px-4 py-3 border-b border-border flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                className="w-full h-8 pl-8 pr-3 text-sm bg-background border border-border rounded-md outline-none focus:border-primary transition-colors"
                placeholder="Search contacts..."
                value={librarySearch}
                onChange={e => setLibrarySearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {libraryContacts.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
                {librarySearch ? "No contacts match your search." : "No contacts in library."}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary/20 sticky top-0">
                  <tr>
                    <th className="w-10 px-4 py-2" />
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                    <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Company</th>
                  </tr>
                </thead>
                <tbody>
                  {libraryContacts.map(c => (
                    <tr
                      key={c.id}
                      className="border-t border-border/50 cursor-pointer hover:bg-secondary/20 transition-colors"
                      onClick={() => setSelectedLibraryIds(prev => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id); else next.add(c.id);
                        return next;
                      })}
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          readOnly
                          checked={selectedLibraryIds.has(c.id)}
                          className="accent-primary h-3.5 w-3.5"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium">{c.firstName} {c.lastName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{c.phone ?? "--"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{c.companyName ?? "--"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="px-6 py-4 border-t border-border flex-shrink-0 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {selectedLibraryIds.size > 0 ? `${selectedLibraryIds.size} selected` : "None selected"}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowLibrary(false)}>Cancel</Button>
              <Button
                size="sm"
                disabled={selectedLibraryIds.size === 0}
                onClick={async () => {
                  const selected = libraryContacts.filter(c => selectedLibraryIds.has(c.id));
                  let added = 0;
                  for (const c of selected) {
                    if (!c.phone) continue;
                    try {
                      await fetch(`${BASE}/api/campaigns/${campaignId}/contacts`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: `${c.firstName} ${c.lastName}`, phone: c.phone }),
                      });
                      added++;
                    } catch {}
                  }
                  qc.invalidateQueries({ queryKey: ["campaign-contacts", campaignId] });
                  qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
                  setShowLibrary(false);
                  setSelectedLibraryIds(new Set());
                  toast({ title: `Added ${added} contact${added !== 1 ? "s" : ""} from library` });
                }}
              >
                Add {selectedLibraryIds.size > 0 ? selectedLibraryIds.size : ""} Contact{selectedLibraryIds.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Bulk Import Contacts</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Paste numbers one per line, or all on one line separated by commas. Mix with named contacts.</p>
            <div className="bg-secondary/30 rounded p-2 text-xs text-muted-foreground font-mono space-y-0.5">
              <div className="text-foreground/60">— one per line —</div>
              <div>2263473180</div>
              <div>5199927726</div>
              <div className="mt-1 text-foreground/60">— or all on one line —</div>
              <div>2263473180, 5199927726, 5199916667</div>
              <div className="mt-1 text-foreground/60">— or with names —</div>
              <div>Ahmed Al-Sayed, +15550002222, 123 King St</div>
            </div>
            <Textarea
              className="min-h-[200px] font-mono text-xs"
              placeholder="Ahmed Al-Sayed, +15550001111, 123 King St&#10;Sara Mohammed, +15550002222&#10;..."
              value={importText}
              onChange={e => setImportText(e.target.value)}
            />
            <div className="flex justify-end gap-2 pt-1 border-t border-border">
              <Button variant="outline" onClick={() => setShowImport(false)}>Cancel</Button>
              <Button onClick={() => importMutation.mutate()} disabled={!importText.trim() || importMutation.isPending}>
                {importMutation.isPending ? "Importing..." : "Import"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Settings Dialog */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Campaign Settings</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div><Label className="text-green-400">Campaign Name</Label><Input className="mt-1" value={settingsForm.name ?? ""} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))} /></div>

            <div>
              <Label className="text-green-400">AI Script &amp; Instructions</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1">Tell the AI who it is, what to say, the goal, tone, and language. These are instructions — the AI will never read them word-for-word.</p>
              <Textarea
                className="mt-1 min-h-[140px] font-mono text-sm"
                placeholder="e.g. You are Sarah from Acme Corp. Call clients in Arabic and wish them a happy Father's Day in a warm, natural way. Keep responses to 1-2 sentences. Do not sound scripted."
                value={settingsForm.script ?? settingsForm.systemPrompt ?? ""}
                onChange={e => setSettingsForm(f => ({ ...f, script: e.target.value, systemPrompt: null }))}
              />
            </div>
            <div>
              <Label className="text-green-400">From Phone Number</Label>
              <select
                className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={settingsForm.fromPhoneNumberId ?? ""}
                onChange={e => setSettingsForm(f => ({ ...f, fromPhoneNumberId: e.target.value ? parseInt(e.target.value, 10) : null }))}
              >
                <option value="">Select a number...</option>
                {phoneNumbers.map((p: PhoneNumber) => (
                  <option key={p.id} value={p.id}>{p.friendlyName ?? p.number} — {p.number}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-green-400">Max Call Duration (sec)</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-1">Max seconds per call before AI hangs up</p>
                <Input className="mt-1" type="number" min="60" max="600" value={settingsForm.maxCallDuration ?? 300} onChange={e => setSettingsForm(f => ({ ...f, maxCallDuration: parseInt(e.target.value, 10) }))} />
              </div>
              <div>
                <Label className="text-green-400">Max Concurrent Calls</Label>
                <p className="text-[11px] text-muted-foreground mt-0.5 mb-1">How many calls to run simultaneously</p>
                <Input className="mt-1" type="number" min="1" max="20" value={settingsForm.maxConcurrentCalls ?? 1} onChange={e => setSettingsForm(f => ({ ...f, maxConcurrentCalls: parseInt(e.target.value, 10) || 1 }))} />
              </div>
            </div>
            <div>
              <Label className="text-green-400">Hot Lead Notification Email</Label>
              <Input className="mt-1" type="email" value={settingsForm.notificationEmail ?? ""} onChange={e => setSettingsForm(f => ({ ...f, notificationEmail: e.target.value || null }))} />
            </div>
            <ScheduleEditor
              value={settingsForm.scheduleConfig}
              onChange={v => setSettingsForm(f => ({ ...f, scheduleConfig: v }))}
            />
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
              <Button onClick={() => updateCampaignMutation.mutate(settingsForm)} disabled={updateCampaignMutation.isPending}>
                {updateCampaignMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Standalone Schedule Dialog */}
      {campaign && (
        <Dialog open={showSchedule} onOpenChange={setShowSchedule}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-blue-400" />
                Campaign Schedule
              </DialogTitle>
            </DialogHeader>
            <div className="pt-1 space-y-3">
              <p className="text-xs text-muted-foreground">
                Configure when this campaign dials automatically. The server checks every minute and starts or pauses based on the schedule.
              </p>
              <ScheduleEditor
                value={campaign.scheduleConfig}
                onChange={v => {
                  updateCampaignMutation.mutate({ scheduleConfig: v }, {
                    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaignId] }),
                  });
                }}
              />
              {parseSchedule(campaign.scheduleConfig).enabled && parseSchedule(campaign.scheduleConfig).slots.length > 0 && (
                <div className="text-xs text-blue-400/80 bg-blue-500/5 border border-blue-500/15 rounded px-3 py-2">
                  Schedule active — campaign will auto-start at the configured times and pause when outside them.
                </div>
              )}
              <div className="flex justify-end pt-1">
                <Button variant="outline" size="sm" onClick={() => setShowSchedule(false)}>Done</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
