import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useListCallLogs, useListPhoneNumbers, useListCompanies } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  Building2,
  CalendarDays,
  Download,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Pause,
  Phone,
  PhoneIncoming,
  Play,
  Tag,
  User,
} from "lucide-react";

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
  if (!seconds || !Number.isFinite(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

  const seek = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    const track = trackRef.current;
    if (!audio || !track || !duration) return;
    const rect = track.getBoundingClientRect();
    audio.currentTime = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * duration;
  }, [duration]);

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
        <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>{formatDuration(currentTime)}</span><span>{duration ? formatDuration(duration) : ""}</span></div>
      </div>
      <a href={src} download onClick={event => event.stopPropagation()} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Download recording"><Download className="h-4 w-4" /></a>
    </div>
  );
}

function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  const styles: Record<string, string> = {
    High: "border-red-500/30 bg-red-500/15 text-red-400",
    Medium: "border-amber-500/30 bg-amber-500/15 text-amber-400",
    Low: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  };
  return <Badge variant="outline" className={`text-[10px] font-medium sm:text-xs ${styles[priority] ?? "bg-secondary text-muted-foreground"}`}>{priority}</Badge>;
}

function CallTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null;
  const styles: Record<string, string> = {
    Emergency: "border-red-500/30 bg-red-500/15 text-red-400",
    Appointment: "border-blue-500/30 bg-blue-500/15 text-blue-400",
    "Pricing Inquiry": "border-amber-500/30 bg-amber-500/15 text-amber-400",
    "General Inquiry": "border-border/50 bg-secondary/60 text-muted-foreground",
  };
  return <Badge variant="outline" className={`text-[10px] font-medium sm:text-xs ${styles[type] ?? "border-border/50 bg-secondary/60 text-muted-foreground"}`}>{type}</Badge>;
}

function DetailItem({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-background p-3">
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><div className="break-words text-sm font-medium">{children}</div></div>
    </div>
  );
}

