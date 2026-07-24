import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSmsMessages,
  useListPhoneNumbers,
  useListCompanies,
  useSendSms,
  getListSmsMessagesQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronLeft, ChevronRight, Image, MessageSquare, Phone, Search, Send } from "lucide-react";
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

function formatLineLabel(lineName: string | null | undefined, lineNumber: string): string {
  const formattedNumber = formatPhone(lineNumber);
  if (!lineName) return formattedNumber;
  const nameDigits = lineName.replace(/\D/g, "");
  const numberDigits = lineNumber.replace(/\D/g, "");
  return nameDigits && nameDigits === numberDigits ? formattedNumber : `${lineName} · ${formattedNumber}`;
}

const ET = "America/New_York";

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return date.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return date.toLocaleDateString("en-US", { timeZone: ET, weekday: "short" });
  return date.toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" });
}

function formatFull(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface Conversation {
  contactNumber: string;
  lineNumber: string;
  lineName: string | null;
  lastBody: string;
  lastAt: string;
  unread: number;
}

function buildConversations(messages: any[]): Conversation[] {
  const map = new Map<string, Conversation>();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    const lineNumber: string = message.lineNumber ?? message.to ?? message.from ?? "";
    const contactNumber: string = message.direction === "inbound" ? message.from : message.to;
    if (!lineNumber || !contactNumber) continue;
    const key = `${lineNumber}::${contactNumber}`;
    map.set(key, {
      contactNumber,
      lineNumber,
      lineName: message.lineName ?? null,
      lastBody: message.body ?? "",
      lastAt: message.createdAt,
      unread: Number(message.unread ?? 0),
    });
  }
  return Array.from(map.values()).sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());
}

