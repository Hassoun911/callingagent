import { useState, useMemo } from "react";
import { useListCallLogs, useListPhoneNumbers, useListCompanies } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import {
  PhoneIncoming, Phone, Mail, MapPin, Tag, AlertCircle,
  User, CalendarDays, FileText, Play, Download, Loader2, Building2,
} from "lucide-react";
import { useRef, useEffect, useCallback } from "react";

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

function AudioPlayer({ src }: { src: string }) {
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
    if (!audio || !track || !duration || !isFinite(duration)) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * duration;
  }, [duration]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (error) return <span className="text-xs text-muted-foreground italic">unavailable</span>;

  const Icon = buffering ? Loader2 : playing ? Download : Play;

  return (
    <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
      <button
        onClick={toggle}
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors text-primary"
      >
        <Icon className={`h-4 w-4 ${!playing && !buffering ? "ml-0.5" : ""} ${Icon === Loader2 ? "animate-spin" : ""}`} />
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

function CallTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return <span className="text-muted-foreground text-xs">--</span>;
  const styles: Record<string, string> = {
    "Emergency":        "bg-red-500/15 text-red-400 border-red-500/30",
    "Appointment":      "bg-blue-500/15 text-blue-400 border-blue-500/30",
    "Pricing Inquiry":  "bg-amber-500/15 text-amber-400 border-amber-500/30",
    "General Inquiry":  "bg-secondary/60 text-muted-foreground border-border/50",
  };
  return (
    <Badge variant="outline" className={`text-xs font-medium ${styles[type] ?? "bg-secondary/60 text-muted-foreground border-border/50"}`}>
      {type}
    </Badge>
  );
}