function LeadDetail({ call, companyName, open, onClose }: { call: any; companyName?: string; open: boolean; onClose: () => void }) {
  if (!call) return null;
  const hasRecording = !!(call.recordingSid || call.recordingUrl);
  return (
    <Dialog open={open} onOpenChange={value => !value && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] overflow-y-auto border-border bg-card p-4 sm:max-w-2xl sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
            <span className="min-w-0 break-words font-medium">{call.callerName || call.contactName || call.callerIdName || formatPhone(call.fromNumber)}</span>
            {(call.callerName || call.contactName || call.callerIdName) && <span className="font-mono text-xs text-muted-foreground sm:text-sm">{formatPhone(call.fromNumber)}</span>}
            <CallTypeBadge type={call.callType} /><PriorityBadge priority={call.priority} />
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {companyName && <div className="sm:col-span-2"><DetailItem icon={Building2} label="Company"><span className="text-primary">{companyName}</span></DetailItem></div>}
          {call.fromNumber && call.fromNumber !== "Anonymous" && <DetailItem icon={Phone} label="Phone"><span className="font-mono">{formatPhone(call.fromNumber)}</span></DetailItem>}
          {call.callerName && <DetailItem icon={User} label="Name">{call.callerName}</DetailItem>}
          {call.callerEmail && <DetailItem icon={Mail} label="Email">{call.callerEmail}</DetailItem>}
          {call.callerLocation && <DetailItem icon={MapPin} label="Location">{call.callerLocation}</DetailItem>}
          {call.callType && <DetailItem icon={Tag} label="Call Type"><CallTypeBadge type={call.callType} /></DetailItem>}
          {call.priority && <DetailItem icon={AlertCircle} label="Priority"><PriorityBadge priority={call.priority} /></DetailItem>}
          <DetailItem icon={CalendarDays} label="Date">{new Date(call.createdAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</DetailItem>
        </div>

        {hasRecording && call.id && <div className="space-y-2"><p className="text-xs uppercase tracking-wide text-muted-foreground">Recording</p><AudioPlayer src={`/api/call-logs/${call.id}/recording`} /></div>}
        {call.callSummary && <div className="space-y-1 rounded-lg border border-border bg-background p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Summary</p><p className="break-words text-sm leading-relaxed">{call.callSummary}</p></div>}
        {call.actionRequired && <div className="space-y-1 rounded-lg border border-primary/20 bg-primary/5 p-3"><p className="text-xs font-medium uppercase tracking-wide text-primary">Action Required</p><p className="break-words text-sm">{call.actionRequired}</p></div>}
        {call.transcription && <><Separator /><div className="space-y-2"><p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><FileText className="h-3 w-3" />Transcript</p><div className="max-h-[280px] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed">{call.transcription}</div></div></>}
        {call.notes && <><Separator /><div className="space-y-2"><p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground"><FileText className="h-3 w-3" />Notes</p><div className="whitespace-pre-wrap break-words rounded-lg border border-border bg-background p-3 text-sm">{call.notes}</div></div></>}
      </DialogContent>
    </Dialog>
  );
}

type TabId = "needs-help" | "appointments";

function LeadCard({ call, companyName, onClick }: { call: any; companyName?: string; onClick: () => void }) {
  const displayName = [call.callerName, call.contactName, call.callerIdName].find(name => name && name !== "null" && name !== "undefined") ?? null;
  const hasRecording = !!(call.recordingSid || call.recordingUrl);
  return (
    <button onClick={onClick} className="group w-full rounded-xl border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-muted/20 active:scale-[0.995]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary/10"><PhoneIncoming className="h-4 w-4 text-primary" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{displayName || formatPhone(call.fromNumber)}</p>
              {displayName && <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{formatPhone(call.fromNumber)}</p>}
              {companyName && <p className="mt-1 flex items-center gap-1 truncate text-xs font-medium text-primary/80"><Building2 className="h-3 w-3 flex-shrink-0" />{companyName}</p>}
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end"><CallTypeBadge type={call.callType} /><PriorityBadge priority={call.priority} /></div>
          </div>

          {(call.callerEmail || call.callerLocation) && <div className="mt-2 space-y-1">{call.callerEmail && <p className="flex items-center gap-1 break-all text-xs text-muted-foreground"><Mail className="h-3 w-3 flex-shrink-0" />{call.callerEmail}</p>}{call.callerLocation && <p className="flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="mt-0.5 h-3 w-3 flex-shrink-0" /><span className="break-words">{call.callerLocation}</span></p>}</div>}
          {call.callSummary && <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">{call.callSummary}</p>}
          {call.actionRequired && <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary"><span className="text-[10px] font-medium uppercase tracking-wide">Action: </span>{call.actionRequired}</div>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>{formatDate(call.createdAt)}</span>{call.duration ? <span>{formatDuration(call.duration)}</span> : null}{hasRecording && <span className="flex items-center gap-1 text-primary"><Play className="h-3 w-3" />Recording</span>}</div>
        </div>
      </div>
    </button>
  );
}

export default function Leads() {
  const [activeTab, setActiveTab] = useState<TabId>("needs-help");
  const [selectedCall, setSelectedCall] = useState<any>(null);
  const { data: calls, isLoading } = useListCallLogs({ limit: 200 });
  const { data: phoneNumbers } = useListPhoneNumbers();
  const { data: companies } = useListCompanies();
  const normalizePhone = (number: string) => number.replace(/\D/g, "");

  const urlCompanyId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("companyId");
    return value ? parseInt(value, 10) : undefined;
  }, []);

  const filterCompanyName = useMemo(() => urlCompanyId && companies ? companies.find(company => company.id === urlCompanyId)?.name ?? null : null, [urlCompanyId, companies]);
  const companyNumbers = useMemo(() => {
    if (!urlCompanyId || !phoneNumbers) return null;
    return new Set(phoneNumbers.filter(number => number.companyId === urlCompanyId).map(number => normalizePhone(number.number)));
  }, [urlCompanyId, phoneNumbers]);
  const companyHasNoNumbers = !!urlCompanyId && !!phoneNumbers && companyNumbers?.size === 0;

  const companyByToNumber = useMemo(() => {
    const map: Record<string, string> = {};
    if (!phoneNumbers || !companies) return map;
    const companyMap = new Map(companies.map(company => [company.id, company.name]));
    for (const number of phoneNumbers) {
      if (number.companyId && number.number) {
        const name = companyMap.get(number.companyId);
        if (name) map[normalizePhone(number.number)] = name;
      }
    }
    return map;
  }, [phoneNumbers, companies]);

  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    if (!companyNumbers) return calls;
    if (companyNumbers.size === 0) return [];
    return calls.filter(call => call.toNumber && companyNumbers.has(normalizePhone(call.toNumber)));
  }, [calls, companyNumbers]);

  const needsHelp = filteredCalls.filter(call => call.callType === "Emergency" || call.priority === "High");
  const appointments = filteredCalls.filter(call => call.callType === "Appointment");
  const tabs = [
    { id: "needs-help" as const, label: "Needs Help", count: needsHelp.length },
    { id: "appointments" as const, label: "Appointments", count: appointments.length },
  ];
  const visibleCalls = activeTab === "needs-help" ? needsHelp : appointments;

  return (
    <div className="space-y-5 pb-24 sm:space-y-6 sm:pb-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">Inbound calls classified as high-priority or appointment requests by the AI.</p>
        {filterCompanyName && <div className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-xs font-medium text-primary"><Building2 className="h-3 w-3 flex-shrink-0" /><span className="truncate">{filterCompanyName}</span></div>}
      </header>

      {companyHasNoNumbers && <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300"><p className="font-medium">No phone line is connected to this company.</p><p className="mt-1 text-xs text-amber-300/70">Connect a phone number before lead activity can be assigned here.</p></div>}

      <div className="grid grid-cols-2 gap-2 border-b border-border sm:flex sm:gap-1">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`relative flex min-h-12 items-center justify-center gap-2 px-3 text-sm font-medium transition-colors sm:min-h-10 sm:px-4 ${activeTab === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            <span className="truncate">{tab.label}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${activeTab === tab.id ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>{tab.count}</span>{activeTab === tab.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full bg-primary" />}
          </button>
        ))}
      </div>

      {isLoading ? <div className="space-y-3">{[...Array(4)].map((_, index) => <Skeleton key={index} className="h-44 w-full rounded-xl" />)}</div> : visibleCalls.length === 0 ? <Card className="border-border"><CardContent className="flex flex-col items-center justify-center px-4 py-16 text-center">{activeTab === "needs-help" ? <><AlertCircle className="mb-4 h-10 w-10 text-muted-foreground/30" /><p className="font-medium text-muted-foreground">No high-priority calls</p><p className="mt-1 max-w-sm text-xs text-muted-foreground/60">Emergency and high-priority inbound calls will appear here.</p></> : <><CalendarDays className="mb-4 h-10 w-10 text-muted-foreground/30" /><p className="font-medium text-muted-foreground">No appointment requests</p><p className="mt-1 max-w-sm text-xs text-muted-foreground/60">Calls classified as appointment requests by the AI will appear here.</p></>}</CardContent></Card> : <div className="space-y-3">{visibleCalls.map(call => <LeadCard key={call.id} call={call} companyName={call.toNumber ? companyByToNumber[normalizePhone(call.toNumber)] : undefined} onClick={() => setSelectedCall(call)} />)}</div>}

      <LeadDetail call={selectedCall} companyName={selectedCall?.toNumber ? companyByToNumber[normalizePhone(selectedCall.toNumber)] : undefined} open={!!selectedCall} onClose={() => setSelectedCall(null)} />
    </div>
  );
}
