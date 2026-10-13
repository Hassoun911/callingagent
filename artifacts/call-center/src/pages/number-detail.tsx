import { useState, useEffect, useRef } from "react";
import { useParams, Link, useLocation } from "wouter";
import { 
  useGetPhoneNumber, 
  useUpdatePhoneNumber, 
  useReleasePhoneNumber, 
  getGetPhoneNumberQueryKey,
  useTestCall,
  useGetPhoneNumberTwilioStatus,
  useListElevenLabsVoices,
} from "@workspace/api-client-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Trash2, PhoneCall, PhoneForwarded, Bot, Voicemail, Ban, CheckCircle2, AlertCircle, Loader2, ShieldCheck, MessageSquare, Keyboard, Mic, Mic2, Mail, Globe, Plus, ChevronRight, Play, Pause, Users, Square, Eye, EyeOff, Settings2, Zap, Waves } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GLOBAL_AI_LANGUAGES } from "@/components/GlobalAiSettingsDialog";

const PRESET_HOLD = "Connecting your call, please hold.";

const VOICES = [
  { id: "coral",   name: "Coral",   gender: "Female", desc: "Natural, warm" },
  { id: "nova",    name: "Nova",    gender: "Female", desc: "Energetic, bright" },
  { id: "shimmer", name: "Shimmer", gender: "Female", desc: "Soft, clear" },
  { id: "alloy",   name: "Alloy",   gender: "Female", desc: "Neutral, balanced" },
  { id: "ash",     name: "Ash",     gender: "Male",   desc: "Clear, professional" },
  { id: "sage",    name: "Sage",    gender: "Male",   desc: "Measured, thoughtful" },
  { id: "ballad",  name: "Ballad",  gender: "Male",   desc: "Smooth, engaging" },
  { id: "verse",   name: "Verse",   gender: "Male",   desc: "Dynamic, versatile" },
  { id: "echo",    name: "Echo",    gender: "Male",   desc: "Warm, conversational" },
  { id: "onyx",    name: "Onyx",    gender: "Male",   desc: "Deep, authoritative" },
];

const LANGUAGES = [
  { id: "en-US", label: "English (US)",          flag: "EN" },
  { id: "ar-LB", label: "Arabic (Lebanon)",      flag: "AR" },
  { id: "ar-SA", label: "Arabic (Saudi Arabia)", flag: "AR" },
];

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", ar: "Arabic", fr: "French", de: "German", es: "Spanish",
  it: "Italian", pt: "Portuguese", nl: "Dutch", zh: "Chinese", ja: "Japanese",
  ko: "Korean", hi: "Hindi", ru: "Russian", tr: "Turkish", pl: "Polish",
  sv: "Swedish", cs: "Czech", sk: "Slovak", ro: "Romanian", uk: "Ukrainian",
  vi: "Vietnamese", ms: "Malay", fil: "Filipino", no: "Norwegian", hr: "Croatian",
};

