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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { DEFAULT_PORTAL_VISIBILITY, getPortalVisibility, type PortalVisibility } from "@/lib/portal-visibility";

type Props = { companyId: number };

type Form = {
  friendlyName: string;
  callerIdName: string;
  answerMode: string;
  forwardTo: string;
  ringCount: number;
  aiGreeting: string;
  aiSystemPrompt: string;
  aiLanguage: string;
  aiVoice: string;
  voicemailGreeting: string;
  notificationEmail: string;
};

const EMPTY: Form = {
  friendlyName: "",
  callerIdName: "",
  answerMode: "forward",
  forwardTo: "",
  ringCount: 4,
  aiGreeting: "",
  aiSystemPrompt: "",
  aiLanguage: "",
  aiVoice: "",
  voicemailGreeting: "",
  notificationEmail: "",
};

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return local.length === 10 ? `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}` : raw;
}

export default function PortalNumberDetailControlled({ companyId }: Props) {
  const { id } = useParams<{ id: string }>();
  const numberId = Number(id);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const numbers = useListPhoneNumbers();
  const update = useUpdatePhoneNumber();
  const testCall = useTestCall();
  const twilio = useGetPhoneNumberTwilioStatus(numberId, { query: { enabled: Number.isInteger(numberId) && numberId > 0 } });
  const [visibility, setVisibility] = useState<PortalVisibility>(DEFAULT_PORTAL_VISIBILITY);
  const [form, setForm] = useState<Form>(EMPTY);
  const [initialized, setInitialized] = useState<number | null>(null);
  const [testDestination, setTestDestination] = useState("");

  const number = useMemo(
    () => (numbers.data ?? []).find(item => Number(item.id) === numberId && Number(item.companyId) === companyId),
    [companyId, numberId, numbers.data],
  );

  useEffect(() => {
    void getPortalVisibility(companyId).then(setVisibility);
  }, [companyId]);

  useEffect(() => {
    if (!number || initialized === numberId) return;
    setForm({
      friendlyName: number.friendlyName ?? "",
      callerIdName: number.callerIdName ?? "",
      answerMode: number.answerMode ?? "forward",
      forwardTo: number.forwardTo ?? "",
      ringCount: number.ringCount ?? 4,
      aiGreeting: number.aiGreeting ?? "",
      aiSystemPrompt: number.aiSystemPrompt ?? "",
      aiLanguage: number.aiLanguage ?? "",
      aiVoice: number.aiVoice ?? "",
      voicemailGreeting: number.voicemailGreeting ?? "",
      notificationEmail: number.notificationEmail ?? "",
    });
    setInitialized(numberId);
  }, [initialized, number, numberId]);

  if (numbers.isPending) return <div className="space-y-5 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-[520px] w-full" /></div>;
  if (!number) return <div className="m-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-amber-200">This phone number is not assigned to your company.</div>;

  const p = visibility.phoneNumber;

  const save = () => {
    const data: Record<string, unknown> = {};
    if (p.lineIdentity) {
      data.friendlyName = form.friendlyName;
      data.callerIdName = form.callerIdName;
    }
    if (p.answerMode) data.answerMode = form.answerMode;
    if (p.forwarding) {
      data.forwardTo = form.forwardTo.trim() || null;
      data.ringCount = form.ringCount;
    }
    if (p.greeting) data.aiGreeting = form.aiGreeting.trim() || null;
    if (p.aiInstructions) data.aiSystemPrompt = form.aiSystemPrompt.trim() || null;
    if (p.language) data.aiLanguage = form.aiLanguage || null;
    if (p.voice) data.aiVoice = form.aiVoice || null;
    if (p.voicemailGreeting) data.voicemailGreeting = form.voicemailGreeting.trim() || null;
    if (p.notificationEmail) data.notificationEmail = form.notificationEmail.trim() || null;

    update.mutate({ id: numberId, data: data as any }, {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
        toast({ title: "Phone number saved", description: "Visible settings were updated. Main-admin settings remain unchanged." });
      },
      onError: (error: any) => toast({ title: "Save failed", description: error?.message ?? "Could not save this line.", variant: "destructive" }),
    });
  };

  const runTest = () => {
    const destination = testDestination.trim() || form.forwardTo.trim();
    if (!destination) {
      toast({ title: "Enter a test destination", variant: "destructive" });
      return;
    }
    testCall.mutate({ id: numberId, data: { toNumber: destination } }, {
      onSuccess: () => toast({ title: "Test call started" }),
      onError: (error: any) => toast({ title: "Test failed", description: error?.message, variant: "destructive" }),
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-3">
          <Link href="/portal/numbers" className="mt-1 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground"><ArrowLeft className="h-4 w-4" /></Link>
          <div><h1 className="text-2xl font-bold">{number.friendlyName || formatPhone(number.number)}</h1><p className="mt-1 font-mono text-sm text-muted-foreground">{formatPhone(number.number)}</p></div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {p.testCall && <><Input value={testDestination} onChange={event => setTestDestination(event.target.value)} placeholder="Test destination +1..." className="sm:w-52" /><Button variant="outline" onClick={runTest} disabled={testCall.isPending}>{testCall.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PhoneCall className="mr-2 h-4 w-4" />}Test line</Button></>}
          <Button onClick={save} disabled={update.isPending}>{update.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save changes</Button>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {(p.answerMode || p.forwarding) && <Card><CardHeader><CardTitle className="flex items-center gap-2"><PhoneForwarded className="h-5 w-5 text-cyan-400" />Call handling</CardTitle><CardDescription>Basic controls allowed by the main administrator.</CardDescription></CardHeader><CardContent className="space-y-5">
            {p.answerMode && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
              ["forward", "Forward", PhoneForwarded], ["ai_voice", "AI Agent", Bot], ["voicemail", "Voicemail", Voicemail], ["reject", "Reject", Phone],
            ].map(([value, label, Icon]: any) => <button key={value} type="button" onClick={() => setForm(current => ({ ...current, answerMode: value }))} className={`flex min-h-20 flex-col items-start justify-between rounded-xl border p-3 ${form.answerMode === value ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200" : "border-border bg-background text-muted-foreground"}`}><Icon className="h-5 w-5" /><span className="text-sm font-semibold">{label}</span></button>)}</div>}
            {p.forwarding && form.answerMode === "forward" && <div className="grid gap-4 border-t border-border pt-5 md:grid-cols-2"><div className="space-y-2"><Label>Forward to</Label><Input value={form.forwardTo} onChange={event => setForm(current => ({ ...current, forwardTo: event.target.value }))} /></div><div className="space-y-2"><Label>Ring count</Label><Input type="number" min={1} max={10} value={form.ringCount} onChange={event => setForm(current => ({ ...current, ringCount: Number(event.target.value) || 1 }))} /></div></div>}
          </CardContent></Card>}

          {(p.greeting || p.language || p.voice || p.aiInstructions) && form.answerMode === "ai_voice" && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-cyan-400" />AI Agent</CardTitle><CardDescription>Advanced hidden settings continue using the main-admin configuration.</CardDescription></CardHeader><CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              {p.greeting && <div className="space-y-2"><Label>Greeting</Label><Input value={form.aiGreeting} onChange={event => setForm(current => ({ ...current, aiGreeting: event.target.value }))} /></div>}
              {p.language && <div className="space-y-2"><Label>Language</Label><Select value={form.aiLanguage || "default"} onValueChange={value => setForm(current => ({ ...current, aiLanguage: value === "default" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">Company default</SelectItem><SelectItem value="en-US">English</SelectItem><SelectItem value="ar-LB">Arabic (Lebanon)</SelectItem></SelectContent></Select></div>}
              {p.voice && <div className="space-y-2"><Label>Voice override</Label><Input value={form.aiVoice} onChange={event => setForm(current => ({ ...current, aiVoice: event.target.value }))} placeholder="Leave blank for company default" /></div>}
            </div>
            {p.aiInstructions && <div className="space-y-2"><Label>AI instructions</Label><Textarea rows={10} value={form.aiSystemPrompt} onChange={event => setForm(current => ({ ...current, aiSystemPrompt: event.target.value }))} /></div>}
            {!p.aiInstructions && <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-200">AI behavior and full instructions are managed by the main administrator.</div>}
          </CardContent></Card>}

          {p.voicemailGreeting && form.answerMode === "voicemail" && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Voicemail className="h-5 w-5" />Voicemail</CardTitle></CardHeader><CardContent><Textarea rows={5} value={form.voicemailGreeting} onChange={event => setForm(current => ({ ...current, voicemailGreeting: event.target.value }))} placeholder="Leave blank for the company default greeting" /></CardContent></Card>}
        </div>

        <div className="space-y-6">
          {p.lineIdentity && <Card><CardHeader><CardTitle>Line identity</CardTitle></CardHeader><CardContent className="space-y-4"><div className="space-y-2"><Label>Internal name</Label><Input value={form.friendlyName} onChange={event => setForm(current => ({ ...current, friendlyName: event.target.value }))} /></div><div className="space-y-2"><Label>Display name</Label><Input value={form.callerIdName} onChange={event => setForm(current => ({ ...current, callerIdName: event.target.value }))} /></div></CardContent></Card>}
          {p.notificationEmail && <Card><CardHeader><CardTitle className="flex items-center gap-2"><Mail className="h-4 w-4" />Notifications</CardTitle></CardHeader><CardContent><Label>Notification email</Label><Input className="mt-2" type="email" value={form.notificationEmail} onChange={event => setForm(current => ({ ...current, notificationEmail: event.target.value }))} /></CardContent></Card>}
          {p.twilioStatus && <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Line status</CardTitle></CardHeader><CardContent><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Status</span><span className="flex items-center gap-1 text-emerald-300"><CheckCircle2 className="h-4 w-4" />{twilio.data ? "Active" : twilio.isPending ? "Checking…" : "Configured"}</span></div></CardContent></Card>}
        </div>
      </div>
    </div>
  );
}
