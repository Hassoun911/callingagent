import { useState, useRef, useEffect, useCallback } from "react";
import { useListCallLogs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneIncoming, PhoneOutgoing, Play, Pause, Search, User, Mail, Tag, AlertCircle, ChevronRight, Phone, Loader2, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

/** Format an E.164 number to a human-readable North American format.
 * +12267586681 → (226) 758-6681 · anything else returned as-is. */
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

// Global tracker so only one player plays at a time
const activeAudio = { current: null as HTMLAudioElement | null };

function AudioPlayer({ src, knownDuration = 0, large = false }: { src: string; knownDuration?: number; large?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState(false);

  // Use the audio-reported duration if available, else fall back to the known call duration
  const duration = audioDuration || knownDuration;

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "none"; // Load on demand only — preloading 100 rows causes too many requests
    audioRef.current = audio;
    audio.addEventListener("loadedmetadata", () => setAudioDuration(audio.duration));
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("ended", () => { setPlaying(false); setCurrentTime(0); });
    audio.addEventListener("error", () => { setError(true); setBuffering(false); });
    audio.addEventListener("waiting", () => setBuffering(true));
    audio.addEventListener("canplay", () => setBuffering(false));
    return () => { audio.pause(); audio.src = ""; };
  }, []);

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
      if (!audio.src) { audio.src = src; setBuffering(true); }
      audio.play().then(() => setPlaying(true)).catch(() => setError(true));
    }
  }, [playing, src]);

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

  // Compact table row variant — fixed 180px so table columns stay stable
  return (
    <div className="flex items-center gap-1.5" style={{ width: 180 }}>
      <button
        onClick={toggle}
        className="shrink-0 w-5 h-5 flex items-center justify-center rounded-full bg-muted hover:bg-muted/60 border border-border/60 transition-colors"
      >
        <Icon className={`h-2.5 w-2.5 ${Icon === Play ? "ml-px" : ""} ${Icon === Loader2 ? "animate-spin text-muted-foreground" : ""}`} />
      </button>

      <div ref={trackRef} onClick={seek} className="relative h-[3px] flex-1 bg-border rounded-full cursor-pointer group">
        <div className="absolute inset-y-0 left-0 bg-cyan-500 rounded-full transition-none" style={{ width: `${progress}%` }} />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-cyan-400 border border-background opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `calc(${progress}% - 4px)` }}
        />
      </div>

      <span className="text-[11px] font-mono text-muted-foreground tabular-nums shrink-0 text-right whitespace-nowrap">
        {playing || currentTime > 0
          ? <>{fmtTime(currentTime)}<span className="opacity-40"> / {fmtTime(duration)}</span></>
          : duration ? fmtTime(duration) : ""}
      </span>

      <a
        href={src}
        download
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Download recording"
      >
        <Download className="h-3 w-3" />
      </a>
    </div>
  );
}

function RecordingPlayer({ callId, hasRecording, duration }: { callId: number; hasRecording: boolean; duration?: number }) {
  if (!hasRecording) return <span className="text-muted-foreground text-xs">--</span>;
  return <AudioPlayer src={`/api/call-logs/${callId}/recording`} knownDuration={duration} />;
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

function CallDetail({ call, open, onClose }: { call: any; open: boolean; onClose: () => void }) {
  const hasSummary = call?.callSummary || call?.callerName || call?.callerEmail || call?.callType || call?.actionRequired;
  const hasRecording = !!(call?.recordingSid || call?.recordingUrl);

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

        {/* Always-visible caller metadata */}
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

        {/* Recording player */}
        {hasRecording && call?.id && (
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Recording</p>
            <AudioPlayer src={`/api/call-logs/${call.id}/recording`} knownDuration={call.duration ?? undefined} large />
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
      </DialogContent>
    </Dialog>
  );
}

export default function Calls() {
  const [search, setSearch] = useState("");
  const [direction, setDirection] = useState<"inbound" | "outbound" | "all">("all");
  const [status, setStatus] = useState<string>("all");
  const [selectedCall, setSelectedCall] = useState<any>(null);

  const { data: calls, isLoading } = useListCallLogs({
    direction: direction === "all" ? undefined : direction,
    status: status === "all" ? undefined : status,
    limit: 100,
  });

  const filtered = calls?.filter((c) => {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Call Logs</h1>
          <p className="text-muted-foreground mt-1">Audit log of all communications with AI-extracted summaries.</p>
        </div>
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

      <Card className="border-border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[150px]">Date / Time</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Caller</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Recording</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i} className="border-border">
                  {[...Array(10)].map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">
                  No call logs found.
                </TableCell>
              </TableRow>
            ) : filtered?.map((call) => (
              <TableRow
                key={call.id}
                className="border-border cursor-pointer hover:bg-muted/30 transition-colors"
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
                  <RecordingPlayer callId={call.id} hasRecording={!!(call.recordingSid || call.recordingUrl)} duration={call.duration ?? undefined} />
                </TableCell>
                <TableCell>
                  {hasSummaryData(call) && (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <CallDetail
        call={selectedCall}
        open={!!selectedCall}
        onClose={() => setSelectedCall(null)}
      />
    </div>
  );
}
