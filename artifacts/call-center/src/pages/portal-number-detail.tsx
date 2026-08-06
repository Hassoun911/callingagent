import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListPhoneNumbersQueryKey,
  useGetPhoneNumberTwilioStatus,
  useListPhoneNumbers,
  useTestCall,
  useUpdatePhoneNumber,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Loader2,
  Mail,
  Phone,
  PhoneCall,
  PhoneForwarded,
  Save,
  ShieldCheck,
  Voicemail,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

type PortalNumberDetailProps = {
  companyId: number;
};

type NumberForm = {
  friendlyName: string;
  callerIdName: string;
  answerMode: string;
  forwardTo: string;
  ringCount: number;
  forwardCallerId: string;
  forwardNoAnswerAction: string;
  aiGreeting: string;
  aiSystemPrompt: string;
  aiVoice: string;
  aiLanguage: string;
  voicemailGreeting: string;
  notificationEmail: string;
};

const EMPTY_FORM: NumberForm = {
  friendlyName: "",
  callerIdName: "",
  answerMode: "forward",
  forwardTo: "",
  ringCount: 4,
  forwardCallerId: "caller",
  forwardNoAnswerAction: "personal_voicemail",
  aiGreeting: "",
  aiSystemPrompt: "",
  aiVoice: "",
  aiLanguage: "",
  voicemailGreeting: "",
  notificationEmail: "",
};

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return raw;
  return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
}