function LeadDetail({ call, companyName, open, onClose }: { call: any; companyName?: string; open: boolean; onClose: () => void }) {
  if (!call) return null;
  const hasRecording = !!(call.recordingSid || call.recordingUrl);
  const hasSummary = call.callSummary || call.actionRequired;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3 flex-wrap">
            {(call.contactName || call.callerIdName) ? (
              <>
                <span className="font-medium">{call.contactName || call.callerIdName}</span>
                <span className="font-mono text-sm text-muted-foreground">{formatPhone(call.fromNumber)}</span>
              </>
            ) : (
              <span className="font-mono font-medium">{formatPhone(call.fromNumber)}</span>
            )}
            <CallTypeBadge type={call.callType} />
            <PriorityBadge priority={call.priority} />
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          {companyName && (
            <div className="col-span-2 flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg">
              <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Company</p>
                <p className="text-sm font-medium text-primary">{companyName}</p>
              </div>
            </div>
          )}
          {call.fromNumber && call.fromNumber !== "Anonymous" && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Phone</p>
                <p className="text-sm font-mono font-medium">{formatPhone(call.fromNumber)}</p>
              </div>
            </div>
          )}
          {call.callerName && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="text-sm font-medium">{call.callerName}</p>
              </div>
            </div>
          )}
          {call.callerEmail && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Email</p>
                <p className="text-sm font-medium">{call.callerEmail}</p>
              </div>
            </div>
          )}
          {call.callerLocation && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="text-sm font-medium">{call.callerLocation}</p>
              </div>
            </div>
          )}
          {call.callType && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Call Type</p>
                <CallTypeBadge type={call.callType} />
              </div>
            </div>
          )}
          {call.priority && (
            <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-xs text-muted-foreground">Priority</p>
                <PriorityBadge priority={call.priority} />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Date</p>
              <p className="text-sm font-medium">
                {new Date(call.createdAt).toLocaleString("en-US", {
                  timeZone: "America/New_York",
                  month: "short", day: "numeric", year: "numeric",
                  hour: "numeric", minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        </div>

        {hasRecording && call.id && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Recording</p>
            <AudioPlayer src={`/api/call-logs/${call.id}/recording`} />
          </div>
        )}

        {hasSummary && (
          <div className="space-y-3">
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
          </div>
        )}

        {call.transcription && (
          <>
            <Separator className="bg-border" />
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Transcript
              </p>
              <div className="p-3 bg-background border border-border rounded-lg font-mono text-xs max-h-[240px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                {call.transcription}
              </div>
            </div>
          </>
        )}

        {call.notes && (
          <>
            <Separator className="bg-border" />
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                <FileText className="h-3 w-3" /> Notes
              </p>
              <div className="p-3 bg-background border border-border rounded-lg text-sm whitespace-pre-wrap">
                {call.notes}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

type TabId = "needs-help" | "appointments";

function formatDuration(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function LeadCard({ call, companyName, onClick }: { call: any; companyName?: string; onClick: () => void }) {
  const displayName =
    [call.callerName, call.contactName, call.callerIdName].find(n => n && n !== "null" && n !== "undefined") ?? null;
  const hasRecording = !!(call.recordingSid || call.recordingUrl);

  return (
    <div
      className="group flex flex-col gap-3 p-4 border border-border rounded-lg bg-card hover:border-primary/40 hover:bg-muted/20 cursor-pointer transition-all"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="shrink-0 h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
            <PhoneIncoming className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            {displayName ? (
              <>
                <p className="font-medium text-sm text-foreground truncate">{displayName}</p>
                <p className="font-mono text-xs text-muted-foreground mt-0.5">{formatPhone(call.fromNumber)}</p>
              </>
            ) : (
              <p className="font-mono text-sm font-medium">{formatPhone(call.fromNumber)}</p>
            )}
            {companyName && (
              <p className="text-xs text-primary/80 flex items-center gap-1 mt-0.5 font-medium">
                <Building2 className="h-3 w-3 shrink-0" />
                {companyName}
              </p>
            )}
            {call.callerEmail && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <Mail className="h-3 w-3 shrink-0" />
                {call.callerEmail}
              </p>
            )}
            {call.callerLocation && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3 shrink-0" />
                {call.callerLocation}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <CallTypeBadge type={call.callType} />
          <PriorityBadge priority={call.priority} />
        </div>
      </div>

      {call.callSummary && (
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 pl-12">
          {call.callSummary}
        </p>
      )}

      {call.actionRequired && (
        <div className="ml-12 px-3 py-2 rounded-md bg-primary/5 border border-primary/20 text-xs text-primary">
          <span className="font-medium uppercase tracking-wide text-[10px]">Action: </span>
          {call.actionRequired}
        </div>
      )}

      <div className="flex items-center gap-4 pl-12 text-xs text-muted-foreground">
        <span>
          {new Date(call.createdAt).toLocaleString("en-US", {
            timeZone: "America/New_York",
            month: "short", day: "numeric",
            hour: "numeric", minute: "2-digit",
          })}
        </span>
        {call.duration ? <span>{formatDuration(call.duration)}</span> : null}
        {hasRecording && (
          <span className="flex items-center gap-1 text-primary">
            <Play className="h-3 w-3" /> Recording
          </span>
        )}
      </div>
    </div>
  );
}

export default function Leads() {
  const [activeTab, setActiveTab] = useState<TabId>("needs-help");
  const [selectedCall, setSelectedCall] = useState<any>(null);

  const { data: calls, isLoading } = useListCallLogs({ limit: 200 });
  const { data: phoneNumbers } = useListPhoneNumbers();
  const { data: companies } = useListCompanies();

  // Normalize to E.164 digits-only key for reliable matching
  const normPhone = (n: string) => n.replace(/\D/g, "");

  // Read company filter from URL
  const urlCompanyId = useMemo(() => {
    const p = new URLSearchParams(window.location.search).get("companyId");
    return p ? parseInt(p, 10) : undefined;
  }, []);

  const filterCompanyName = useMemo(
    () => urlCompanyId && companies ? (companies.find(c => c.id === urlCompanyId)?.name ?? null) : null,
    [urlCompanyId, companies]
  );

  // Set of normalized phone numbers belonging to the filtered company
  const companyNumbers = useMemo(() => {
    if (!urlCompanyId || !phoneNumbers) return null;
    return new Set(
      phoneNumbers
        .filter(pn => pn.companyId === urlCompanyId)
        .map(pn => normPhone(pn.number))
    );
  }, [urlCompanyId, phoneNumbers]);

  // Build normalized-toNumber → company name lookup
  const companyByToNumber = useMemo(() => {
    const map: Record<string, string> = {};
    if (!phoneNumbers || !companies) return map;
    const companyMap = new Map(companies.map(c => [c.id, c.name]));
    for (const pn of phoneNumbers) {
      if (pn.companyId && pn.number) {
        const name = companyMap.get(pn.companyId);
        if (name) map[normPhone(pn.number)] = name;
      }
    }
    return map;
  }, [phoneNumbers, companies]);

  // Apply company filter if active
  const filteredCalls = useMemo(() => {
    if (!calls) return [];
    if (!companyNumbers) return calls;
    return calls.filter(c => c.toNumber && companyNumbers.has(normPhone(c.toNumber)));
  }, [calls, companyNumbers]);

  const needsHelp = filteredCalls.filter(
    (c) => c.callType === "Emergency" || c.priority === "High"
  );

  const appointments = filteredCalls.filter(
    (c) => c.callType === "Appointment"
  );

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "needs-help",   label: "Needs Help",  count: needsHelp.length },
    { id: "appointments", label: "Appointments", count: appointments.length },
  ];

  const visibleCalls = activeTab === "needs-help" ? needsHelp : appointments;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Leads</h1>
        <p className="text-muted-foreground mt-1">
          Inbound calls classified as high-priority or appointment requests by the AI.
        </p>
        {filterCompanyName && (
          <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 border border-primary/20 text-xs font-medium text-primary">
            <Building2 className="h-3 w-3" />
            Filtered: {filterCompanyName}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`ml-2 text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.id
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-[120px] w-full rounded-lg" />
          ))}
        </div>
      ) : visibleCalls.length === 0 ? (
        <Card className="border-border">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            {activeTab === "needs-help" ? (
              <>
                <AlertCircle className="h-10 w-10 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground font-medium">No high-priority calls</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Emergency calls and High-priority inbound calls will appear here.
                </p>
              </>
            ) : (
              <>
                <CalendarDays className="h-10 w-10 text-muted-foreground/30 mb-4" />
                <p className="text-muted-foreground font-medium">No appointment requests</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Calls classified as Appointments by the AI will appear here.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleCalls.map((call) => (
            <LeadCard
              key={call.id}
              call={call}
              companyName={call.toNumber ? companyByToNumber[normPhone(call.toNumber)] : undefined}
              onClick={() => setSelectedCall(call)}
            />
          ))}
        </div>
      )}

      <LeadDetail
        call={selectedCall}
        companyName={selectedCall?.toNumber ? companyByToNumber[normPhone(selectedCall.toNumber)] : undefined}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
      />
    </div>
  );
}
