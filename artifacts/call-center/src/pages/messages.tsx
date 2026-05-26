import { useState } from "react";
import { useListSmsMessages, useListPhoneNumbers } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquare, Search, PhoneIncoming, PhoneOutgoing, Image } from "lucide-react";

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Messages() {
  const [search, setSearch] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState<string>("all");
  const [direction, setDirection] = useState<string>("all");

  const { data: numbers } = useListPhoneNumbers();
  const { data: messages, isLoading } = useListSmsMessages({
    phoneNumberId: phoneNumberId !== "all" ? Number(phoneNumberId) : undefined,
    direction: direction !== "all" ? direction : undefined,
    search: search || undefined,
    limit: 200,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Inbound SMS to your numbers</p>
        </div>
        {messages && (
          <div className="text-sm text-muted-foreground font-mono">
            {messages.length} message{messages.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search messages..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={phoneNumberId} onValueChange={setPhoneNumberId}>
          <SelectTrigger className="w-44 h-9 text-sm">
            <SelectValue placeholder="All numbers" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All numbers</SelectItem>
            {numbers?.map(n => (
              <SelectItem key={n.id} value={String(n.id)}>
                {n.friendlyName || n.number}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger className="w-36 h-9 text-sm">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Messages list */}
      <Card className="border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex gap-4 p-4">
                  <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-64" />
                  </div>
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          ) : !messages || messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm">No messages yet</p>
              <p className="text-xs opacity-60">SMS sent to your numbers will appear here</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {messages.map(msg => (
                <div key={msg.id} className="flex items-start gap-4 px-4 py-3.5 hover:bg-secondary/20 transition-colors">
                  {/* Direction icon */}
                  <div className={`mt-0.5 h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.direction === "inbound"
                      ? "bg-primary/10 text-primary"
                      : "bg-secondary text-muted-foreground"
                  }`}>
                    {msg.direction === "inbound"
                      ? <PhoneIncoming className="h-3.5 w-3.5" />
                      : <PhoneOutgoing className="h-3.5 w-3.5" />
                    }
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-medium text-foreground">
                        {msg.direction === "inbound" ? formatPhone(msg.from) : formatPhone(msg.to)}
                      </span>
                      {msg.lineName && (
                        <span className="text-xs text-muted-foreground">
                          via {msg.lineName}
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 h-4 ${
                          msg.direction === "inbound"
                            ? "border-primary/30 text-primary"
                            : "border-muted text-muted-foreground"
                        }`}
                      >
                        {msg.direction}
                      </Badge>
                      {(msg.numMedia ?? 0) > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-muted text-muted-foreground gap-1">
                          <Image className="h-2.5 w-2.5" />
                          {msg.numMedia}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate leading-snug">
                      {msg.body}
                    </p>
                    {(msg.mediaUrls?.length ?? 0) > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {msg.mediaUrls!.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <Image className="h-3 w-3" />
                            Media {i + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Time */}
                  <div className="text-xs text-muted-foreground flex-shrink-0 pt-0.5 font-mono">
                    {formatTime(msg.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