export default function PortalNumberDetail({ companyId }: PortalNumberDetailProps) {
  const { id } = useParams<{ id: string }>();
  const numberId = Number(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const numbersQuery = useListPhoneNumbers();
  const updateNumber = useUpdatePhoneNumber();
  const testCall = useTestCall();
  const twilio = useGetPhoneNumberTwilioStatus(numberId, {
    query: { enabled: Number.isInteger(numberId) && numberId > 0 },
  });
  const [form, setForm] = useState<NumberForm>(EMPTY_FORM);
  const [initializedId, setInitializedId] = useState<number | null>(null);
  const [testDestination, setTestDestination] = useState("");

  const number = useMemo(
    () => (numbersQuery.data ?? []).find(record => Number(record.id) === numberId && Number(record.companyId) === companyId),
    [companyId, numberId, numbersQuery.data],
  );

  useEffect(() => {
    if (!number || initializedId === numberId) return;
    setForm({
      friendlyName: number.friendlyName ?? "",
      callerIdName: number.callerIdName ?? "",
      answerMode: number.answerMode ?? "forward",
      forwardTo: number.forwardTo ?? "",
      ringCount: number.ringCount ?? 4,
      forwardCallerId: number.forwardCallerId ?? "caller",
      forwardNoAnswerAction: number.forwardNoAnswerAction ?? "personal_voicemail",
      aiGreeting: number.aiGreeting ?? "",
      aiSystemPrompt: number.aiSystemPrompt ?? "",
      aiVoice: number.aiVoice ?? "",
      aiLanguage: number.aiLanguage ?? "",
      voicemailGreeting: number.voicemailGreeting ?? "",
      notificationEmail: number.notificationEmail ?? "",
    });
    setInitializedId(numberId);
  }, [initializedId, number, numberId]);

  const save = () => {
    if (!number) return;
    updateNumber.mutate(
      {
        id: numberId,
        data: {
          ...form,
          forwardTo: form.forwardTo.trim() || null,
          aiGreeting: form.aiGreeting.trim() || null,
          aiSystemPrompt: form.aiSystemPrompt.trim() || null,
          aiVoice: form.aiVoice || null,
          aiLanguage: form.aiLanguage || null,
          voicemailGreeting: form.voicemailGreeting.trim() || null,
          notificationEmail: form.notificationEmail.trim() || null,
        } as any,
      },
      {
        onSuccess: async () => {
          await queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
          toast({ title: "Phone number saved", description: "The line configuration is now active." });
        },
        onError: (error: any) => {
          toast({ title: "Save failed", description: error?.message ?? "Could not update this line.", variant: "destructive" });
        },
      },
    );
  };

  const runTest = () => {
    const destination = form.answerMode === "forward" ? form.forwardTo.trim() : testDestination.trim();
    if (!destination) {
      toast({ title: "Enter a test destination", description: "Add the forwarding number or a phone to receive the test call.", variant: "destructive" });
      return;
    }
    testCall.mutate(
      { id: numberId, data: { toNumber: destination } },
      {
        onSuccess: () => toast({ title: "Test call started", description: `Calling ${formatPhone(destination)} now.` }),
        onError: (error: any) => toast({ title: "Test call failed", description: error?.message ?? "Could not place the test call.", variant: "destructive" }),
      },
    );
  };

  if (!Number.isInteger(numberId) || numberId <= 0) {
    return <div className="p-6 text-sm text-red-300">Invalid phone number.</div>;
  }

  if (numbersQuery.isPending) {
    return <div className="space-y-5 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-[560px] w-full rounded-xl" /></div>;
  }

  if (numbersQuery.isError) {
    return (
      <div className="m-6 rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-center">
        <p className="text-sm text-red-300">The company phone numbers could not be loaded.</p>
        <Button variant="outline" className="mt-4" onClick={() => void numbersQuery.refetch()}>Try again</Button>
      </div>
    );
  }

  if (!number) {
    return (
      <div className="m-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-6">
        <p className="font-semibold text-amber-200">This phone number is not assigned to your company.</p>
        <p className="mt-1 text-sm text-amber-200/70">Return to Phone Numbers and choose a line from your company list.</p>
        <Link href="/portal/numbers" className="mt-4 inline-flex items-center gap-2 rounded-md border border-amber-500/20 px-3 py-2 text-sm text-amber-200">
          <ArrowLeft className="h-4 w-4" /> Back to phone numbers
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link href="/portal/numbers" className="mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight">{number.friendlyName || formatPhone(number.number)}</h1>
              <Badge variant="outline" className="border-cyan-500/20 bg-cyan-500/10 text-cyan-300">{form.answerMode.replace(/_/g, " ")}</Badge>
            </div>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{formatPhone(number.number)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {form.answerMode !== "forward" && (
            <Input value={testDestination} onChange={event => setTestDestination(event.target.value)} placeholder="Test destination +1..." className="sm:w-52" />
          )}
          <Button variant="outline" onClick={runTest} disabled={testCall.isPending}>
            {testCall.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneCall className="mr-2 h-4 w-4" />}
            Test line
          </Button>
          <Button onClick={save} disabled={updateNumber.isPending}>
            {updateNumber.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save changes
          </Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-5 w-5 text-cyan-400" /> Call handling</CardTitle>
              <CardDescription>Choose how calls to this line are answered.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { value: "forward", label: "Forward", icon: PhoneForwarded },
                  { value: "ai_voice", label: "AI Agent", icon: Bot },
                  { value: "voicemail", label: "Voicemail", icon: Voicemail },
                  { value: "reject", label: "Reject", icon: Phone },
                ].map(option => {
                  const Icon = option.icon;
                  const active = form.answerMode === option.value;
                  return (
                    <button key={option.value} type="button" onClick={() => setForm(value => ({ ...value, answerMode: option.value }))}
                      className={`flex min-h-20 flex-col items-start justify-between rounded-xl border p-3 text-left transition ${active ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-border bg-background text-muted-foreground hover:bg-muted/40"}`}>
                      <Icon className="h-5 w-5" /><span className="text-sm font-semibold">{option.label}</span>
                    </button>
                  );
                })}
              </div>

              {form.answerMode === "forward" && (
                <div className="grid gap-4 border-t border-border pt-5 md:grid-cols-2">
                  <div className="space-y-2"><Label>Forward to</Label><Input value={form.forwardTo} onChange={event => setForm(value => ({ ...value, forwardTo: event.target.value }))} placeholder="+1 226 555 1234" /></div>
                  <div className="space-y-2"><Label>Ring count</Label><Input type="number" min={1} max={10} value={form.ringCount} onChange={event => setForm(value => ({ ...value, ringCount: Math.max(1, Math.min(10, Number(event.target.value) || 1)) }))} /></div>
                  <div className="space-y-2"><Label>Caller ID shown</Label><Select value={form.forwardCallerId} onValueChange={value => setForm(current => ({ ...current, forwardCallerId: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="caller">Original caller</SelectItem><SelectItem value="line">Company line</SelectItem></SelectContent></Select></div>
                  <div className="space-y-2"><Label>If unanswered</Label><Select value={form.forwardNoAnswerAction} onValueChange={value => setForm(current => ({ ...current, forwardNoAnswerAction: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="personal_voicemail">Forwarded phone voicemail</SelectItem><SelectItem value="voicemail">CallingAgent voicemail</SelectItem><SelectItem value="ai_voice">AI agent</SelectItem></SelectContent></Select></div>
                </div>
              )}

              {form.answerMode === "ai_voice" && (
                <div className="space-y-4 border-t border-border pt-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2"><Label>Greeting</Label><Input value={form.aiGreeting} onChange={event => setForm(value => ({ ...value, aiGreeting: event.target.value }))} placeholder="Thank you for calling..." /></div>
                    <div className="space-y-2"><Label>Language</Label><Select value={form.aiLanguage || "default"} onValueChange={value => setForm(current => ({ ...current, aiLanguage: value === "default" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Company default</SelectItem><SelectItem value="en-US">English</SelectItem><SelectItem value="ar-LB">Arabic (Lebanon)</SelectItem><SelectItem value="ar-SA">Arabic (Saudi)</SelectItem></SelectContent></Select></div>
                  </div>
                  <div className="space-y-2"><Label>AI instructions</Label><Textarea rows={8} value={form.aiSystemPrompt} onChange={event => setForm(value => ({ ...value, aiSystemPrompt: event.target.value }))} placeholder="Explain the business, services, hours, booking rules, and escalation instructions..." /></div>
                </div>
              )}

              {form.answerMode === "voicemail" && (
                <div className="space-y-2 border-t border-border pt-5"><Label>Voicemail greeting</Label><Textarea rows={4} value={form.voicemailGreeting} onChange={event => setForm(value => ({ ...value, voicemailGreeting: event.target.value }))} placeholder="Please leave your name, number, and reason for calling." /></div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Line identity</CardTitle><CardDescription>Names used inside the portal and during call handling.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Internal name</Label><Input value={form.friendlyName} onChange={event => setForm(value => ({ ...value, friendlyName: event.target.value }))} /></div>
              <div className="space-y-2"><Label>Display name</Label><Input value={form.callerIdName} maxLength={15} onChange={event => setForm(value => ({ ...value, callerIdName: event.target.value }))} /></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Notifications</CardTitle><CardDescription>Receive call summaries after calls complete.</CardDescription></CardHeader>
            <CardContent><Label>Notification email</Label><Input className="mt-2" type="email" value={form.notificationEmail} onChange={event => setForm(value => ({ ...value, notificationEmail: event.target.value }))} placeholder="manager@company.com" /></CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Line status</CardTitle><CardDescription>Current Twilio connection information.</CardDescription></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {twilio.isPending && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking line...</div>}
              {twilio.isError && <p className="text-amber-300">Twilio status is temporarily unavailable. The saved configuration can still be edited.</p>}
              {twilio.data && <><div className="flex items-center justify-between"><span className="text-muted-foreground">Status</span><span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Active</span></div><div className="flex items-center justify-between"><span className="text-muted-foreground">Webhook</span><span>{twilio.data.voiceUrl ? "Connected" : "Not configured"}</span></div></>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