function languageLabel(code?: string | null): string {
  if (!code) return "";
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

export default function NumberDetail() {
  const { id } = useParams();
  const numId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: number, isLoading } = useGetPhoneNumber(numId);
  const { data: twilioStatus, isLoading: twilioLoading, isError: twilioError } = useGetPhoneNumberTwilioStatus(numId);
  const { data: elevenLabsVoices } = useListElevenLabsVoices();
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [voiceLangFilter, setVoiceLangFilter] = useState("all");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const elevenLabsLanguageOptions = Array.from(
    new Set(
      (elevenLabsVoices?.voices ?? []).flatMap(v => [v.language, ...(v.languages ?? [])].filter(Boolean) as string[])
    )
  ).sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)));

  const filteredElevenLabsVoices = (elevenLabsVoices?.voices ?? []).filter(v =>
    voiceLangFilter === "all" || v.language === voiceLangFilter || v.languages?.includes(voiceLangFilter)
  );

  const playAiVoicePreview = async (e: React.MouseEvent, engine: "openai" | "elevenlabs", voiceId: string, lang?: string) => {
    e.preventDefault();
    e.stopPropagation();
    const key = `${engine}:${voiceId}`;

    if (previewingVoice === key) {
      previewAudioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }

    previewAudioRef.current?.pause();
    setPreviewingVoice(null);
    setLoadingVoice(key);

    try {
      const url = engine === "elevenlabs"
        ? `/api/ai-voice/preview?engine=elevenlabs&voiceId=${encodeURIComponent(voiceId)}${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`
        : `/api/ai-voice/preview?voice=${voiceId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Preview failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      previewAudioRef.current = audio;
      audio.onended = () => {
        setPreviewingVoice(null);
        URL.revokeObjectURL(objectUrl);
      };
      audio.onerror = () => {
        setPreviewingVoice(null);
        URL.revokeObjectURL(objectUrl);
      };
      setLoadingVoice(null);
      setPreviewingVoice(key);
      audio.play();
    } catch {
      setLoadingVoice(null);
      setPreviewingVoice(null);
    }
  };
  const updateMutation = useUpdatePhoneNumber();
  const releaseMutation = useReleasePhoneNumber({
    mutation: {
      onSuccess: () => {
        window.location.href = "/numbers";
      }
    }
  });
  const testCallMutation = useTestCall();
  const [, navigate] = useLocation();

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: campaigns, refetch: refetchCampaigns } = useQuery({
    queryKey: ["campaigns-for-number", numId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns?phoneNumberId=${numId}`);
      if (!r.ok) throw new Error("Failed to fetch campaigns");
      return r.json() as Promise<Array<{
        id: number; name: string; status: string; script: string | null;
        totalContacts: number; pendingContacts: number; completedContacts: number; interestedContacts: number;
        createdAt: string;
      }>>;
    },
    enabled: !isNaN(numId),
  });




  const [newCampaignDialog, setNewCampaignDialog] = useState(false);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignScript, setNewCampaignScript] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  async function handleCreateCampaign() {
    if (!newCampaignName.trim()) return;
    setCreatingCampaign(true);
    try {
      const r = await fetch(`${BASE}/api/campaigns`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCampaignName.trim(), script: newCampaignScript.trim() || "AI outreach campaign.", fromPhoneNumberId: numId }),
      });
      if (!r.ok) throw new Error(await r.text());
      const created = await r.json();
      setNewCampaignDialog(false);
      setNewCampaignName("");
      setNewCampaignScript("");
      refetchCampaigns();
      navigate(`/campaigns/${created.id}`);
    } catch (err: any) {
      toast({ title: "Failed to create campaign", description: err.message, variant: "destructive" });
    } finally {
      setCreatingCampaign(false);
    }
  }

  const [formData, setFormData] = useState<any>({});
  const [promptHelperOpen, setPromptHelperOpen] = useState(false);
  const [helperDetails, setHelperDetails] = useState({ business: "", description: "", address: "", hours: "", services: "", instructions: "", tone: "friendly", length: "standard", language: "English" });
  const [helperDraft, setHelperDraft] = useState("");
  const [helperGreeting, setHelperGreeting] = useState("");
  const [helperGenerating, setHelperGenerating] = useState(false);
  const [helperQuestions, setHelperQuestions] = useState<string[]>([]);
  const [helperRecommendations, setHelperRecommendations] = useState<string[]>([]);
  const [helperError, setHelperError] = useState("");
  const [helperListening, setHelperListening] = useState(false);
  const helperSpeechRef = useRef<any>(null);

  const generateNumberPrompt = () => {
    const d = helperDetails;
    const business = d.business.trim();
    if (!business || !d.description.trim()) {
      toast({ title: "Tell us about the business", description: "Enter the business name and what it does.", variant: "destructive" });
      return;
    }
    const short = d.length === "short";
    const detailed = d.length === "detailed";
    const draft = [
      `You are the telephone receptionist for ${business}. You represent only this business and this phone number. Never use information, names, greetings, or instructions belonging to any other company.`,
      `Business description: ${d.description.trim()}.`,
      d.address.trim() ? `Location and address: ${d.address.trim()}.` : "",
      d.hours.trim() ? `Business hours: ${d.hours.trim()}.` : "",
      d.services.trim() ? `Services and products: ${d.services.trim()}.` : "",
      `Speak in ${d.language}. Your manner is ${d.tone === "professional" ? "professional, clear and confident" : d.tone === "warm" ? "warm, welcoming and patient" : "friendly, helpful and natural"}.`,
      `Keep replies ${short ? "short: usually one or two sentences" : detailed ? "thorough but conversational, giving practical details where known" : "concise, usually two or three sentences"}.`,
      "Answer questions using only verified business details given here or provided explicitly during the call. Never invent prices, hours, services, availability, policies or appointments. If you do not know, offer to take a message or connect the caller to the business.",
      "Ask one question at a time. Confirm important details, such as names and callback numbers. Do not promise a booking or transfer unless the system confirms it was completed.",
      "Respect caller privacy. Do not request payment card details, passwords or sensitive credentials. If a caller needs a person, offer escalation according to the configured routing.",
      d.instructions.trim() ? `Additional business-specific instructions: ${d.instructions.trim()}.` : "",
      detailed ? "When needed, clarify the caller's request, summarize next steps and verify contact information before finishing the conversation." : "",
    ].filter(Boolean).join("\n\n");
    setHelperDraft(draft);
  };

  const generateSmartDraft = async () => {
    setHelperGenerating(true);
    setHelperError("");
    try {
      const response = await fetch(`${BASE}/api/ai-voice/numbers/${numId}/studio-draft`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(helperDetails),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to generate receptionist");
      if (data.numberId !== numId || data.companyId !== number?.companyId) throw new Error("Number ownership mismatch");
      setHelperDraft(data.systemPrompt || "");
      setHelperGreeting(data.greeting || "");
      setHelperQuestions(data.missingQuestions || []);
      setHelperRecommendations(data.recommendations || []);
    } catch (error: any) { setHelperError(error.message || "Please retry"); }
    finally { setHelperGenerating(false); }
  };
  const dictatePromptDetails = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast({ title: "Voice input unavailable", description: "This browser does not support speech recognition. You can type your instructions instead.", variant: "destructive" });
      return;
    }
    if (helperListening) { helperSpeechRef.current?.stop(); setHelperListening(false); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-CA";
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results).map((result: any) => result[0]?.transcript || "").join(" ");
      setHelperDetails(previous => ({ ...previous, instructions: [previous.instructions, transcript].filter(Boolean).join(" ") }));
    };
    recognition.onerror = () => setHelperListening(false);
    recognition.onend = () => setHelperListening(false);
    helperSpeechRef.current = recognition;
    setHelperListening(true);
    recognition.start();
  };

  const [testCallTo, setTestCallTo] = useState("");
  const initRef = useRef(false);

  useEffect(() => {
    initRef.current = false;
  }, [numId]);

  useEffect(() => {
    if (number && !initRef.current) {
      setFormData({
        friendlyName: number.friendlyName || "",
        callerIdName: number.callerIdName || "",
        forwardTo: number.forwardTo || "",
        ringCount: number.ringCount || 4,
        answerMode: number.answerMode || "forward",
        forwardCallerId: number.forwardCallerId || "caller",
        callerExperience: (() => {
          const exp = number.callerExperience;
          if (exp && exp !== "ringing") return exp;
          // backward compat: derive from holdMessage if callerExperience is still default
          if (number.holdMessage === PRESET_HOLD) return "connecting";
          if (number.holdMessage) return "hold_message";
          return "ringing";
        })(),
        callScreen: number.callScreen ?? false,
        callScreenFallback: number.callScreenFallback || "voicemail",
        forwardNoAnswerAction: number.forwardNoAnswerAction === "personal_voicemail" ? "voicemail" : (number.forwardNoAnswerAction || "voicemail"),
        holdMessage: number.holdMessage ?? "",
        aiSystemPrompt: number.aiSystemPrompt || "",
        aiVoice: number.aiVoice || "",
        aiVoiceEngine: (number as any).aiVoiceEngine || null,
        aiElevenLabsVoiceId: (number as any).aiElevenLabsVoiceId || "",
        aiLanguage: number.aiLanguage || "",
        aiGreeting: number.aiGreeting || "",
        aiSpeakingStyle: number.aiSpeakingStyle || "",
        voicemailGreeting: number.voicemailGreeting || "",
        notificationEmail: number.notificationEmail || ""
      });
      initRef.current = true;
    }
  }, [number]);

  const handleSave = () => {
    updateMutation.mutate({
      id: numId,
      data: formData
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPhoneNumberQueryKey(numId) });
        toast({ title: "Configuration saved", description: "Changes have been applied successfully." });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  };

  const handleTestCall = () => {
    const isForward = formData.answerMode === 'forward';
    if (isForward && !formData.forwardTo) {
      toast({ title: "Missing number", description: "Please specify a forward-to number to test.", variant: "destructive" });
      return;
    }
    if (!isForward && !testCallTo) {
      toast({ title: "Missing number", description: "Enter a phone number to call for the test.", variant: "destructive" });
      return;
    }
    const targetNumber = isForward ? formData.forwardTo : testCallTo;
    testCallMutation.mutate({
      id: numId,
      data: { toNumber: targetNumber }
    }, {
      onSuccess: () => {
        toast({ title: "Test call initiated", description: "Calling your phone — answer to hear the AI greeting." });
      }
    });
  };

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-[600px] w-full" /></div>;
  }

  if (!number) {
    return <div>Number not found.</div>;
  }

  return (
    <div className="space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/numbers" className="inline-flex items-center justify-center rounded-md w-8 h-8 hover:bg-secondary transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold font-mono tracking-tight text-foreground">{number.friendlyName}</h1>
            <p className="text-muted-foreground mt-1">Configure line behavior and routing.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {formData.answerMode && formData.answerMode !== 'forward' && (
            <Input
              value={testCallTo}
              onChange={e => setTestCallTo(e.target.value)}
              placeholder="Your phone +1..."
              className="h-9 w-44 text-sm bg-background"
            />
          )}
          <Button variant="outline" onClick={handleTestCall} disabled={testCallMutation.isPending} className="gap-2">
            <PhoneCall className="h-4 w-4" />
            {testCallMutation.isPending ? "Calling..." : "Test Routing"}
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">

          {/* ── Routing ── unified card */}
          <Card className={`border-border ${formData.answerMode === 'reject' ? 'border-red-500/20 bg-red-500/5' : ''}`}>
            <CardHeader className="pb-4">
              <CardTitle className="text-green-400">Routing Mode</CardTitle>
              <CardDescription>Determine how incoming calls are handled.</CardDescription>
              <ToggleGroup
                type="single"
                value={formData.answerMode ?? "forward"}
                onValueChange={(val) => val && setFormData({ ...formData, answerMode: val })}
                className="!grid !grid-cols-2 sm:!grid-cols-4 !gap-2 !w-full !h-auto bg-secondary/50 p-2 rounded-lg border border-border mt-2"
              >
                <ToggleGroupItem value="forward" className="!m-0 min-w-0 w-full h-auto min-h-16 flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-3 text-center whitespace-normal break-normal leading-tight data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  <PhoneForwarded className="h-4 w-4" />
                  <div className="font-semibold text-sm leading-tight">Forward</div>
                </ToggleGroupItem>
                <ToggleGroupItem value="ai_voice" className="!m-0 min-w-0 w-full h-auto min-h-16 flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-3 text-center whitespace-normal break-normal leading-tight data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  <Bot className="h-4 w-4" />
                  <div className="font-semibold text-sm leading-tight">AI Agent</div>
                </ToggleGroupItem>
                <ToggleGroupItem value="voicemail" className="!m-0 min-w-0 w-full h-auto min-h-16 flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-3 text-center whitespace-normal break-normal leading-tight data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  <Voicemail className="h-4 w-4" />
                  <div className="font-semibold text-sm leading-tight">Voicemail</div>
                </ToggleGroupItem>
                <ToggleGroupItem value="reject" className="!m-0 min-w-0 w-full h-auto min-h-16 flex flex-col sm:flex-row items-center justify-center gap-1.5 px-2 py-3 text-center whitespace-normal break-normal leading-tight data-[state=on]:bg-background data-[state=on]:shadow-sm">
                  <Ban className="h-4 w-4" />
                  <div className="font-semibold text-sm leading-tight">Reject</div>
                </ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>

            {/* ── Forward Settings ── */}
            {formData.answerMode === 'forward' && (() => {
            const radioBase = "flex items-start gap-3 w-full p-3 rounded-md border text-left transition-colors cursor-pointer";
            const radioOn  = "border-primary bg-primary/10 text-foreground";
            const radioOff = "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground";
            const Radio = ({ on }: { on: boolean }) => (
              <span className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${on ? "border-primary" : "border-muted-foreground"}`}>
                {on && <span className="h-2 w-2 rounded-full bg-primary" />}
              </span>
            );
            const callerExp = formData.callerExperience || "ringing";
            const setCallerExp = (exp: string, msg?: string) => setFormData({
              ...formData,
              callerExperience: exp,
              holdMessage: msg !== undefined ? msg : (exp === "ringing" ? "" : exp === "connecting" ? PRESET_HOLD : formData.holdMessage),
            });
            return (
              <CardContent className="space-y-0 border-t border-border animate-in fade-in duration-200">

                  {/* Destination + Ring Count */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pb-6">
                    <div className="space-y-2">
                      <Label className="text-green-400">Destination Number</Label>
                      <Input
                        placeholder="+1 (555) 000-0000"
                        value={formData.forwardTo}
                        onChange={(e) => setFormData({...formData, forwardTo: e.target.value})}
                        className="font-mono bg-background"
                      />
                      <p className="text-xs text-muted-foreground">Calls will be routed to this number.</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-green-400">Ring Count</Label>
                        <span className="font-mono text-sm text-muted-foreground">{formData.ringCount} rings</span>
                      </div>
                      <Slider
                        value={[formData.ringCount]}
                        min={1}
                        max={10}
                        step={1}
                        onValueChange={([val]) => setFormData({...formData, ringCount: val})}
                      />
                      <p className="text-xs text-muted-foreground">Rings before falling back.</p>
                    </div>
                  </div>

                  {/* When Someone Calls */}
                  <div className="space-y-3 py-6 border-t border-border">
                    <div>
                      <Label className="text-green-400">When Someone Calls</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">What does the caller hear while their call is being connected?</p>
                    </div>
                    <div className="space-y-2">
                      <button type="button" onClick={() => setCallerExp("greeting_name", formData.holdMessage || "")} className={`${radioBase} ${callerExp === "greeting_name" ? radioOn : radioOff}`}>
                        <Radio on={callerExp === "greeting_name"} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><Mic className="h-3.5 w-3.5" /> Personal greeting, caller states name, then hold</div>
                          <div className="text-xs opacity-70 mt-0.5">Plays your greeting, records caller's name — agent hears the name before answering</div>
                        </div>
                      </button>
                      <button type="button" onClick={() => setCallerExp("greeting", formData.holdMessage || "")} className={`${radioBase} ${callerExp === "greeting" ? radioOn : radioOff}`}>
                        <Radio on={callerExp === "greeting"} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="h-3.5 w-3.5" /> Personal greeting then connecting</div>
                          <div className="text-xs opacity-70 mt-0.5">Caller hears your custom greeting, then the call connects</div>
                        </div>
                      </button>
                      <button type="button" onClick={() => setCallerExp("hold_message", formData.holdMessage || "")} className={`${radioBase} ${callerExp === "hold_message" ? radioOn : radioOff}`}>
                        <Radio on={callerExp === "hold_message"} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="h-3.5 w-3.5" /> Hold message only</div>
                          <div className="text-xs opacity-70 mt-0.5">Caller hears a hold message while connecting — no ringing announcement</div>
                        </div>
                      </button>
                      <button type="button" onClick={() => setCallerExp("connecting", PRESET_HOLD)} className={`${radioBase} ${callerExp === "connecting" ? radioOn : radioOff}`}>
                        <Radio on={callerExp === "connecting"} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><PhoneForwarded className="h-3.5 w-3.5" /> "Connecting Call" then ringing</div>
                          <div className="text-xs opacity-70 mt-0.5">Plays "Connecting your call, please hold." then rings</div>
                        </div>
                      </button>
                      <button type="button" onClick={() => setCallerExp("ringing", "")} className={`${radioBase} ${callerExp === "ringing" ? radioOn : radioOff}`}>
                        <Radio on={callerExp === "ringing"} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><PhoneCall className="h-3.5 w-3.5" /> Ringing only</div>
                          <div className="text-xs opacity-70 mt-0.5">Caller hears standard ringing directly</div>
                        </div>
                      </button>
                    </div>
                    {(callerExp === "greeting_name" || callerExp === "greeting" || callerExp === "hold_message") && (
                      <div className="space-y-1.5">
                        <input
                          type="text"
                          value={formData.holdMessage}
                          onChange={e => setFormData({...formData, holdMessage: e.target.value})}
                          placeholder={callerExp === "greeting_name" || callerExp === "greeting" ? "Type your personal greeting..." : "Type the hold message the caller will hear..."}
                          className="w-full h-9 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          autoFocus
                        />
                        {callerExp === "greeting_name" && (
                          <p className="text-xs text-muted-foreground">After the greeting, callers are prompted to say their name. Your phone will play the recording before you answer — works like a built-in call screen.</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* When Call Routes to You */}
                  <div className="space-y-3 py-6 border-t border-border">
                    <div>
                      <Label className="text-green-400">When Call Routes to You</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">How should the call be connected to your phone?</p>
                    </div>
                    <div className="space-y-2">
                      <button type="button" onClick={() => setFormData({...formData, callScreen: false})} className={`${radioBase} ${!formData.callScreen ? radioOn : radioOff}`}>
                        <Radio on={!formData.callScreen} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><PhoneCall className="h-3.5 w-3.5" /> Connect immediately</div>
                          <div className="text-xs opacity-70 mt-0.5">Caller connects to you or your voicemail — whichever answers</div>
                        </div>
                      </button>
                      <button type="button" onClick={() => setFormData({...formData, callScreen: true})} className={`${radioBase} ${formData.callScreen ? radioOn : radioOff}`}>
                        <Radio on={!!formData.callScreen} />
                        <div>
                          <div className="flex items-center gap-2 text-sm font-medium"><Keyboard className="h-3.5 w-3.5" /> Require key press to accept</div>
                          <div className="text-xs opacity-70 mt-0.5">You hear the caller info and press 1 to answer; declined calls go to fallback</div>
                        </div>
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">No key press: a human answer connects automatically. Require key press: the recipient must press 1 before being connected.</p>
                  </div>

                  <div className="space-y-3 py-6 border-t border-border">
                    <div>
                      <Label className="text-green-400">If You Don't Answer</Label>
                      <p className="text-xs text-muted-foreground mt-1">Choose the fallback independently of how you answer. The forwarded phone's personal voicemail should not receive this call.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <button type="button" onClick={() => setFormData({...formData, forwardNoAnswerAction: "voicemail", callScreenFallback: "voicemail"})} className={`${radioBase} ${formData.forwardNoAnswerAction !== "ai_voice" ? radioOn : radioOff}`}>
                        <Radio on={formData.forwardNoAnswerAction !== "ai_voice"}/>
                        <div><div className="font-medium text-sm">CallingAgent Voicemail</div><div className="text-xs opacity-70 mt-1">Professional greeting, beep, and saved voice message.</div></div>
                      </button>
                      <button type="button" onClick={() => setFormData({...formData, forwardNoAnswerAction: "ai_voice", callScreenFallback: "ai_voice"})} className={`${radioBase} ${formData.forwardNoAnswerAction === "ai_voice" ? radioOn : radioOff}`}>
                        <Radio on={formData.forwardNoAnswerAction === "ai_voice"}/>
                        <div><div className="font-medium text-sm">AI Agent</div><div className="text-xs opacity-70 mt-1">When live Telnyx AI is unavailable, use CallingAgent voicemail.</div></div>
                      </button>
                    </div>
                  </div>

                  {/* Caller ID Shown to You */}
                  <div className="space-y-3 py-6 border-t border-border">
                    <div>
                      <Label className="text-green-400">Caller ID Shown to You</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">What number appears on your phone when a call is forwarded?</p>
                      {!number.twilioSid && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Telnyx forwarding currently presents this CallingAgent line’s phone number. To display the company name alongside it, register the number’s outbound CNAM with Telnyx; display depends on the receiving carrier. The original caller’s number is saved in Call Logs.</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setFormData({...formData, forwardCallerId: "caller"})} className={`flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors ${formData.forwardCallerId === "caller" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground"}`}>
                        <span className="text-sm font-medium">Caller's Number</span>
                        <span className="text-xs opacity-70">Shows who's actually calling</span>
                      </button>
                      <button type="button" onClick={() => setFormData({...formData, forwardCallerId: "line"})} className={`flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors ${formData.forwardCallerId === "line" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground"}`}>
                        <span className="text-sm font-medium">This Line's Number</span>
                        <span className="text-xs opacity-70">Shows this CallingAgent line number</span>
                      </button>
                    </div>
                  </div>

                </CardContent>
            );
          })()}

          {/* ── AI Voice Settings ── */}
          {formData.answerMode === 'ai_voice' && (
            <CardContent className="space-y-5 border-t border-border animate-in fade-in duration-200">

                {/* Global Defaults summary */}
                <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <p className="text-sm font-bold">Private AI settings for this phone number</p>
                  <p className="text-xs text-muted-foreground mt-1">Changes here apply only to {number.number}. They do not modify other companies or phone numbers. Blank fields will not import another company's greeting or prompt.</p>
                </div>
                {/* Voice Engine */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <Label className="text-green-400">Voice Engine</Label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: "",           label: "Use number default" },
                      { value: "openai",     label: "OpenAI TTS"    },
                      { value: "elevenlabs", label: "ElevenLabs"    },
                    ].map(opt => (
                      <button key={opt.value} type="button" onClick={() => setFormData({...formData, aiVoiceEngine: opt.value})}
                        className={`rounded-md border px-3 py-2 text-xs font-medium text-left transition-colors ${
                          formData.aiVoiceEngine === opt.value
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-border/80 hover:bg-muted/30"
                        }`}>{opt.label}</button>
                    ))}
                  </div>
                </div>

                {/* Voice + Language */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-green-400 flex items-center gap-1.5"><Mic className="h-3 w-3" />Voice</Label>
                    {formData.aiVoiceEngine === "elevenlabs" ? (
                      <>
                        {elevenLabsLanguageOptions.length > 1 && (
                          <Select value={voiceLangFilter} onValueChange={setVoiceLangFilter}>
                            <SelectTrigger className="bg-background h-8 text-xs mb-1.5">
                              <SelectValue placeholder="Filter by language" />
                            </SelectTrigger>
                            <SelectContent className="max-h-[480px]" style={{ maxHeight: 480 }}>
                              <SelectItem value="all">All languages</SelectItem>
                              {elevenLabsLanguageOptions.map(code => (
                                <SelectItem key={code} value={code}>{languageLabel(code)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                        <Select value={formData.aiElevenLabsVoiceId || "__default__"} onValueChange={v => setFormData({...formData, aiElevenLabsVoiceId: v === "__default__" ? "" : v})}>
                          <SelectTrigger className="bg-background"><SelectValue placeholder="Global default" /></SelectTrigger>
                          <SelectContent className="max-h-[280px]">
                            <SelectItem value="__default__"><span className="text-muted-foreground">Global default</span></SelectItem>
                            {filteredElevenLabsVoices.length === 0 && (
                              <div className="px-2 py-3 text-xs text-muted-foreground text-center">No voices for this language</div>
                            )}
                            {filteredElevenLabsVoices.map(v => {
                              const displayLang = voiceLangFilter !== "all" && v.languages?.includes(voiceLangFilter) ? voiceLangFilter : v.language;
                              const otherCount = (v.languages?.length ?? (v.language ? 1 : 0)) - (displayLang ? 1 : 0);
                              return (
                                <SelectItem key={v.voiceId} value={v.voiceId} className="pr-2" onSelect={(e) => e.preventDefault()}>
                                  <div className="flex items-center gap-2 w-full">
                                    <span className="font-medium">{v.name}</span>
                                    {displayLang && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-primary/15 text-primary uppercase tracking-wide">{languageLabel(displayLang)}</span>}
                                    {v.accent && <span className="text-muted-foreground text-xs">— {v.accent}</span>}
                                    {otherCount > 0 && <span className="text-muted-foreground text-xs">+{otherCount} more</span>}
                                    <button type="button" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                      onClick={(e) => playAiVoicePreview(e, "elevenlabs", v.voiceId, displayLang || v.language || undefined)}
                                      className={`ml-auto shrink-0 flex items-center justify-center h-6 w-6 rounded transition-colors ${previewingVoice === `elevenlabs:${v.voiceId}` ? "bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400" : loadingVoice === `elevenlabs:${v.voiceId}` ? "text-muted-foreground" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>
                                      {loadingVoice === `elevenlabs:${v.voiceId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : previewingVoice === `elevenlabs:${v.voiceId}` ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                                    </button>
                                  </div>
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        {(formData.aiElevenLabsVoiceId && formData.aiElevenLabsVoiceId !== "__default__") && (
                          <button type="button"
                            onClick={(e) => playAiVoicePreview(e, "elevenlabs", formData.aiElevenLabsVoiceId!, voiceLangFilter !== "all" ? voiceLangFilter : (elevenLabsVoices?.voices?.find((v: any) => v.voiceId === formData.aiElevenLabsVoiceId)?.language || undefined))}
                            className={`flex items-center gap-2 px-3 h-8 rounded text-xs font-medium transition-colors border ${previewingVoice === `elevenlabs:${formData.aiElevenLabsVoiceId}` ? "border-green-500/40 bg-green-500/10 text-green-400 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400" : loadingVoice === `elevenlabs:${formData.aiElevenLabsVoiceId}` ? "border-border bg-muted/20 text-muted-foreground cursor-wait" : "border-border bg-muted/20 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary"}`}>
                            {loadingVoice === `elevenlabs:${formData.aiElevenLabsVoiceId}` ? <Loader2 className="h-3 w-3 animate-spin" /> : previewingVoice === `elevenlabs:${formData.aiElevenLabsVoiceId}` ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3 w-3 fill-current" />}
                            {previewingVoice === `elevenlabs:${formData.aiElevenLabsVoiceId}` ? "Stop preview" : loadingVoice === `elevenlabs:${formData.aiElevenLabsVoiceId}` ? "Loading…" : "Test selected voice"}
                          </button>
                        )}
                        {!elevenLabsVoices?.voices?.length && (
                          <p className="text-xs text-amber-500">No ElevenLabs voices found. Check your API key or import voices.</p>
                        )}
                      </>
                    ) : (
                      <Select value={formData.aiVoice || "__default__"} onValueChange={v => setFormData({...formData, aiVoice: v === "__default__" ? "" : v})}>
                        <SelectTrigger className="bg-background"><SelectValue placeholder="Global default" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__"><span className="text-muted-foreground">Global default</span></SelectItem>
                          {VOICES.filter(v => v.gender === "Female").map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <span className="font-medium">{v.name}</span>
                              <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 border-pink-500/30 text-pink-400">F</Badge>
                              <span className="text-muted-foreground text-xs ml-2">{v.desc}</span>
                            </SelectItem>
                          ))}
                          {VOICES.filter(v => v.gender === "Male").map(v => (
                            <SelectItem key={v.id} value={v.id}>
                              <span className="font-medium">{v.name}</span>
                              <Badge variant="outline" className="ml-2 text-[10px] px-1 py-0 border-blue-500/30 text-blue-400">M</Badge>
                              <span className="text-muted-foreground text-xs ml-2">{v.desc}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-green-400 flex items-center gap-1.5"><Globe className="h-3 w-3" />Language</Label>
                    <Select value={formData.aiLanguage || "__default__"} onValueChange={v => setFormData({...formData, aiLanguage: v === "__default__" ? "" : v})}>
                      <SelectTrigger className="bg-background"><SelectValue placeholder="Global default" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__"><span className="text-muted-foreground">Global default</span></SelectItem>
                        {LANGUAGES.map(l => (
                          <SelectItem key={l.id} value={l.id}>
                            <span className="font-mono text-xs bg-muted px-1 rounded mr-2">{l.flag}</span>
                            {l.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Speaking Style */}
                <div className="space-y-2">
                  <Label className="text-green-400">Speaking Style</Label>
                  <Textarea
                    placeholder="e.g. Speak warmly and naturally, use brief pauses, sound professional but approachable. (Leave blank to use number default)"
                    value={formData.aiSpeakingStyle}
                    onChange={(e) => setFormData({...formData, aiSpeakingStyle: e.target.value})}
                    className="h-16 bg-background text-sm resize-none"
                  />
                  <p className="text-xs text-muted-foreground">Instructions to shape tone and delivery of this number's AI agent.</p>
                </div>

                {/* Initial Greeting */}
                <div className="space-y-2">
                  <Label className="text-green-400">Initial Greeting</Label>
                  <Input
                    placeholder="e.g. Thank you for calling Acme Corp, this is Sarah. How can I help? (Leave blank to use global default)"
                    value={formData.aiGreeting}
                    onChange={(e) => setFormData({...formData, aiGreeting: e.target.value})}
                    className="bg-background text-sm"
                  />
                  <p className="text-xs text-muted-foreground">First sentence spoken when this number answers.</p>
                </div>

                <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-base font-extrabold text-foreground">AI Receptionist Studio</p>
                      <p className="text-xs text-muted-foreground">Create a receptionist prompt for this number only. Nothing is saved until you approve and save changes.</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setPromptHelperOpen(open => !open)} type="button">
                      {promptHelperOpen ? "Hide helper" : "Launch studio"}
                    </Button>
                  </div>
                  {promptHelperOpen && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1"><Label>Business name</Label><Input value={helperDetails.business} placeholder="e.g. Java Solutions" onChange={e => setHelperDetails(p => ({...p,business:e.target.value}))}/></div>
                        <div className="space-y-1"><Label>Address / service area (optional)</Label><Input value={helperDetails.address} placeholder="e.g. Windsor, Ontario" onChange={e => setHelperDetails(p => ({...p,address:e.target.value}))}/></div>
                        <div className="space-y-1"><Label>Hours (optional)</Label><Input value={helperDetails.hours} placeholder="e.g. Mon-Fri 9 AM-5 PM" onChange={e => setHelperDetails(p => ({...p,hours:e.target.value}))}/></div>
                        <div className="space-y-1"><Label>Services (optional)</Label><Input value={helperDetails.services} placeholder="e.g. Software development, support" onChange={e => setHelperDetails(p => ({...p,services:e.target.value}))}/></div>
                      </div>
                      <div className="space-y-1"><Label>What does the company do?</Label><Textarea value={helperDetails.description} placeholder="Describe your business and the kinds of calls you receive." onChange={e => setHelperDetails(p => ({...p,description:e.target.value}))}/></div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="space-y-1"><Label>Answer style</Label><Select value={helperDetails.tone} onValueChange={v => setHelperDetails(p => ({...p,tone:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="friendly">Friendly</SelectItem><SelectItem value="professional">Professional</SelectItem><SelectItem value="warm">Warm</SelectItem></SelectContent></Select></div>
                        <div className="space-y-1"><Label>Response length</Label><Select value={helperDetails.length} onValueChange={v => setHelperDetails(p => ({...p,length:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short">Short</SelectItem><SelectItem value="standard">Balanced</SelectItem><SelectItem value="detailed">Detailed</SelectItem></SelectContent></Select></div>
                        <div className="space-y-1"><Label>Language</Label><Select value={helperDetails.language} onValueChange={v => setHelperDetails(p => ({...p,language:v}))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="English">English</SelectItem><SelectItem value="Arabic">Arabic</SelectItem><SelectItem value="English and Arabic, following the caller's language">English + Arabic</SelectItem><SelectItem value="French">French</SelectItem></SelectContent></Select></div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2"><Label>Other instructions (type or speak)</Label><Button type="button" size="sm" variant="outline" onClick={dictatePromptDetails}><Mic className="h-3.5 w-3.5 mr-1" />{helperListening ? "Stop recording" : "Speak instructions"}</Button></div>
                        <Textarea value={helperDetails.instructions} placeholder="Tell us what the AI should do, how to greet callers, what questions to ask, and when to refer to a person." onChange={e => setHelperDetails(p => ({...p,instructions:e.target.value}))}/>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" disabled={helperGenerating} onClick={generateSmartDraft}>{helperGenerating ? "AI is preparing your draft…" : "Generate with AI"}</Button>
                        <Button type="button" variant="outline" onClick={generateNumberPrompt}>Quick offline template</Button>
                      </div>
                      {helperError && <p role="alert" className="text-sm text-destructive">{helperError}</p>}
                      {helperQuestions.length > 0 && <div className="rounded-md border p-3 space-y-1"><p className="font-semibold text-sm">Questions that will make your receptionist smarter</p>{helperQuestions.map((q,i)=><p key={i} className="text-sm">{i+1}. {q}</p>)}<p className="text-xs text-muted-foreground">Answer these in Other instructions, then regenerate.</p></div>}
                      {helperRecommendations.length > 0 && <div className="rounded-md border p-3 space-y-1"><p className="font-semibold text-sm">Recommended improvements</p>{helperRecommendations.map((item,i)=><p key={i} className="text-sm">• {item}</p>)}</div>}
                      {helperDraft && (
                        <div className="space-y-2">
                          <Label>Review and edit before applying</Label><Label>Proposed greeting</Label><Input value={helperGreeting} onChange={e=>setHelperGreeting(e.target.value)} placeholder="Write the first greeting for this number" />
                          <Textarea className="min-h-64 bg-background text-sm" value={helperDraft} onChange={e => setHelperDraft(e.target.value)}/>
                          <Button type="button" onClick={() => { setFormData((p:any)=>({...p,aiSystemPrompt:helperDraft,aiGreeting:helperGreeting || p.aiGreeting || `Thank you for calling ${helperDetails.business}. How can I help you today?`})); setPromptHelperOpen(false); toast({title:"Draft applied to this number",description:"Review the fields below, then click Save Changes to store your settings."}); }}>Apply to this number (not saved yet)</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* System Prompt */}
                <div className="space-y-2">
                  <Label className="text-green-400">System Prompt (Instructions)</Label>
                  <Textarea
                    placeholder="You are Sarah from Acme Corp. Your role is to assist callers with... (Leave blank to use global default)"
                    value={formData.aiSystemPrompt}
                    onChange={(e) => setFormData({...formData, aiSystemPrompt: e.target.value})}
                    className="h-40 bg-background font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">Core AI instructions for this number. Overrides the global system prompt.</p>
                </div>

              </CardContent>
          )}

          {/* ── Voicemail Settings ── */}
          {formData.answerMode === 'voicemail' && (
            <CardContent className="border-t border-border animate-in fade-in duration-200">
              <div className="space-y-2">
                <Label className="text-green-400">Greeting Text</Label>
                <Textarea
                  placeholder="Please leave a message after the beep."
                  value={formData.voicemailGreeting}
                  onChange={(e) => setFormData({...formData, voicemailGreeting: e.target.value})}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">Text-to-speech will read this before recording starts.</p>
              </div>
            </CardContent>
          )}

          {/* ── Reject ── */}
          {formData.answerMode === 'reject' && (
            <CardContent className="border-t border-red-500/20 animate-in fade-in duration-200">
              <p className="text-sm text-red-400/80">All incoming calls to this number will be rejected immediately without answering.</p>
            </CardContent>
          )}

          </Card>

        </div>

        {/* ── Right Column ── */}
        <div className="space-y-6">

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-green-400">Line Identity</CardTitle>
              <CardDescription>How this number appears in the system.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-green-400">Internal Name</Label>
                <Input
                  value={formData.friendlyName}
                  onChange={(e) => setFormData({...formData, friendlyName: e.target.value})}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-green-400">Display Name</Label>
                <Input
                  value={formData.callerIdName}
                  onChange={(e) => setFormData({...formData, callerIdName: e.target.value})}
                  className="bg-background"
                  maxLength={15}
                />
                <p className="text-xs text-muted-foreground">Used in the call screen announcement — "Incoming call for <em>{formData.callerIdName || "Solutions"}</em>." Max 15 characters.</p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-medium text-foreground">About caller name on your phone</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When a call is forwarded, your phone displays the caller's name via <strong className="text-foreground">CNAM</strong> — a carrier database separate from Twilio's friendly name. To make your phone show <em>{formData.callerIdName || "your line name"}</em>, you need CNAM registration for this provider number.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  In your provider console: <strong className="text-foreground/80">Phone Numbers → Manage → select this number → Properties → Caller Name (CNAM)</strong>. Alternatively, enable "Require key press to accept" — the call screen verbally announces the line name before you pick up.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-green-400 flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Notifications
              </CardTitle>
              <CardDescription>Receive call summaries and recordings by email after each call.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label className="text-green-400">Notification Email</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={formData.notificationEmail}
                onChange={(e) => setFormData({...formData, notificationEmail: e.target.value})}
                className="bg-background"
              />
              <p className="text-xs text-muted-foreground">
                After each call ends, a summary with caller info, duration, transcript (if AI), and a recording link will be sent here. Leave blank to disable.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle className="text-green-400">Line Status</CardTitle>
              <CardDescription>Live status from Twilio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {twilioLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Checking Twilio...
                </div>
              )}
              {twilioError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Could not reach Twilio
                </div>
              )}
              {twilioStatus && (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="flex items-center gap-1.5 font-medium text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Active
                    </span>
                  </div>
                  {twilioStatus.monthlyRentPrice && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Monthly cost</span>
                      <span className="font-mono font-semibold">${parseFloat(twilioStatus.monthlyRentPrice).toFixed(2)}/mo</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Webhooks</span>
                    <span className={`font-medium text-xs ${twilioStatus.voiceUrl ? "text-emerald-400" : "text-amber-400"}`}>
                      {twilioStatus.voiceUrl ? "Configured" : "Not set"}
                    </span>
                  </div>
                  {twilioStatus.dateCreated && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Purchased</span>
                      <span className="text-xs font-mono">{new Date(twilioStatus.dateCreated).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" })}</span>
                    </div>
                  )}
                  <div className="pt-1 border-t border-border">
                    <p className="text-xs text-muted-foreground font-mono truncate" title={twilioStatus.sid}>{twilioStatus.sid}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-destructive/20 bg-destructive/5">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Releasing this number will immediately disable it and remove it from your account.</p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" className="w-full gap-2">
                    <Trash2 className="h-4 w-4" />
                    Release Number
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This action cannot be undone. You will lose ownership of {number.friendlyName} and it may become available for others to claim.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => releaseMutation.mutate({ id: numId })}
                    >
                      Yes, release number
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

        </div>
      </div>

      {/* ── Campaigns ── */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-green-400" />
            <span className="text-sm font-semibold">Campaigns</span>
            {campaigns && campaigns.length > 0 && (
              <span className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 px-1.5 py-0.5 rounded font-semibold">{campaigns.length}</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setNewCampaignDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> New Campaign
          </Button>
        </div>

        {!campaigns ? (
          <div className="p-4 space-y-2">
            {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
            <Play className="h-6 w-6 opacity-25" />
            <span className="text-xs">No campaigns yet. Create one to start outbound calling from this number.</span>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {campaigns.map(c => (
              <div
                key={c.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 cursor-pointer transition-colors group"
                onClick={() => navigate(`/campaigns/${c.id}`)}
              >
                <div className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  c.status === "active" ? "bg-green-400" :
                  c.status === "paused" ? "bg-yellow-400" :
                  c.status === "completed" ? "bg-blue-400" :
                  "bg-muted-foreground/40"
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
                      c.status === "active" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                      c.status === "paused" ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20" :
                      c.status === "completed" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                      "bg-secondary text-muted-foreground"
                    }`}>{c.status}</Badge>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="h-3 w-3" />{c.totalContacts} contacts</span>
                    {c.completedContacts > 0 && <span>{c.completedContacts} called</span>}
                    {c.interestedContacts > 0 && <span className="text-green-400">{c.interestedContacts} interested</span>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Campaign Dialog */}
      <Dialog open={newCampaignDialog} onOpenChange={setNewCampaignDialog}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader><DialogTitle>New Campaign</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label>Campaign Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Father's Day Outreach"
                value={newCampaignName}
                onChange={e => setNewCampaignName(e.target.value)}
                className="bg-background"
                onKeyDown={e => e.key === "Enter" && handleCreateCampaign()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>AI Script / Instructions <span className="text-muted-foreground font-normal">(optional — can edit later)</span></Label>
              <Textarea
                placeholder="e.g. You are Sarah from Acme Corp. Your job is to..."
                value={newCampaignScript}
                onChange={e => setNewCampaignScript(e.target.value)}
                className="bg-background h-24 text-sm resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setNewCampaignDialog(false)}>Cancel</Button>
              <Button onClick={handleCreateCampaign} disabled={!newCampaignName.trim() || creatingCampaign}>
                {creatingCampaign ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Campaign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
