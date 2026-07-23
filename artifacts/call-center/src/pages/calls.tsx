import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useListCallLogs,
  useListCompanies,
  useListPhoneNumbers,
  useUpdateCallLogNotes,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertCircle,
  Building2,
  Check,
  ChevronRight,
  Download,
  FileText,
  Loader2,
  Mail,
  Pause,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Play,
  Search,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function formatPhone(raw: string | null | undefined): string {
  if (!raw || raw === "Anonymous") return raw ?? "Anonymous";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const number = digits.slice(1);
    return `(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`;
  }
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function callerName(call: any): string | null {
  return [call.callerName, call.contactName, call.callerIdName].find(
    name => name && name !== "null" && name !== "undefined",
  ) ?? null;
}

function DirectionBadge({ direction }: { direction: string }) {
  const inbound = direction === "inbound";
  return (
    <Badge
      variant="outline"
      className={`gap-1 text-[10px] sm:text-xs ${
        inbound
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
          : "border-blue-500/20 bg-blue-500/10 text-blue-400"
      }`}
    >
      {inbound ? <PhoneIncoming className="h-3 w-3" /> : <PhoneOutgoing className="h-3 w-3" />}
      {inbound ? "In" : "Out"}
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  const styles: Record<string, string> = {
    High: "border-red-500/30 bg-red-500/15 text-red-400",
    Medium: "border-amber-500/30 bg-amber-500/15 text-amber-400",
    Low: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  };
  return <Badge variant="outline" className={`text-[10px] sm:text-xs ${styles[priority] ?? "bg-secondary text-muted-foreground"}`}>{priority}</Badge>;
}

function CallTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  const styles: Record<string, string> = {
    Emergency: "border-red-500/30 bg-red-500/15 text-red-400",
    Appointment: "border-blue-500/30 bg-blue-500/15 text-blue-400",
    "Pricing Inquiry": "border-amber-500/30 bg-amber-500/15 text-amber-400",
    "General Inquiry": "border-border/50 bg-secondary/60 text-muted-foreground",
  };
  return <Badge variant="outline" className={`text-[10px] sm:text-xs ${styles[type] ?? "border-border/50 bg-secondary/60 text-muted-foreground"}`}>{type}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const complete = status === "completed";
  return (
    <Badge variant={complete ? "default" : "secondary"} className="text-[10px] capitalize sm:text-xs">
      {status}
    </Badge>
  );
}

const activeAudio = { current: null as HTMLAudioElement | null };

function AudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = "metadata";
    audioRef.current = audio;
    const loaded = () => setDuration(audio.duration);
    const changed = () => setCurrentTime(audio.currentTime);
    const ended = () => { setPlaying(false); setCurrentTime(0); };
    const failed = () => { setError(true); setBuffering(false); };
    const waiting = () => setBuffering(true);
    const ready = () => setBuffering(false);
    audio.addEventListener("loadedmetadata", loaded);
    audio.addEventListener("timeupdate", changed);
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failed);
    audio.addEventListener("waiting", waiting);
    audio.addEventListener("canplay", ready);
    return () => {
      audio.pause();
      audio.removeEventListener("loadedmetadata", loaded);
      audio.removeEventListener("timeupdate", changed);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      audio.removeEventListener("waiting", waiting);
      audio.removeEventListener("canplay", ready);
    };
  }, [src]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    if (activeAudio.current && activeAudio.current !== audio) activeAudio.current.pause();
    activeAudio.current = audio;
    audio.play().then(() => setPlaying(true)).catch(() => setError(true));
  }, [playing]);

  const seek = (event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const track = trackRef.current;
    if (!audio || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
  };

  if (error) return <span className="text-xs italic text-muted-foreground">Recording unavailable</span>;
  const Icon = buffering ? Loader2 : playing ? Pause : Play;
  const progress = duration ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background p-3">
      <button onClick={toggle} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20" aria-label={playing ? "Pause recording" : "Play recording"}>
        <Icon className={`h-4 w-4 ${buffering ? "animate-spin" : ""}`} />
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div ref={trackRef} onClick={seek} className="relative h-2 cursor-pointer rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
          <span>{formatDuration(currentTime)}</span><span>{duration ? formatDuration(duration) : ""}</span>
        </div>
      </div>
      <a href={src} download onClick={event => event.stopPropagation()} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Download recording">
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

function CallDetail({ call, open, onClose, onNotesUpdate }: { call: any; open: boolean; onClose: () => void; onNotesUpdate: (id: number, notes: string | null) => void }) {
  const [notes, setNotes] = useState(call?.notes ?? "");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateNotes = useUpdateCallLogNotes();

  useEffect(() => { setNotes(call?.notes ?? ""); setSaved(false); }, [call?.id, call?.notes]);

  const persist = useCallback((value: string) => {
    if (!call?.id) return;
    updateNotes.mutate({ id: call.id, data: { notes: value.trim() || null } }, {
      onSuccess: updated => {
        setSaved(true);
        onNotesUpdate(call.id, updated.notes ?? null);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
      },
    });
  }, [call?.id, onNotesUpdate, updateNotes]);

  const changeNotes = (value: string) => {
    setNotes(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(value), 800);
  };

  if (!call) return null;
  const name = callerName(call);
  const hasRecording = !!(call.recordingSid || call.recordingUrl);

  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] overflow-y-auto border-border bg-card p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 break-words font-medium">{name || formatPhone(call.fromNumber)}</span>
            {name && <span className="font-mono text-xs text-muted-foreground sm:text-sm">{formatPhone(call.fromNumber)}</span>}
            <PriorityBadge priority={call.priority} />
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {call.fromNumber && call.fromNumber !== "Anonymous" && <DetailItem icon={Phone} label="Phone" value={formatPhone(call.fromNumber)} mono />}
          {call.callerName && <DetailItem icon={User} label="Name" value={call.callerName} />}
          {call.callerEmail && <DetailItem icon={Mail} label="Email" value={call.callerEmail} />}
          {call.callType && <DetailItem icon={Tag} label="Call Type" value={call.callType} />}
          {call.priority && <DetailItem icon={AlertCircle} label="Priority" value={call.priority} />}
        </div>

        {hasRecording && <div className="space-y-2"><p className="text-xs uppercase tracking-wide text-muted-foreground">Recording</p><AudioPlayer src={`/api/call-logs/${call.id}/recording`} /></div>}
        {call.callSummary && <InfoBox label="Summary" text={call.callSummary} />}
        {call.actionRequired && <InfoBox label="Action Required" text={call.actionRequired} highlighted />}
        {call.transcription && <><Separator /><div className="space-y-2"><p className="text-xs uppercase tracking-wide text-muted-foreground">Transcript</p><div className="max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed">{call.transcription}</div></div></>}

        <div className="space-y-2">
          <div className="flex items-center justify-between"><p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><FileText className="h-3 w-3" />Notes</p>{saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3 w-3" />Saved</span>}</div>
          <textarea value={notes} onChange={event => changeNotes(event.target.value)} onBlur={() => persist(notes)} rows={4} placeholder="Add notes about this call..." className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailItem({ icon: Icon, label, value, mono = false }: { icon: React.ElementType; label: string; value: string; mono?: boolean }) {
  return <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-background p-3"><Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" /><div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className={`break-words text-sm font-medium ${mono ? "font-mono" : ""}`}>{value}</p></div></div>;
}

function InfoBox({ label, text, highlighted = false }: { label: string; text: string; highlighted?: boolean }) {
  return <div className={`space-y-1 rounded-lg border p-3 ${highlighted ? "border-primary/20 bg-primary/5" : "border-border bg-background"}`}><p className={`text-xs font-medium uppercase tracking-wide ${highlighted ? "text-primary" : "text-muted-foreground"}`}>{label}</p><p className="break-words text-sm leading-relaxed">{text}</p></div>;
}

function MobileCallCard({ call, onOpen, onDelete, deleting }: { call: any; onOpen: () => void; onDelete: () => void; deleting: boolean }) {
  const name = callerName(call);
  const hasRecording = !!(call.recordingSid || call.recordingUrl);
  return (
    <article onClick={onOpen} className="rounded-xl border border-border bg-card p-4 active:scale-[0.995]">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${call.direction === "inbound" ? "bg-emerald-500/10 text-emerald-400" : "bg-blue-500/10 text-blue-400"}`}>
          {call.direction === "inbound" ? <PhoneIncoming className="h-4 w-4" /> : <PhoneOutgoing className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><h2 className="truncate text-sm font-semibold">{name || formatPhone(call.fromNumber)}</h2>{name && <p className="truncate font-mono text-xs text-muted-foreground">{formatPhone(call.fromNumber)}</p>}</div>
            <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{formatDate(call.createdAt)} · {formatDuration(call.duration)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2"><DirectionBadge direction={call.direction} /><StatusBadge status={call.status} /><CallTypeBadge type={call.callType} /><PriorityBadge priority={call.priority} /></div>
      {call.callSummary && <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{call.callSummary}</p>}
      {call.actionRequired && <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs"><span className="font-semibold text-primary">Action:</span> {call.actionRequired}</div>}

      <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">{hasRecording ? <><Play className="h-3.5 w-3.5 text-cyan-400" /><span>Recording available</span></> : <span>No recording</span>}</div>
        <div className="flex items-center gap-1">
          {hasRecording && <a href={`/api/call-logs/${call.id}/recording`} download onClick={event => event.stopPropagation()} className="flex h-10 w-10 items-center justify-center rounded-md text-cyan-400 hover:bg-cyan-500/10" aria-label="Download recording"><Download className="h-4 w-4" /></a>}
          <button onClick={event => { event.stopPropagation(); onDelete(); }} disabled={deleting} className="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400" aria-label="Delete call log">{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button>
        </div>
      </div>
    </article>
  );
}

export default function Calls() {
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"inbound" | "outbound" | "all">("all");
  const [status, setStatus] = useState("all");
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [localNotes, setLocalNotes] = useState<Record<number, string | null>>({});

  const scopedCompanyId = (() => {
    const value = new URLSearchParams(window.location.search).get("companyId");
    return value ? Number(value) : null;
  })();
  const { data: companies = [] } = useListCompanies();
  const { data: phoneNumbers = [] } = useListPhoneNumbers();
  const scopedCompany = scopedCompanyId ? companies.find(company => company.id === scopedCompanyId) : null;
  const companyLinkedNumbers = scopedCompanyId ? phoneNumbers.filter(number => Number((number as any).companyId) === scopedCompanyId) : null;
  const companyNumberSet = companyLinkedNumbers?.length ? new Set(companyLinkedNumbers.map(number => number.number)) : null;
  const companyHasNoLinkedNumbers = scopedCompanyId !== null && companyLinkedNumbers?.length === 0;

  const { data: calls, isLoading, refetch } = useListCallLogs({
    direction: direction === "all" ? undefined : direction,
    status: status === "all" ? undefined : status,
    limit: 100,
  });

  const filtered = calls?.filter(call => {
    if (companyNumberSet && !companyNumberSet.has(call.toNumber) && !companyNumberSet.has(call.fromNumber)) return false;
    if (!search.trim()) return true;
    const query = search.toLowerCase();
    return [call.fromNumber, call.toNumber, call.contactName, call.callerIdName, call.callerName, call.callerEmail, call.callType]
      .some(value => String(value ?? "").toLowerCase().includes(query));
  });

  const deleteCall = async () => {
    if (confirmDeleteId === null) return;
    const id = confirmDeleteId;
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      await fetch(`/api/call-logs/${id}`, { method: "DELETE", credentials: "include" });
      if (selectedCall?.id === id) setSelectedCall(null);
      await refetch();
    } finally { setDeletingId(null); }
  };

  const clearAll = async () => {
    setIsClearing(true);
    try {
      await fetch("/api/call-logs", { method: "DELETE", credentials: "include" });
      setSelectedCall(null);
      await refetch();
    } finally { setIsClearing(false); setClearConfirm(false); }
  };

  return (
    <div className="space-y-4 pb-24 sm:space-y-6 sm:pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {scopedCompany && <div className="mb-1.5 flex items-center gap-2"><button onClick={() => navigate(`/companies/${scopedCompany.id}`)} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><Building2 className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{scopedCompany.name}</span></button><span className="text-xs text-muted-foreground/40">/</span><span className="text-xs font-medium">Call Logs</span></div>}
          <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{scopedCompany ? `${scopedCompany.name} — Call Logs` : "Call Logs"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{scopedCompany ? `Calls on ${scopedCompany.name}'s phone numbers.` : "Audit log of all communications with AI-extracted summaries."}</p>
        </div>
        <Button variant="destructive" size="sm" onClick={() => setClearConfirm(true)} disabled={!calls?.length || isClearing} className="min-h-11 w-full gap-2 sm:min-h-9 sm:w-auto"><Trash2 className="h-4 w-4" />Clear All</Button>
      </header>

      {companyHasNoLinkedNumbers && <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 text-sm text-yellow-400"><div className="font-medium">No phone numbers linked to {scopedCompany?.name}.</div><div className="mt-1 text-yellow-400/70">Showing all calls. Link a number to scope these results.</div></div>}

      <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card/50 p-3 sm:grid-cols-[minmax(0,1fr)_160px_160px] sm:p-4">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input placeholder="Search number, name, email, or call type..." className="min-h-11 bg-background pl-9 sm:min-h-10" value={search} onChange={event => setSearch(event.target.value)} /></div>
        <Select value={direction} onValueChange={(value: any) => setDirection(value)}><SelectTrigger className="min-h-11 w-full bg-background sm:min-h-10"><SelectValue placeholder="Direction" /></SelectTrigger><SelectContent><SelectItem value="all">All Directions</SelectItem><SelectItem value="inbound">Inbound</SelectItem><SelectItem value="outbound">Outbound</SelectItem></SelectContent></Select>
        <Select value={status} onValueChange={setStatus}><SelectTrigger className="min-h-11 w-full bg-background sm:min-h-10"><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="busy">Busy</SelectItem><SelectItem value="no-answer">No Answer</SelectItem><SelectItem value="failed">Failed</SelectItem></SelectContent></Select>
      </section>

      <div className="space-y-3 md:hidden">
        {isLoading ? [...Array(5)].map((_, index) => <Skeleton key={index} className="h-48 rounded-xl" />) : filtered?.length ? filtered.map(call => <MobileCallCard key={call.id} call={{ ...call, notes: localNotes[call.id] ?? call.notes }} onOpen={() => setSelectedCall({ ...call, notes: localNotes[call.id] ?? call.notes })} onDelete={() => setConfirmDeleteId(call.id)} deleting={deletingId === call.id} />) : <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">No call logs found.</div>}
      </div>

      <Card className="hidden border-border md:block">
        <div className="overflow-x-auto">
          <Table className="min-w-[960px]">
            <TableHeader><TableRow className="border-border hover:bg-transparent"><TableHead>Date / Time</TableHead><TableHead>Direction</TableHead><TableHead>From</TableHead><TableHead>Caller</TableHead><TableHead>Type</TableHead><TableHead>Duration</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead><TableHead>Recording</TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? [...Array(5)].map((_, row) => <TableRow key={row}>{[...Array(9)].map((_, column) => <TableCell key={column}><Skeleton className="h-4 w-full" /></TableCell>)}</TableRow>) : filtered?.length ? filtered.map(call => {
                const name = callerName(call);
                const hasRecording = !!(call.recordingSid || call.recordingUrl);
                return <TableRow key={call.id} onClick={() => setSelectedCall({ ...call, notes: localNotes[call.id] ?? call.notes })} className="group cursor-pointer border-border hover:bg-muted/30"><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDate(call.createdAt)}</TableCell><TableCell><DirectionBadge direction={call.direction} /></TableCell><TableCell>{(call.contactName || call.callerIdName) ? <div><div className="text-sm font-medium">{call.contactName || call.callerIdName}</div><div className="font-mono text-xs text-muted-foreground">{formatPhone(call.fromNumber)}</div></div> : <span className="font-mono text-xs">{formatPhone(call.fromNumber)}</span>}</TableCell><TableCell className="text-sm">{name || formatPhone(call.fromNumber)}</TableCell><TableCell><CallTypeBadge type={call.callType} /></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{formatDuration(call.duration)}</TableCell><TableCell><StatusBadge status={call.status} /></TableCell><TableCell><PriorityBadge priority={call.priority} /></TableCell><TableCell onClick={event => event.stopPropagation()}><div className="flex items-center gap-2">{hasRecording ? <><button onClick={() => setSelectedCall(call)} className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted hover:bg-primary/20" aria-label="Open recording"><Play className="h-3 w-3" /></button><a href={`/api/call-logs/${call.id}/recording`} download className="flex h-8 w-8 items-center justify-center rounded-md text-cyan-400 hover:bg-cyan-500/10" aria-label="Download recording"><Download className="h-4 w-4" /></a></> : <span className="text-xs text-muted-foreground">--</span>}<button onClick={() => setConfirmDeleteId(call.id)} disabled={deletingId === call.id} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-500/10 hover:text-red-400" aria-label="Delete call log">{deletingId === call.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}</button></div></TableCell></TableRow>;
              }) : <TableRow><TableCell colSpan={9} className="py-16 text-center text-muted-foreground">No call logs found.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </Card>

      <CallDetail call={selectedCall} open={!!selectedCall} onClose={() => setSelectedCall(null)} onNotesUpdate={(id, notes) => { setLocalNotes(previous => ({ ...previous, [id]: notes })); setSelectedCall((previous: any) => previous?.id === id ? { ...previous, notes } : previous); }} />

      <AlertDialog open={confirmDeleteId !== null} onOpenChange={open => !open && setConfirmDeleteId(null)}><AlertDialogContent className="w-[calc(100vw-1rem)] border-border bg-card sm:w-full"><AlertDialogHeader><AlertDialogTitle>Delete this call log?</AlertDialogTitle><AlertDialogDescription>This record will be permanently removed. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={deleteCall} className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90"><Trash2 className="h-4 w-4" />Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <AlertDialog open={clearConfirm} onOpenChange={setClearConfirm}><AlertDialogContent className="w-[calc(100vw-1rem)] border-border bg-card sm:w-full"><AlertDialogHeader><AlertDialogTitle>Clear all call logs?</AlertDialogTitle><AlertDialogDescription>This will permanently delete all {calls?.length ?? 0} call-log records. This action cannot be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel><AlertDialogAction onClick={clearAll} disabled={isClearing} className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90">{isClearing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}{isClearing ? "Clearing..." : "Clear All"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>
  );
}
