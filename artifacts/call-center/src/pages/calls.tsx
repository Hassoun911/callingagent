import { useState, useRef, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useListCallLogs, useUpdateCallLogNotes, useListPhoneNumbers, useListCompanies } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneIncoming, PhoneOutgoing, Play, Pause, Search, User, Mail, Tag, AlertCircle, ChevronRight, Phone, Loader2, Download, Trash2, FileText, Check, StickyNote, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

/** Format an E.164 number to a human-readable North American format. */
function formatPhone(raw: string | null | undefined): string {
  if (!raw || raw === "Anonymous") return raw ?? "Anonymous";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const activeAudio = { current: null as HTMLAudioElement | null };

function AudioPlayer({ src, large = false }: { src: string; large?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = src;
    audioRef.current = audio;
    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("ended", () => { setPlaying(false); setCurrentTime(0); });
    audio.addEventListener("error", () => { setError(true); setBuffering(false); });
    audio.addEventListener("waiting", () => setBuffering(true));
    audio.addEventListener("canplay", () => setBuffering(false));
    return () => { audio.pause(); audio.src = ""; };
  }, [src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      if (activeAudio.current && activeAudio.current !== audio) {
        activeAudio.current.pause();
      }
      activeAudio.current = audio;
      audio.play().then(() => setPlaying(true)).catch(() => setError(true));
    }
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const track = trackRef.current;
    if (!audio || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }, [duration]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (error) return <span className="text-xs text-muted-foreground italic">unavailable</span>;

  const Icon = buffering ? Loader2 : playing ? Pause : Play;

  if (large) {
    return (
      <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
        <button
          onClick={toggle}
          className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors text-primary"
        >
          <Icon className={`h-4 w-4 ${Icon === Play ? "ml-0.5" : ""} ${Icon === Loader2 ? "animate-spin" : ""}`} />
        </button>
        <div className="flex-1 space-y-1.5">
          <div ref={trackRef} onClick={seek} className="relative h-1.5 w-full bg-muted rounded-full cursor-pointer group">
            <div className="absolute inset-y-0 left-0 bg-primary rounded-full" style={{ width: `${progress}%` }} />
            <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-primary border-2 border-background shadow opacity-0 group-hover:opacity-100 transition-opacity -ml-1.5" style={{ left: `${progress}%` }} />
          </div>
          <div className="flex justify-between">
            <span className="text-xs font-mono text-muted-foreground">{fmtTime(currentTime)}</span>
            <span className="text-xs font-mono text-muted-foreground">{duration ? fmtTime(duration) : ""}</span>
          </div>
        </div>
        <a
          href={src}
          download
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 p-1.5 text-muted-foreground hover:text-foreground transition-colors rounded hover:bg-muted"
          title="Download recording"
        >
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    );
  }

  // Compact table row: play button + time only, no scrubber
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={toggle}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-muted hover:bg-muted/60 border border-border/60 transition-colors"
      >
        <Icon className={`h-2.5 w-2.5 ${Icon === Play ? "ml-px" : ""} ${Icon === Loader2 ? "animate-spin text-muted-foreground" : ""}`} />
      </button>
      <span className="text-[10px] font-mono text-muted-foreground tabular-nums whitespace-nowrap">
        {playing || currentTime > 0 ? fmtTime(currentTime) : (duration ? fmtTime(duration) : "")}
      </span>
    </div>
  );
}

