import { useState, useRef } from "react";
import { useParams, useLocation } from "wouter";
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
  ArrowLeft, Play, Pause, Phone, Trash2, Plus, Upload,
  ChevronDown, ChevronRight, CheckCircle2, XCircle, Clock,
  PhoneOff, AlertCircle, Volume2, RefreshCw, Settings2, FileText,
  Calendar, Mic, Maximize2, Copy, Check,
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

interface CampaignContact {
  id: number;
  campaignId: number;
  name: string;
  phone: string;
  address: string | null;
  callStatus: "pending" | "calling" | "completed" | "no_answer" | "failed";
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
  const map: Record<string, JSX.Element> = {
    pending: <Clock className={`${size} text-muted-foreground`} />,
    calling: <Phone className={`${size} text-yellow-400 animate-pulse`} />,
    completed: <CheckCircle2 className={`${size} text-green-400`} />,
    no_answer: <PhoneOff className={`${size} text-muted-foreground`} />,
    failed: <AlertCircle className={`${size} text-destructive`} />,
  };
  return map[status] ?? <Clock className={`${size} text-muted-foreground`} />;
}

function outcomeBadge(interestedInSelling: boolean | null, callStatus: string, callOutcome: string | null) {
  if (callStatus === "pending") return <span className="text-xs text-muted-foreground">Pending</span>;
  if (callStatus === "calling") return <span className="text-xs text-yellow-400 font-semibold">Calling...</span>;
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
  const d = new Date(iso);
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-CA", {
    month: "short", day: "numeric",
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

        {/* Recording player */}
        <span className="flex-1 min-w-0">
          {recordingUrl && <RecordingPlayer src={recordingUrl} />}
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

function ContactRow({ contact, campaignId, onRefresh }: { contact: CampaignContact; campaignId: number; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

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
            {outcomeBadge(contact.interestedInSelling, contact.callStatus, contact.callOutcome)}
          </div>
        </td>

        {/* Duration of last call */}
        <td className="px-3 py-3 text-xs text-muted-foreground tabular-nums">
          {formatDuration(contact.callDuration)}
        </td>

        {/* Last called */}
        <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap">
          {lastAttempt ?? <span className="text-muted-foreground/50">Never</span>}
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
            {contact.callStatus !== "calling" && (
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
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </td>
      </tr>

      {/* Expanded: call history */}
      {expanded && (
        <tr className="border-b border-border/40">
          <td colSpan={8} className="px-6 py-3 bg-secondary/10">
            {logsLoading ? (
              <div className="text-xs text-muted-foreground py-2">Loading call history...</div>
            ) : callLogs.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 italic">No calls made yet for this contact.</div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 mb-2">
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
          </td>
        </tr>
      )}
    </>
  );
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const campaignId = parseInt(id, 10);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAddContact, setShowAddContact] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phone: "", address: "" });
  const [importText, setImportText] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "completed" | "interested" | "no_answer">("all");
  const [searchTerm, setSearchTerm] = useState("");

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

  const [settingsForm, setSettingsForm] = useState<Partial<Campaign>>({});

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
      setImportText("");
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
      filter === "no_answer" ? c.callStatus === "no_answer" : true;
    return matchSearch && matchFilter;
  });

  if (campLoading) return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading...</div>;
  if (!campaign) return <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Campaign not found.</div>;

  const canStart = campaign.status !== "active" && campaign.status !== "completed" && (campaign.totalContacts ?? 0) > 0 && !!campaign.fromPhoneNumberId;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0 mt-0.5" onClick={() => navigate("/campaigns")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
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
          <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => { setSettingsForm({ name: campaign.name, script: campaign.script, systemPrompt: campaign.systemPrompt, fromPhoneNumberId: campaign.fromPhoneNumberId, notificationEmail: campaign.notificationEmail, maxCallDuration: campaign.maxCallDuration }); setShowSettings(true); }}>
            <Settings2 className="h-4 w-4" />
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

      {/* Script preview */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
          <FileText className="h-3.5 w-3.5" />
          Opening Script
        </div>
        <div className="text-sm text-foreground leading-relaxed" dir="rtl">{campaign.script}</div>
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
              {(["all", "pending", "interested", "completed", "no_answer"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                    filter === f
                      ? f === "interested" ? "bg-green-500/15 text-green-400 border border-green-500/20"
                      : "bg-primary/15 text-primary border border-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {f === "all" ? "All" : f === "no_answer" ? "No Answer" : f === "interested" ? "Hot Leads" : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
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
                <th className="text-left px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Last Called</th>
                <th className="text-center px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Calls</th>
                <th className="text-right px-3 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredContacts.map((c) => (
                <ContactRow key={c.id} contact={c} campaignId={campaignId} onRefresh={refreshContacts} />
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

      {/* Bulk Import Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Bulk Import Contacts</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Paste one contact per line. Format: <code className="text-xs bg-secondary px-1 py-0.5 rounded">Name, Phone, Address</code> or separated by <code className="text-xs bg-secondary px-1 py-0.5 rounded">|</code></p>
            <div className="bg-secondary/30 rounded p-2 text-xs text-muted-foreground font-mono">
              Ahmed Al-Sayed, +15550001111, 123 King St Toronto<br />
              Sara Mohammed, +15550002222, 456 Queen Ave<br />
              Omar Hassan | +15550003333 | 789 Bloor St
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

            {/* Mode toggle */}
            <div className="flex items-center gap-1 p-1 bg-secondary/40 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setSettingsForm(f => ({ ...f, systemPrompt: null }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${!settingsForm.systemPrompt ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Script Mode
              </button>
              <button
                type="button"
                onClick={() => setSettingsForm(f => ({ ...f, systemPrompt: f.systemPrompt || "" }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${settingsForm.systemPrompt !== null && settingsForm.systemPrompt !== undefined ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                AI Prompt Mode
              </button>
            </div>

            {!settingsForm.systemPrompt ? (
              <div>
                <Label className="text-green-400">Opening Script (Arabic)</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1">The AI reads this verbatim when the contact answers, then qualifies using the default prompt.</p>
                <Textarea className="mt-1 min-h-[100px] text-right" dir="rtl" value={settingsForm.script ?? ""} onChange={e => setSettingsForm(f => ({ ...f, script: e.target.value }))} />
              </div>
            ) : (
              <div>
                <Label className="text-green-400">AI System Prompt</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1">The AI generates its own opening and drives the entire conversation. The opening script is not used.</p>
                <Textarea className="mt-1 min-h-[120px]" value={settingsForm.systemPrompt ?? ""} onChange={e => setSettingsForm(f => ({ ...f, systemPrompt: e.target.value || "" }))} />
                <button type="button" className="mt-1 text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setSettingsForm(f => ({ ...f, systemPrompt: null }))}>
                  Switch back to Script Mode
                </button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
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
              <div>
                <Label className="text-green-400">Max Call Duration (sec)</Label>
                <Input className="mt-1" type="number" min="60" max="600" value={settingsForm.maxCallDuration ?? 300} onChange={e => setSettingsForm(f => ({ ...f, maxCallDuration: parseInt(e.target.value, 10) }))} />
              </div>
            </div>
            <div>
              <Label className="text-green-400">Hot Lead Notification Email</Label>
              <Input className="mt-1" type="email" value={settingsForm.notificationEmail ?? ""} onChange={e => setSettingsForm(f => ({ ...f, notificationEmail: e.target.value || null }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setShowSettings(false)}>Cancel</Button>
              <Button onClick={() => updateCampaignMutation.mutate(settingsForm)} disabled={updateCampaignMutation.isPending}>
                {updateCampaignMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
