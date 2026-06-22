import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSmsMessages,
  useListPhoneNumbers,
  useSendSms,
  getListSmsMessagesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, Search, Send, ChevronLeft, Image, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "Unknown";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    const d = digits.slice(1);
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return raw;
}

const ET = "America/New_York";

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString("en-US", { timeZone: ET, hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short" });
  return d.toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" });
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: ET, hour: "2-digit", minute: "2-digit" });
}

interface Conversation {
  contactNumber: string;
  lineNumber: string;
  lineName: string | null;
  lastBody: string;
  lastAt: string;
  unread: number;
}

// Derive unique conversations from flat message list
function buildConversations(messages: any[]): Conversation[] {
  const map = new Map<string, Conversation>();
  // messages come newest-first; iterate in reverse so last write = newest
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const lineNum: string = m.lineNumber ?? m.to ?? m.from ?? "";
    const contactNum: string = m.direction === "inbound" ? m.from : m.to;
    const key = `${lineNum}::${contactNum}`;
    map.set(key, {
      contactNumber: contactNum,
      lineNumber: lineNum,
      lineName: m.lineName ?? null,
      lastBody: m.body,
      lastAt: m.createdAt,
      unread: 0,
    });
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

export default function Messages() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterNumberId, setFilterNumberId] = useState<string>("all");
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);

  const scopedCompanyId = (() => {
    const v = new URLSearchParams(window.location.search).get("companyId");
    return v ? parseInt(v, 10) : null;
  })();

  const { data: allNumbers } = useListPhoneNumbers();
  const numbers = scopedCompanyId !== null
    ? allNumbers?.filter(n => (n as any).companyId === scopedCompanyId)
    : allNumbers;
  const { data: allMessages, isLoading } = useListSmsMessages({ limit: 500 });
  const { mutateAsync: sendSms, isPending: sending } = useSendSms();

  // Thread messages for selected conversation (chronological order)
  const threadMessages = selected
    ? (allMessages ?? [])
        .filter(m => {
          const lineNum = m.lineNumber ?? m.to ?? m.from ?? "";
          const contact = m.direction === "inbound" ? m.from : m.to;
          return lineNum === selected.lineNumber && contact === selected.contactNumber;
        })
        .slice()
        .reverse()
    : [];

  // Scroll to bottom when thread opens or new messages arrive
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [threadMessages.length, selected]);

  const companyLineNumbers = new Set(numbers?.map(n => n.number) ?? []);

  const conversations = buildConversations(allMessages ?? []).filter(c => {
    if (scopedCompanyId !== null && !companyLineNumbers.has(c.lineNumber)) return false;
    const matchSearch = !search ||
      formatPhone(c.contactNumber).includes(search) ||
      c.contactNumber.includes(search) ||
      c.lastBody.toLowerCase().includes(search.toLowerCase());
    const matchNumber = filterNumberId === "all" || numbers?.find(n => String(n.id) === filterNumberId)?.number === c.lineNumber;
    return matchSearch && matchNumber;
  });

  const handleSend = useCallback(async () => {
    if (!selected || !replyText.trim()) return;
    try {
      await sendSms({ data: { from: selected.lineNumber, to: selected.contactNumber, body: replyText.trim() } });
      setReplyText("");
      qc.invalidateQueries({ queryKey: getListSmsMessagesQueryKey() });
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message, variant: "destructive" });
    }
  }, [selected, replyText, sendSms, qc, toast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
          <p className="text-sm text-muted-foreground mt-0.5">SMS conversations on your lines</p>
        </div>
        {!selected && conversations.length > 0 && (
          <div className="text-sm text-muted-foreground font-mono">{conversations.length} conversation{conversations.length !== 1 ? "s" : ""}</div>
        )}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* ── Conversations list ── */}
        <Card className={`border-border flex flex-col flex-shrink-0 ${selected ? "w-72 hidden md:flex" : "flex-1"}`}>
          <div className="p-3 border-b border-border space-y-2 flex-shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-8 text-sm" />
            </div>
            <Select value={filterNumberId} onValueChange={setFilterNumberId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All numbers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All numbers</SelectItem>
                {numbers?.map(n => (
                  <SelectItem key={n.id} value={String(n.id)}>{n.friendlyName || n.number}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <CardContent className="p-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="divide-y divide-border">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex gap-3 p-4">
                    <Skeleton className="h-9 w-9 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-48" /></div>
                  </div>
                ))}
              </div>
            ) : conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <MessageSquare className="h-10 w-10 opacity-30" />
                <p className="text-sm">No conversations yet</p>
                <p className="text-xs opacity-60">Text your number to start</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {conversations.map(c => {
                  const isActive = selected?.contactNumber === c.contactNumber && selected?.lineNumber === c.lineNumber;
                  return (
                    <button
                      key={`${c.lineNumber}::${c.contactNumber}`}
                      onClick={() => setSelected(c)}
                      className={`w-full text-left flex gap-3 px-4 py-3.5 hover:bg-secondary/20 transition-colors ${isActive ? "bg-primary/10 border-l-2 border-primary" : ""}`}
                    >
                      <div className="h-9 w-9 rounded-full bg-secondary flex items-center justify-center flex-shrink-0 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="text-sm font-medium text-foreground truncate">{formatPhone(c.contactNumber)}</span>
                          <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0">{formatTime(c.lastAt)}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{c.lastBody}</p>
                        {c.lineName && <p className="text-[10px] text-muted-foreground/60 mt-0.5">via {c.lineName}</p>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Thread view ── */}
        {selected ? (
          <Card className="border-border flex-1 flex flex-col min-h-0">
            {/* Thread header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
              <Button variant="ghost" size="icon" className="h-7 w-7 md:hidden" onClick={() => setSelected(null)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center text-muted-foreground flex-shrink-0">
                <Phone className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{formatPhone(selected.contactNumber)}</p>
                <p className="text-xs text-muted-foreground">{selected.lineName ? `${selected.lineName} · ` : ""}{formatPhone(selected.lineNumber)}</p>
              </div>
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">SMS</Badge>
            </div>

            {/* Messages */}
            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {threadMessages.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No messages in this thread</div>
              ) : threadMessages.map(m => {
                const isOutbound = m.direction === "outbound";
                return (
                  <div key={m.id} className={`flex flex-col gap-1 ${isOutbound ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                      isOutbound
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-secondary text-foreground rounded-bl-sm"
                    }`}>
                      {m.body}
                      {(m.mediaUrls?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-col gap-1">
                          {m.mediaUrls!.map((url: string, i: number) => (
                            <a key={i} href={url} target="_blank" rel="noreferrer"
                              className={`flex items-center gap-1 text-xs underline underline-offset-2 ${isOutbound ? "text-primary-foreground/80" : "text-primary"}`}>
                              <Image className="h-3 w-3" />Media {i + 1}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground px-1">{formatFull(m.createdAt)}</span>
                  </div>
                );
              })}
            </div>

            {/* Reply box */}
            <div className="border-t border-border px-4 py-3 flex gap-2 flex-shrink-0">
              <Input
                placeholder={`Reply to ${formatPhone(selected.contactNumber)}…`}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={handleKeyDown}
                className="text-sm flex-1"
                disabled={sending}
              />
              <Button
                onClick={handleSend}
                disabled={!replyText.trim() || sending}
                size="icon"
                className="flex-shrink-0"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </Card>
        ) : (
          <Card className="border-border flex-1 hidden md:flex items-center justify-center text-muted-foreground">
            <div className="flex flex-col items-center gap-3">
              <MessageSquare className="h-10 w-10 opacity-30" />
              <p className="text-sm">Select a conversation</p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