export default function Messages() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterNumberId, setFilterNumberId] = useState<string>("all");
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [replyText, setReplyText] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLInputElement>(null);

  const scopedCompanyId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("companyId");
    return value ? Number(value) : null;
  }, []);

  const { data: companies = [] } = useListCompanies();
  const scopedCompany = scopedCompanyId ? companies.find(company => company.id === scopedCompanyId) : null;
  const { data: allNumbers = [] } = useListPhoneNumbers();
  const numbers = scopedCompanyId !== null
    ? allNumbers.filter(number => Number((number as any).companyId) === scopedCompanyId)
    : allNumbers;
  const { data: allMessages = [], isLoading } = useListSmsMessages({ limit: 500 });
  const { mutateAsync: sendSms, isPending: sending } = useSendSms();

  const companyLineNumbers = useMemo(() => new Set(numbers.map(number => number.number)), [numbers]);
  const noCompanyLines = scopedCompanyId !== null && numbers.length === 0;

  const conversations = useMemo(() => buildConversations(allMessages).filter(conversation => {
    if (scopedCompanyId !== null && !companyLineNumbers.has(conversation.lineNumber)) return false;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query ||
      formatPhone(conversation.contactNumber).toLowerCase().includes(query) ||
      conversation.contactNumber.toLowerCase().includes(query) ||
      conversation.lastBody.toLowerCase().includes(query) ||
      String(conversation.lineName ?? "").toLowerCase().includes(query);
    const selectedNumber = numbers.find(number => String(number.id) === filterNumberId)?.number;
    const matchesNumber = filterNumberId === "all" || selectedNumber === conversation.lineNumber;
    return matchesSearch && matchesNumber;
  }), [allMessages, companyLineNumbers, filterNumberId, numbers, scopedCompanyId, search]);

  const threadMessages = useMemo(() => selected
    ? allMessages
        .filter(message => {
          const lineNumber = message.lineNumber ?? message.to ?? message.from ?? "";
          const contact = message.direction === "inbound" ? message.from : message.to;
          return lineNumber === selected.lineNumber && contact === selected.contactNumber;
        })
        .slice()
        .reverse()
    : [], [allMessages, selected]);

  useEffect(() => {
    if (!selected && conversations.length === 1 && window.innerWidth >= 768) setSelected(conversations[0]);
  }, [conversations, selected]);

  useEffect(() => {
    if (!selected) return;
    requestAnimationFrame(() => {
      if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
    });
  }, [threadMessages.length, selected]);

  useEffect(() => {
    if (selected && window.innerWidth >= 768) replyRef.current?.focus();
  }, [selected]);

  const handleSend = useCallback(async () => {
    const body = replyText.trim();
    if (!selected || !body) return;
    try {
      await sendSms({ data: { from: selected.lineNumber, to: selected.contactNumber, body } });
      setReplyText("");
      await queryClient.invalidateQueries({ queryKey: getListSmsMessagesQueryKey() });
      requestAnimationFrame(() => replyRef.current?.focus());
    } catch (error: any) {
      toast({ title: "Message not sent", description: error?.message || "Please try again.", variant: "destructive" });
    }
  }, [queryClient, replyText, selected, sendSms, toast]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex min-h-0 flex-col gap-4 pb-24 sm:pb-6 md:h-[calc(100dvh-7.5rem)]">
      <header className="flex flex-shrink-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {scopedCompany && (
            <div className="mb-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="truncate">{scopedCompany.name}</span>
              <span className="text-muted-foreground/40">/</span>
              <span className="font-medium text-foreground">Messages</span>
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Messages</h1>
          <p className="mt-1 text-sm text-muted-foreground">SMS conversations on {scopedCompany ? `${scopedCompany.name}'s lines` : "all connected lines"}.</p>
        </div>
        {!selected && conversations.length > 0 && (
          <div className="font-mono text-xs text-muted-foreground sm:text-sm">{conversations.length} conversation{conversations.length === 1 ? "" : "s"}</div>
        )}
      </header>

      {noCompanyLines && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300">
          <div className="font-semibold">No phone line is connected to {scopedCompany?.name}.</div>
          <div className="mt-1 text-xs text-amber-300/75">Connect a phone line before this company can send or receive SMS messages.</div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <Card className={`${selected ? "hidden md:flex md:w-[320px] lg:w-[360px]" : "flex w-full"} min-h-[480px] flex-col overflow-hidden border-border md:min-h-0 md:flex-shrink-0`}>
          <div className="flex-shrink-0 space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search conversations..." value={search} onChange={event => setSearch(event.target.value)} className="min-h-11 bg-background pl-9 text-sm md:min-h-10" />
            </div>
            <Select value={filterNumberId} onValueChange={setFilterNumberId}>
              <SelectTrigger className="min-h-11 bg-background text-xs md:min-h-10"><SelectValue placeholder="All phone lines" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All phone lines</SelectItem>
                {numbers.map(number => <SelectItem key={number.id} value={String(number.id)}>{number.friendlyName || formatPhone(number.number)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <CardContent className="min-h-0 flex-1 overflow-y-auto p-0">
            {isLoading ? (
              <div className="divide-y divide-border">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="flex gap-3 p-4"><Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-32" /><Skeleton className="h-3 w-full" /></div></div>)}</div>
            ) : conversations.length === 0 ? (
              <div className="flex h-full min-h-[360px] flex-col items-center justify-center gap-3 px-6 text-center text-muted-foreground">
                <MessageSquare className="h-10 w-10 opacity-30" />
                <p className="text-sm font-medium">No conversations found</p>
                <p className="text-xs opacity-70">{search ? "Try a different search." : noCompanyLines ? "Connect a phone line first." : "Incoming and outgoing SMS conversations will appear here."}</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {conversations.map(conversation => {
                  const active = selected?.contactNumber === conversation.contactNumber && selected?.lineNumber === conversation.lineNumber;
                  return (
                    <button key={`${conversation.lineNumber}::${conversation.contactNumber}`} onClick={() => setSelected(conversation)} className={`flex min-h-[76px] w-full gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/20 active:bg-secondary/30 ${active ? "border-l-2 border-primary bg-primary/10" : ""}`}>
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Phone className="h-4 w-4" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{formatPhone(conversation.contactNumber)}</span>
                          <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground sm:text-[11px]">{formatTime(conversation.lastAt)}</span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">{conversation.lastBody || "Media message"}</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="truncate text-[10px] text-muted-foreground/60">via {formatLineLabel(conversation.lineName, conversation.lineNumber)}</p>
                          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/40 md:hidden" />
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {selected ? (
          <Card className="flex min-h-[520px] min-w-0 flex-1 flex-col overflow-hidden border-border md:min-h-0">
            <div className="flex min-h-16 flex-shrink-0 items-center gap-3 border-b border-border px-3 py-3 sm:px-4">
              <Button variant="ghost" size="icon" className="h-11 w-11 flex-shrink-0 md:hidden" onClick={() => setSelected(null)} aria-label="Back to conversations"><ChevronLeft className="h-5 w-5" /></Button>
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Phone className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-foreground">{formatPhone(selected.contactNumber)}</p><p className="truncate text-xs text-muted-foreground">{formatLineLabel(selected.lineName, selected.lineNumber)}</p></div>
              <Badge variant="outline" className="flex-shrink-0 border-primary/30 text-[10px] text-primary">SMS</Badge>
            </div>

            <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-background/30 px-3 py-4 sm:px-5">
              {threadMessages.length === 0 ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No messages in this conversation</div> : threadMessages.map(message => {
                const outbound = message.direction === "outbound";
                return (
                  <div key={message.id} className={`flex flex-col gap-1 ${outbound ? "items-end" : "items-start"}`}>
                    <div className={`max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed sm:max-w-[75%] ${outbound ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-secondary text-foreground"}`}>
                      {message.body}
                      {(message.mediaUrls?.length ?? 0) > 0 && <div className="mt-2 flex flex-col gap-1">{message.mediaUrls!.map((url: string, index: number) => <a key={index} href={url} target="_blank" rel="noreferrer" className={`flex min-h-8 items-center gap-1 text-xs underline underline-offset-2 ${outbound ? "text-primary-foreground/80" : "text-primary"}`}><Image className="h-3 w-3" />Open media {index + 1}</a>)}</div>}
                    </div>
                    <span className="px-1 text-[10px] text-muted-foreground">{formatFull(message.createdAt)}</span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-shrink-0 gap-2 border-t border-border bg-card px-3 py-3 pb-[max(.75rem,env(safe-area-inset-bottom))] sm:px-4">
              <Input ref={replyRef} placeholder={`Reply to ${formatPhone(selected.contactNumber)}…`} value={replyText} onChange={event => setReplyText(event.target.value)} onKeyDown={handleKeyDown} className="min-h-11 min-w-0 flex-1 bg-background text-base sm:text-sm" disabled={sending || noCompanyLines} />
              <Button onClick={handleSend} disabled={!replyText.trim() || sending || noCompanyLines} size="icon" className="h-11 w-11 flex-shrink-0" aria-label="Send message"><Send className="h-4 w-4" /></Button>
            </div>
          </Card>
        ) : (
          <Card className="hidden min-w-0 flex-1 items-center justify-center border-border text-muted-foreground md:flex"><div className="flex flex-col items-center gap-3 text-center"><MessageSquare className="h-10 w-10 opacity-30" /><p className="text-sm font-medium">Select a conversation</p><p className="text-xs opacity-70">Choose a customer from the inbox to view and reply.</p></div></Card>
        )}
      </div>
    </div>
  );
}
