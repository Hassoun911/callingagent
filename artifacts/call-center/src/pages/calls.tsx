import { useState } from "react";
import { useListCallLogs, useGetRecordingUrl } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PhoneIncoming, PhoneOutgoing, Play, FileText, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "react-day-picker";

function RecordingPlayer({ callId }: { callId: number }) {
  const { data, isLoading } = useGetRecordingUrl(callId, { query: { enabled: true } });
  
  if (isLoading) return <Skeleton className="h-8 w-24" />;
  if (!data?.url) return <span className="text-muted-foreground text-xs">No recording</span>;
  
  return (
    <audio controls src={data.url} className="h-8 w-[200px]" />
  );
}

export default function Calls() {
  const [direction, setDirection] = useState<"inbound" | "outbound" | "all">("all");
  const [status, setStatus] = useState<string>("all");
  
  const { data: calls, isLoading } = useListCallLogs({
    direction: direction === "all" ? undefined : direction,
    status: status === "all" ? undefined : status,
    limit: 100
  });

  const [selectedCall, setSelectedCall] = useState<any>(null);

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Call Logs</h1>
          <p className="text-muted-foreground mt-1">Audit log of all communications.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 bg-card/50 p-4 border border-border rounded-lg">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search numbers..." 
              className="pl-9 bg-background"
            />
          </div>
        </div>
        <Select value={direction} onValueChange={(v: any) => setDirection(v)}>
          <SelectTrigger className="w-[180px] bg-background">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Directions</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px] bg-background">
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
              <TableHead className="w-[180px]">Date</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Recording</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-20 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                </TableRow>
              ))
            ) : calls?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  No call logs found.
                </TableCell>
              </TableRow>
            ) : calls?.map((call) => (
              <TableRow key={call.id} className="border-border">
                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(call.createdAt).toLocaleString(undefined, { 
                    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
                  })}
                </TableCell>
                <TableCell>
                  {call.direction === 'inbound' ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 gap-1">
                      <PhoneIncoming className="h-3 w-3" /> Inbound
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20 gap-1">
                      <PhoneOutgoing className="h-3 w-3" /> Outbound
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-sm">{call.fromNumber}</TableCell>
                <TableCell className="font-mono text-sm">{call.toNumber}</TableCell>
                <TableCell className="font-mono text-sm text-muted-foreground">
                  {call.duration ? formatDuration(call.duration) : '--:--'}
                </TableCell>
                <TableCell>
                  <Badge variant={call.status === 'completed' ? 'default' : 'secondary'} className="capitalize bg-opacity-20 text-xs">
                    {call.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {call.recordingUrl ? (
                      <RecordingPlayer callId={call.id} />
                    ) : (
                      <span className="text-xs text-muted-foreground">--</span>
                    )}
                    {call.transcription && (
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => setSelectedCall(call)}>
                        <FileText className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!selectedCall} onOpenChange={(open) => !open && setSelectedCall(null)}>
        <DialogContent className="sm:max-w-xl bg-card border-border">
          <DialogHeader>
            <DialogTitle>Call Transcript</DialogTitle>
          </DialogHeader>
          <div className="mt-4 p-4 bg-background border border-border rounded-lg font-mono text-sm max-h-[400px] overflow-y-auto whitespace-pre-wrap">
            {selectedCall?.transcription}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
