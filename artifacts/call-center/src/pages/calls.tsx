import { useState } from "react";
import { useListCallLogs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneIncoming, PhoneOutgoing, Play, FileText, Search, User, Mail, Tag, AlertCircle, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

function RecordingPlayer({ callId, hasRecording }: { callId: number; hasRecording: boolean }) {
  if (!hasRecording) return <span className="text-muted-foreground text-xs">--</span>;
  return <audio controls src={`/api/call-logs/${callId}/recording`} className="h-8 w-[180px]" />;
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span className="font-mono">{call?.fromNumber}</span>
            {call?.priority && <PriorityBadge priority={call.priority} />}
          </DialogTitle>
        </DialogHeader>

        {hasSummary && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
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
              {call.callType && (
                <div className="flex items-center gap-2 p-3 bg-background border border-border rounded-lg">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground">Call Type</p>
                    <p className="text-sm font-medium">{call.callType}</p>
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
            </div>

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

        {!hasSummary && !call?.transcription && (
          <p className="text-sm text-muted-foreground text-center py-4">No summary available for this call.</p>
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
                <TableCell className="font-mono text-xs">{call.fromNumber}</TableCell>
                <TableCell className="text-sm">
                  {call.callerName ? (
                    <span className="font-medium">{call.callerName}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">--</span>
                  )}
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
                  <RecordingPlayer callId={call.id} hasRecording={!!(call.recordingSid || call.recordingUrl)} />
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