function RecordingPlayer({ callId, hasRecording }: { callId: number; hasRecording: boolean }) {
  if (!hasRecording) return <span className="text-muted-foreground text-xs">--</span>;
  const src = `/api/call-logs/${callId}/recording`;
  return <AudioPlayer src={src} />;
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  const styles: Record<string, string> = {
    High: "bg-red-500/15 text-red-400 border-red-500/30",
    Medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
    Low: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${styles[priority] ?? "bg-secondary text-muted-foreground"}`}>
      {priority}
    </Badge>
  );
}

function NoteIconButton({ callId, note, onOpen }: {
  callId: number;
  note: string | null;
  onOpen: (target: { id: number; note: string | null }) => void;
}) {
  const hasNote = !!note;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen({ id: callId, note }); }}
      className={`p-1 rounded transition-all ${hasNote ? "text-amber-400 hover:text-amber-300 opacity-100" : "text-muted-foreground hover:text-amber-400 opacity-0 group-hover:opacity-100"}`}
      title={hasNote ? "View note" : "Add note"}
    >
      <StickyNote className="h-3.5 w-3.5" />
    </button>
  );
}

function NoteDialog({ callId, initialNote, open, onClose, onSaved }: {
  callId: number;
  initialNote: string | null;
  open: boolean;
  onClose: () => void;
  onSaved: (callId: number, note: string | null) => void;
}) {
  const [draft, setDraft] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(!initialNote);

  useEffect(() => {
    setDraft(initialNote ?? "");
    setEditMode(!initialNote);
  }, [callId, initialNote, open]);

  async function save() {
    setSaving(true);
    try {
      await fetch(`/api/call-logs/${callId}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: draft.trim() || null }),
      });
      onSaved(callId, draft.trim() || null);
      setEditMode(false);
      if (!draft.trim()) onClose();
    } finally {
      setSaving(false);
    }
  }

  const isReadMode = !!initialNote && !editMode;
  const dialogTitle = isReadMode ? "Note" : initialNote ? "Edit Note" : "Add Note";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
            <StickyNote className="h-4 w-4 text-amber-400" />
            {dialogTitle}
          </DialogTitle>
        </DialogHeader>
        {isReadMode && (
          <div className="space-y-4">
            <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap bg-muted/30 border border-border/40 rounded-lg p-4 min-h-[80px]">
              {initialNote}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditMode(true)}>Edit</Button>
              <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
        {!isReadMode && (
          <div className="space-y-4">
            <Textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Enter a note about this call..."
              rows={5}
              className="resize-none bg-background/60"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CallDetail({ call, open, onClose, onNotesUpdate }: { call: any; open: boolean; onClose: () => void; onNotesUpdate?: (id: number, notes: string | null) => void }) {
  const hasSummary = call?.callSummary || call?.callerName || call?.callerEmail || call?.callType || call?.actionRequired;
  const hasRecording = !!(call?.recordingSid || call?.recordingUrl);

  const [notes, setNotes] = useState<string>(call?.notes ?? "");
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateNotes = useUpdateCallLogNotes();

  useEffect(() => {
    setNotes(call?.notes ?? "");
    setSaved(false);
  }, [call?.id, call?.notes]);

  const persistNotes = useCallback((value: string) => {
    if (!call?.id) return;
    updateNotes.mutate(
      { id: call.id, data: { notes: value || null } },
      {
        onSuccess: (updated) => {
          setSaved(true);
          onNotesUpdate?.(call.id, updated.notes ?? null);
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaved(false), 2000);
        },
      }
    );
  }, [call?.id, updateNotes, onNotesUpdate]);

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNotes(val);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistNotes(val), 800);
  };

  const handleNotesBlur = () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    persistNotes(notes);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            {(call?.contactName || call?.callerIdName) ? (
              <>
                <span className="font-medium">{call.contactName || call.callerIdName}</span>
                <span className="font-mono text-sm text-muted-foreground">{formatPhone(call?.fromNumber)}</span>
              </>
            ) : (
              <span className="font-mono font-medium">{formatPhone(call?.fromNumber)}</span>
            )}
            {call?.priority && <PriorityBadge priority={call.priority} />}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {call?.fromNumber && call.fromNumber !== "Anonymous" && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Phone</p>
                <p className="text-sm font-mono font-medium">{formatPhone(call.fromNumber)}</p>
              </div>
            </div>
          )}
          {call?.callerName && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="text-sm font-medium">{call.callerName}</p>
              </div>
            </div>
          )}
          {call?.callerEmail && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{call.callerEmail}</p>
              </div>
            </div>
          )}
          {call?.callType && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Call Type</p>
                <p className="text-sm font-medium">{call.callType}</p>
              </div>
            </div>
          )}
          {call?.priority && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Priority</p>
                <PriorityBadge priority={call.priority} />
              </div>
            </div>
          )}
        </div>

        {hasRecording && call?.id && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Recording</p>
            <AudioPlayer src={`/api/call-logs/${call.id}/recording`} large />
          </div>
        )}

        {hasSummary && (
          <div className="space-y-4">
            {call.callSummary && (
              <div className="p-3 bg-background border border-border rounded-lg space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Summary</p>
                <p className="text-sm leading-relaxed">{call.callSummary}</p>
              </div>
            )}
            {call.actionRequired && (
              <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg space-y-1">
                <p className="text-xs text-primary uppercase tracking-wide font-medium">Action Required</p>
                <p className="text-sm">{call.actionRequired}</p>
              </div>
            )}
            {call.transcription && <Separator className="bg-border" />}
          </div>
        )}

        {call?.transcription && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Transcript</p>
            <div className="p-3 bg-background border border-border rounded-lg font-mono text-xs max-h-[280px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
              {call.transcription}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <FileText className="h-3 w-3" />
              Notes
            </p>
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check className="h-3 w-3" /> Saved
              </span>
            )}
          </div>
          <textarea
            value={notes}
            onChange={handleNotesChange}
            onBlur={handleNotesBlur}
            placeholder="Add notes about this call..."
            rows={4}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Calls() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"inbound" | "outbound" | "all">("all");
  const [status, setStatus] = useState<string>("all");
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ id: number; note: string | null } | null>(null);
  const [localNotes, setLocalNotes] = useState<Record<number, string | null>>({});

  // Company scope from ?companyId= query param
  const scopedCompanyId = (() => {
    const v = new URLSearchParams(window.location.search).get("companyId");
    return v ? parseInt(v) : null;
  })();
  const { data: companies = [] } = useListCompanies();
  const { data: phoneNumbers = [] } = useListPhoneNumbers();
  const scopedCompany = scopedCompanyId ? companies.find(c => c.id === scopedCompanyId) : null;
  const companyNumberSet = scopedCompanyId
    ? new Set(phoneNumbers.filter(n => (n as any).companyId === scopedCompanyId).map(n => n.number))
    : null;

  const { data: calls, isLoading, refetch } = useListCallLogs({
    direction: direction === "all" ? undefined : direction,
    status: status === "all" ? undefined : status,
    limit: 100,
  });

  const filtered = calls?.filter((c) => {
    // Company scope — keep only calls involving this company's numbers
    if (companyNumberSet && !companyNumberSet.has(c.toNumber) && !companyNumberSet.has(c.fromNumber)) {
      return false;
    }
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.fromNumber.includes(q) ||
      c.toNumber.includes(q) ||
      c.contactName?.toLowerCase().includes(q) ||
      c.callerIdName?.toLowerCase().includes(q) ||
      c.callerName?.toLowerCase().includes(q) ||
      c.callerEmail?.toLowerCase().includes(q) ||
      c.callType?.toLowerCase().includes(q)
    );
  });

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const hasSummaryData = (call: any) =>
    call.callSummary || call.callerName || call.callType || call.transcription;

  const handleDelete = async () => {
    if (confirmDeleteId === null) return;
    setDeletingId(confirmDeleteId);
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/call-logs/${confirmDeleteId}`, { method: "DELETE" });
      if (selectedCall?.id === confirmDeleteId) setSelectedCall(null);
      await refetch();
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    setIsClearing(true);
    try {
      await fetch("/api/call-logs", { method: "DELETE" });
      setSelectedCall(null);
      await refetch();
    } finally {
      setIsClearing(false);
      setClearConfirm(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {scopedCompany && (
            <div className="flex items-center gap-2 mb-1.5">
              <button
                onClick={() => navigate(`/companies/${scopedCompany.id}`)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Building2 className="h-3.5 w-3.5" />
                {scopedCompany.name}
              </button>
              <span className="text-muted-foreground/40 text-xs">/</span>
              <span className="text-xs text-foreground font-medium">Call Logs</span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {scopedCompany ? `${scopedCompany.name} — Call Logs` : "Call Logs"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {scopedCompany
              ? `Calls on ${scopedCompany.name}'s phone numbers.`
              : "Audit log of all communications with AI-extracted summaries."}
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setClearConfirm(true)}
          disabled={!calls?.length || isClearing}
          className="gap-2"
        >
          <Trash2 className="h-4 w-4" />
          Clear All
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 bg-card/50 p-4 border border-border rounded-lg">
        <div className="flex-1 relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by number, name, email, or call type..."
            className="pl-9 bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={direction} onValueChange={(v: any) => setDirection(v)}>
          <SelectTrigger className="w-[160px] bg-background">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Directions</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[160px] bg-background">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="busy">Busy</SelectItem>
            <SelectItem value="no-answer">No Answer</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-border">
        <div className="overflow-x-auto">
        <Table className="min-w-[960px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[130px]">Date / Time</TableHead>
              <TableHead className="w-[70px]">Direction</TableHead>
              <TableHead className="w-[110px]">From</TableHead>
              <TableHead className="w-[100px]">Caller</TableHead>
              <TableHead className="w-[90px]">Type</TableHead>
              <TableHead className="w-[70px]">Duration</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[85px]">Priority</TableHead>
              <TableHead className="w-[180px]">Recording</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i} className="border-border">
                  {[...Array(9)].map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                  No call logs found.
                </TableCell>
              </TableRow>
            ) : filtered?.map((call) => (
              <TableRow
                key={call.id}
                className="border-border cursor-pointer hover:bg-muted/30 transition-colors group"
                onClick={() => setSelectedCall(call)}
              >
                <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(call.createdAt).toLocaleString("en-US", {
                    timeZone: "America/Toronto",
                    month: "short", day: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                </TableCell>
                <TableCell>
                  {call.direction === "inbound" ? (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 gap-1 text-xs">
                      <PhoneIncoming className="h-3 w-3" /> In
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/20 gap-1 text-xs">
                      <PhoneOutgoing className="h-3 w-3" /> Out
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  {(call.contactName || call.callerIdName) ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{call.contactName || call.callerIdName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{formatPhone(call.fromNumber)}</span>
                    </div>
                  ) : (
                    <span className="font-mono text-xs">{formatPhone(call.fromNumber)}</span>
                  )}
                </TableCell>
                <TableCell className="text-sm">
                  {(() => {
                    const name = [call.callerName, call.contactName, call.callerIdName]
                      .find(n => n && n !== "null" && n !== "undefined");
                    if (name) return <span className="font-medium">{name}</span>;
                    const num = call.fromNumber;
                    if (num && num !== "Anonymous") return <span className="font-mono text-xs">{formatPhone(num)}</span>;
                    return <span className="text-muted-foreground text-xs">Anonymous</span>;
                  })()}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {call.callType ?? "--"}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {call.duration ? formatDuration(call.duration) : "--:--"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={call.status === "completed" ? "default" : "secondary"}
                    className="capitalize text-xs"
                  >
                    {call.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <PriorityBadge priority={call.priority} />
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2.5">
                    {!!(call.recordingSid || call.recordingUrl) ? (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedCall(call); }}
                          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full bg-muted hover:bg-primary/20 border border-border/60 transition-colors"
                          title="Play recording (opens detail)"
                        >
                          <Play className="h-2.5 w-2.5 ml-px" />
                        </button>
                        <a
                          href={`/api/call-logs/${call.id}/recording`}
                          download
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0 text-cyan-500 hover:text-cyan-300 transition-colors"
                          title="Download recording"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">--</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(call.id); }}
                      disabled={deletingId === call.id}
                      className="shrink-0 p-0.5 rounded text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                      title="Delete log"
                    >
                      {deletingId === call.id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />
                      }
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </Card>

      <CallDetail
        call={selectedCall}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
        onNotesUpdate={(id, notes) => {
          setSelectedCall((prev: any) => prev?.id === id ? { ...prev, notes } : prev);
          setLocalNotes(prev => ({ ...prev, [id]: notes }));
        }}
      />

      {noteTarget && (
        <NoteDialog
          callId={noteTarget.id}
          initialNote={noteTarget.note}
          open={!!noteTarget}
          onClose={() => setNoteTarget(null)}
          onSaved={(id, note) => {
            setLocalNotes(prev => ({ ...prev, [id]: note }));
            setNoteTarget(prev => prev?.id === id ? { ...prev, note } : prev);
          }}
        />
      )}

      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this call log?</AlertDialogTitle>
            <AlertDialogDescription>
              This record will be permanently removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}>
        <AlertDialogContent className="bg-card border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all call logs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {calls?.length ?? 0} call log records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              disabled={isClearing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isClearing ? "Clearing..." : "Clear All"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
