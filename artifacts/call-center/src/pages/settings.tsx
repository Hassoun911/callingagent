import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { 
  useGetAiVoiceConfig, 
  useUpdateAiVoiceConfig,
  getGetAiVoiceConfigQueryKey,
  useListPhoneNumbers,
  useListCompanies,
  useListElevenLabsVoices,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Save, Mic2, Globe, Eye, EyeOff, Zap, Waves, Building2, Play, Square, Loader2 } from "lucide-react";

const VOICES = [
  { id: "coral",   name: "Coral",   gender: "Female", desc: "Natural, warm — best for calls" },
  { id: "nova",    name: "Nova",    gender: "Female", desc: "Energetic, bright" },
  { id: "shimmer", name: "Shimmer", gender: "Female", desc: "Soft, clear" },
  { id: "alloy",   name: "Alloy",   gender: "Female", desc: "Neutral, balanced" },
  { id: "ash",     name: "Ash",     gender: "Male",   desc: "Clear, professional" },
  { id: "sage",    name: "Sage",    gender: "Male",   desc: "Measured, thoughtful" },
  { id: "ballad",  name: "Ballad",  gender: "Male",   desc: "Smooth, engaging" },
  { id: "verse",   name: "Verse",   gender: "Male",   desc: "Dynamic, versatile" },
  { id: "echo",    name: "Echo",    gender: "Male",   desc: "Warm, conversational" },
  { id: "fable",   name: "Fable",   gender: "Male",   desc: "Expressive, rich" },
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

/** Mirror of the backend resolvePromptTemplate — keeps preview in sync. */
function resolvePromptTemplate(
  prompt: string,
  vars: { companyName?: string | null; phoneNumber?: string | null; callerNumber?: string | null }
): string {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
  const normalizedCompany = vars.companyName ? normalize(vars.companyName) : null;

  return prompt.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const raw = key.trim();
    const k = normalize(raw);

    if (k === "companyname" || k === "company") return vars.companyName ?? raw;
    if (k === "phonenumber" || k === "phone")   return vars.phoneNumber ?? raw;
    if (k === "callernumber" || k === "caller")  return vars.callerNumber ?? raw;

    if (normalizedCompany && k === normalizedCompany) return vars.companyName!;

    return raw;
  });
}

export default function Settings() {
  const [, navigate] = useLocation();
  const { data: config, isLoading } = useGetAiVoiceConfig();
  const { data: phoneNumbers } = useListPhoneNumbers();
  const { data: companies } = useListCompanies();
  const { data: elevenLabsVoices } = useListElevenLabsVoices();
  const updateMutation = useUpdateAiVoiceConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Company scope from ?companyId= query param
  const scopedCompanyId = (() => {
    const v = new URLSearchParams(window.location.search).get("companyId");
    return v ? parseInt(v) : null;
  })();
  const scopedCompany = scopedCompanyId ? companies?.find(c => c.id === scopedCompanyId) : null;
  const [showPreview, setShowPreview] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [voiceLangFilter, setVoiceLangFilter] = useState("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playVoicePreview = async (e: React.MouseEvent, voiceId: string, engine: "openai" | "elevenlabs" = "openai") => {
    e.preventDefault();
    e.stopPropagation();
    const key = engine === "elevenlabs" ? `elevenlabs:${voiceId}` : voiceId;

    if (previewingVoice === key) {
      audioRef.current?.pause();
      setPreviewingVoice(null);
      return;
    }

    audioRef.current?.pause();
    setPreviewingVoice(null);
    setLoadingVoice(key);

    try {
      const url = engine === "elevenlabs"
        ? `/api/ai-voice/preview?engine=elevenlabs&voiceId=${encodeURIComponent(voiceId)}`
        : `/api/ai-voice/preview?voice=${voiceId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Preview failed");
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
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

  const [formData, setFormData] = useState<any>({
    voice: "",
    language: "en-US",
    greeting: "",
    systemPrompt: "",
    voiceStyle: "",
    maxCallDuration: 300,
    speechTimeout: 1.0,
    maxTokens: 100,
    campaignVoiceEngine: "google",
    elevenLabsVoiceId: "",
    aiVoiceEngine: "openai",
  });
  const initRef = useRef(false);

  useEffect(() => {
    if (config && !initRef.current) {
      setFormData({
        voice: config.voice,
        language: config.language ?? "en-US",
        greeting: config.greeting,
        systemPrompt: config.systemPrompt,
        voiceStyle: config.voiceStyle ?? "",
        maxCallDuration: config.maxCallDuration,
        speechTimeout: config.speechTimeout ?? 1.0,
        maxTokens: config.maxTokens ?? 100,
        campaignVoiceEngine: (config as any).campaignVoiceEngine ?? "google",
        elevenLabsVoiceId: (config as any).elevenLabsVoiceId ?? "",
        aiVoiceEngine: (config as any).aiVoiceEngine ?? "openai",
      });
      initRef.current = true;
    }
  }, [config]);

  // Resolve template vars for the live preview — prefer scoped company's first number
  const scopedNumbers = scopedCompanyId
    ? phoneNumbers?.filter(n => (n as any).companyId === scopedCompanyId)
    : null;
  const firstNumber = scopedNumbers?.length ? scopedNumbers[0] : phoneNumbers?.[0];
  const linkedCompany = scopedCompany ?? (firstNumber?.companyId
    ? companies?.find((c: any) => c.id === firstNumber.companyId)
    : null);
  const previewCompanyName = linkedCompany?.name ?? firstNumber?.callerIdName ?? null;
  const previewPhoneNumber = firstNumber?.number ?? null;

  const elevenLabsLanguageOptions = Array.from(
    new Set(
      (elevenLabsVoices?.voices ?? []).flatMap(v => [v.language, ...(v.languages ?? [])].filter(Boolean) as string[])
    )
  ).sort((a, b) => languageLabel(a).localeCompare(languageLabel(b)));

  const filteredElevenLabsVoices = (elevenLabsVoices?.voices ?? []).filter(v =>
    voiceLangFilter === "all" || v.language === voiceLangFilter || v.languages?.includes(voiceLangFilter)
  );

  const resolvedPrompt = resolvePromptTemplate(formData.systemPrompt ?? "", {
    companyName: previewCompanyName,
    phoneNumber: previewPhoneNumber,
    callerNumber: "<caller number>",
  });

  const handleSave = () => {
    updateMutation.mutate({ data: formData }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAiVoiceConfigQueryKey() });
        toast({ title: "Settings saved", description: "AI Voice configuration updated globally." });
      },
      onError: (err: any) => {
        toast({ title: "Save failed", description: err.message, variant: "destructive" });
      }
    });
  };

  if (isLoading) {
    return <div className="space-y-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-[400px] w-full" /></div>;
  }

  const selectedLang = LANGUAGES.find(l => l.id === formData.language);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          {scopedCompany && (
            <div className="flex items-center gap-2 mb-1.5">
              <button
                onClick={() => navigate(`/companies/${scopedCompany.id}`)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Building2 className="h-3.5 w-3.5" />
                {scopedCompany.name}
              </button>
              <span className="text-muted-foreground/40 text-xs">/</span>
              <span className="text-xs text-foreground font-medium">AI Settings</span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {scopedCompany ? `${scopedCompany.name} — AI Voice Settings` : "AI Voice Settings"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {scopedCompany
              ? `Global AI defaults — prompt preview uses ${scopedCompany.name}'s numbers. Per-number overrides configured on each number.`
              : "Default AI configuration for incoming calls. Each phone number can override these settings individually."}
          </p>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          Save Defaults
        </Button>
      </div>

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary mb-2">
            <Bot className="h-5 w-5" />
            <CardTitle>System Persona</CardTitle>
          </div>
          <CardDescription>Configure how the AI introduces itself and behaves during calls.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* AI Voice Answering Engine */}
          <div className="space-y-2">
            <Label className="text-green-400">Voice Engine</Label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, aiVoiceEngine: "openai" })}
                className={`relative flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                  formData.aiVoiceEngine === "openai"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border/80 hover:bg-muted/30"
                }`}
              >
                {formData.aiVoiceEngine === "openai" && (
                  <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
                )}
                <span className="font-semibold text-sm text-foreground">OpenAI TTS</span>
                <span className="text-xs text-muted-foreground">Fast, no extra API key required.</span>
              </button>

              <button
                type="button"
                onClick={() => setFormData({ ...formData, aiVoiceEngine: "elevenlabs" })}
                className={`relative flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                  formData.aiVoiceEngine === "elevenlabs"
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border/80 hover:bg-muted/30"
                }`}
              >
                {formData.aiVoiceEngine === "elevenlabs" && (
                  <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
                )}
                <span className="font-semibold text-sm text-foreground">ElevenLabs</span>
                <span className="text-xs text-muted-foreground">Real human-sounding voices. Import voices in your ElevenLabs account.</span>
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Engine used for inbound AI call answering. Can be overridden per phone number.
            </p>
          </div>

          {/* Voice + Language row */}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label className="text-green-400">Voice</Label>
              {formData.aiVoiceEngine === "elevenlabs" ? (
                <>
                  {elevenLabsLanguageOptions.length > 1 && (
                    <Select value={voiceLangFilter} onValueChange={setVoiceLangFilter}>
                      <SelectTrigger className="bg-background h-8 text-xs mb-1.5">
                        <SelectValue placeholder="Filter by language" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[240px]" style={{ maxHeight: 240 }}>
                        <SelectItem value="all">All languages</SelectItem>
                        {elevenLabsLanguageOptions.map(code => (
                          <SelectItem key={code} value={code}>{languageLabel(code)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={formData.elevenLabsVoiceId || ""} onValueChange={(v) => setFormData({...formData, elevenLabsVoiceId: v})}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select an ElevenLabs voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredElevenLabsVoices.length === 0 && (
                        <div className="px-2 py-3 text-xs text-muted-foreground text-center">No voices for this language</div>
                      )}
                      {filteredElevenLabsVoices.map(v => {
                        const displayLang = voiceLangFilter !== "all" && v.languages?.includes(voiceLangFilter)
                          ? voiceLangFilter
                          : v.language;
                        const otherCount = (v.languages?.length ?? (v.language ? 1 : 0)) - (displayLang ? 1 : 0);
                        return (
                        <SelectItem key={v.voiceId} value={v.voiceId} className="pr-2" onSelect={(e) => e.preventDefault()}>
                          <div className="flex items-center gap-2 w-full">
                            <Mic2 className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium">{v.name}</span>
                            {displayLang && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-primary/15 text-primary uppercase tracking-wide">
                                {languageLabel(displayLang)}
                              </span>
                            )}
                            {v.accent && <span className="text-muted-foreground text-xs">— {v.accent}</span>}
                            {otherCount > 0 && (
                              <span className="text-muted-foreground text-xs">+{otherCount} more</span>
                            )}
                            <button
                              type="button"
                              onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              onClick={(e) => playVoicePreview(e, v.voiceId, "elevenlabs")}
                              className={`ml-auto shrink-0 flex items-center justify-center h-6 w-6 rounded transition-colors ${
                                previewingVoice === `elevenlabs:${v.voiceId}`
                                  ? "bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400"
                                  : loadingVoice === `elevenlabs:${v.voiceId}`
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                              }`}
                            >
                              {loadingVoice === `elevenlabs:${v.voiceId}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : previewingVoice === `elevenlabs:${v.voiceId}` ? (
                                <Square className="h-3 w-3 fill-current" />
                              ) : (
                                <Play className="h-3.5 w-3.5 fill-current" />
                              )}
                            </button>
                          </div>
                        </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  {formData.elevenLabsVoiceId && (
                    <button
                      type="button"
                      onClick={(e) => playVoicePreview(e, formData.elevenLabsVoiceId, "elevenlabs")}
                      className={`flex items-center gap-2 px-3 h-8 rounded text-xs font-medium transition-colors border ${
                        previewingVoice === `elevenlabs:${formData.elevenLabsVoiceId}`
                          ? "border-green-500/40 bg-green-500/10 text-green-400 hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400"
                          : loadingVoice === `elevenlabs:${formData.elevenLabsVoiceId}`
                          ? "border-border bg-muted/20 text-muted-foreground cursor-wait"
                          : "border-border bg-muted/20 text-muted-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary"
                      }`}
                    >
                      {loadingVoice === `elevenlabs:${formData.elevenLabsVoiceId}` ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : previewingVoice === `elevenlabs:${formData.elevenLabsVoiceId}` ? (
                        <Square className="h-3 w-3 fill-current" />
                      ) : (
                        <Play className="h-3 w-3 fill-current" />
                      )}
                      {previewingVoice === `elevenlabs:${formData.elevenLabsVoiceId}` ? "Stop preview" : loadingVoice === `elevenlabs:${formData.elevenLabsVoiceId}` ? "Loading…" : "Test selected voice"}
                    </button>
                  )}
                  {!elevenLabsVoices?.voices?.length ? (
                    <p className="text-xs text-amber-500">No ElevenLabs voices found. Import voices in your ElevenLabs account, or check the API key.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Human voice used for synthesis. Same voice library used for campaign calls.</p>
                  )}
                </>
              ) : (
                <>
                  <Select value={formData.voice} onValueChange={(v) => setFormData({...formData, voice: v})}>
                    <SelectTrigger className="bg-background">
                      <SelectValue placeholder="Select voice">
                        {formData.voice && (() => {
                          const v = VOICES.find(v => v.id === formData.voice);
                          return v ? (
                            <div className="flex items-center gap-2">
                              <Mic2 className="h-4 w-4 text-muted-foreground" />
                              <span>{v.name}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${v.gender === "Female" ? "bg-pink-500/20 text-pink-400" : "bg-blue-500/20 text-blue-400"}`}>{v.gender}</span>
                            </div>
                          ) : null;
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {["Female", "Male"].map(gender => (
                        <div key={gender}>
                          <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{gender}</div>
                          {VOICES.filter(v => v.gender === gender).map(v => (
                            <SelectItem key={v.id} value={v.id} className="pr-2" onSelect={(e) => e.preventDefault()}>
                              <div className="flex items-center gap-2 w-full">
                                <Mic2 className="h-4 w-4 text-muted-foreground shrink-0" />
                                <span className="font-medium">{v.name}</span>
                                <span className="text-muted-foreground text-xs">— {v.desc}</span>
                                <button
                                  type="button"
                                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                  onClick={(e) => playVoicePreview(e, v.id)}
                                  className={`ml-auto shrink-0 flex items-center justify-center h-6 w-6 rounded transition-colors ${
                                    previewingVoice === v.id
                                      ? "bg-green-500/20 text-green-400 hover:bg-red-500/20 hover:text-red-400"
                                      : loadingVoice === v.id
                                      ? "text-muted-foreground"
                                      : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                                  }`}
                                >
                                  {loadingVoice === v.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : previewingVoice === v.id ? (
                                    <Square className="h-3 w-3 fill-current" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5 fill-current" />
                                  )}
                                </button>
                              </div>
                            </SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">OpenAI TTS voice used for synthesis.</p>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-green-400">Language</Label>
              <Select value={formData.language} onValueChange={(v) => setFormData({...formData, language: v})}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select language">
                    {selectedLang && (
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{selectedLang.flag}</span>
                        {selectedLang.label}
                      </div>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => (
                    <SelectItem key={l.id} value={l.id}>
                      <div className="flex items-center gap-2">
                        <Globe className="h-4 w-4 text-muted-foreground" />
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{l.flag}</span>
                        {l.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sets speech recognition and AI response language.
                {formData.language === "ar-SA" && (
                  <span className="block mt-1 text-amber-500">Set your greeting and system prompt in Arabic below.</span>
                )}
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-green-400">Speaking Style</Label>
            <Textarea
              value={formData.voiceStyle}
              onChange={e => setFormData({...formData, voiceStyle: e.target.value})}
              className="min-h-[100px] font-mono text-sm bg-background leading-relaxed"
              placeholder="e.g. Speak with a warm, confident tone. Add natural pauses. Sound professional but approachable — not robotic."
            />
            <p className="text-xs text-muted-foreground">
              Instructions fed directly to the TTS model to shape delivery: pace, tone, emotion, emphasis. Leave blank for the model's default style.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="text-green-400">Initial Greeting</Label>
            <Input 
              value={formData.greeting} 
              onChange={e => setFormData({...formData, greeting: e.target.value})}
              className="bg-background"
              dir={formData.language === "ar-SA" ? "rtl" : "ltr"}
            />
            <p className="text-xs text-muted-foreground">The first sentence spoken when the AI answers the call.</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-green-400">System Prompt (Instructions)</Label>
              <button
                type="button"
                onClick={() => setShowPreview(p => !p)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? "Hide preview" : "Preview resolved"}
              </button>
            </div>

            <Textarea 
              value={formData.systemPrompt} 
              onChange={e => setFormData({...formData, systemPrompt: e.target.value})}
              className="min-h-[220px] font-mono text-sm bg-background leading-relaxed"
              dir={formData.language === "ar-SA" ? "rtl" : "ltr"}
            />

            {/* Variable reference chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[
                { token: "{{company_name}}", value: previewCompanyName },
                { token: "{{phone_number}}", value: previewPhoneNumber },
                { token: "{{caller_number}}", value: "<caller number>" },
              ].map(({ token, value }) => (
                <span key={token} className="inline-flex items-center gap-1 text-xs bg-muted/60 border border-border rounded px-2 py-0.5 font-mono">
                  <span className="text-primary">{token}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-foreground">{value ?? "not set"}</span>
                </span>
              ))}
              <span className="inline-flex items-center gap-1 text-xs bg-muted/60 border border-border rounded px-2 py-0.5 font-mono">
                <span className="text-primary">{`{{anything else}}`}</span>
                <span className="text-muted-foreground">→ literal text</span>
              </span>
            </div>

            {/* Resolved preview panel */}
            {showPreview && (
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Resolved preview
                  {previewCompanyName && (
                    <span className="normal-case font-normal ml-1">
                      — based on <span className="text-foreground">{firstNumber?.number}</span>
                      {linkedCompany && <> / <span className="text-foreground">{linkedCompany.name}</span></>}
                    </span>
                  )}
                </p>
                <pre className="text-sm whitespace-pre-wrap leading-relaxed text-foreground font-mono">
                  {resolvedPrompt}
                </pre>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Core instructions that shape the AI's personality, knowledge, and boundaries. Can be overridden per phone number.
            </p>
          </div>

          <div className="space-y-2 border-t border-border pt-6">
            <Label className="text-green-400">Max Call Duration (seconds)</Label>
            <Input 
              type="number" 
              value={formData.maxCallDuration} 
              onChange={e => setFormData({...formData, maxCallDuration: Number(e.target.value)})}
              className="w-[200px] bg-background font-mono"
            />
            <p className="text-xs text-muted-foreground">Hard cutoff to prevent runaway costs.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary mb-2">
            <Zap className="h-5 w-5" />
            <CardTitle>Response Speed</CardTitle>
          </div>
          <CardDescription>Control how quickly the AI reacts and how long its replies are.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">

          {/* Reaction Pause */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-green-400">Reaction Pause</Label>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {formData.speechTimeout.toFixed(1)}s
              </span>
            </div>
            <Slider
              min={0.5}
              max={3}
              step={0.1}
              value={[formData.speechTimeout]}
              onValueChange={([v]) => setFormData({...formData, speechTimeout: parseFloat(v.toFixed(1))})}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>0.5s — snappy</span>
              <span>1.5s — balanced</span>
              <span>3s — patient</span>
            </div>
            <p className="text-xs text-muted-foreground">
              How long after you stop talking before the AI begins processing. Try <strong className="text-foreground">0.7s–0.9s</strong> for a middle ground — fast without cutting off mid-sentence.
            </p>
          </div>

          {/* Response Length */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-green-400">Response Length</Label>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {formData.maxTokens <= 60 ? "Brief" : formData.maxTokens <= 120 ? "Balanced" : "Detailed"} ({formData.maxTokens} tokens)
              </span>
            </div>
            <Slider
              min={40}
              max={200}
              step={20}
              value={[formData.maxTokens]}
              onValueChange={([v]) => setFormData({...formData, maxTokens: v})}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>40 — very brief</span>
              <span>100 — balanced</span>
              <span>200 — detailed</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Maximum length of each AI response. Shorter responses generate faster and keep the conversation moving. Longer responses allow more complete answers.
            </p>
          </div>

        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <div className="flex items-center gap-2 text-primary mb-2">
            <Waves className="h-5 w-5" />
            <CardTitle>Campaign Voice Engine</CardTitle>
          </div>
          <CardDescription>Choose the TTS engine used for outbound campaign calls. ElevenLabs produces more natural, human-sounding Arabic speech.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, campaignVoiceEngine: "google" })}
              className={`relative flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                formData.campaignVoiceEngine === "google"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border/80 hover:bg-muted/30"
              }`}
            >
              {formData.campaignVoiceEngine === "google" && (
                <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
              )}
              <span className="font-semibold text-sm text-foreground">Google Neural2</span>
              <span className="text-xs text-muted-foreground">Arabic Neural2-C — current engine, no extra API key required.</span>
            </button>

            <button
              type="button"
              onClick={() => setFormData({ ...formData, campaignVoiceEngine: "elevenlabs" })}
              className={`relative flex flex-col gap-1 rounded-lg border p-4 text-left transition-colors ${
                formData.campaignVoiceEngine === "elevenlabs"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-border/80 hover:bg-muted/30"
              }`}
            >
              {formData.campaignVoiceEngine === "elevenlabs" && (
                <span className="absolute top-3 right-3 h-2 w-2 rounded-full bg-primary" />
              )}
              <span className="font-semibold text-sm text-foreground">ElevenLabs</span>
              <span className="text-xs text-muted-foreground">Multilingual v2 — more natural Arabic voice. Requires API key + Voice ID.</span>
            </button>
          </div>

          {formData.campaignVoiceEngine === "elevenlabs" && (
            <div className="space-y-4 pt-2 border-t border-border">
              <div className="space-y-2">
                <Label className="text-green-400">ElevenLabs Voice ID</Label>
                <Input
                  value={formData.elevenLabsVoiceId ?? ""}
                  onChange={e => setFormData({ ...formData, elevenLabsVoiceId: e.target.value })}
                  className="bg-background font-mono text-sm"
                  placeholder="e.g. EXAVITQu4vr4xnSDxMaL"
                />
                <p className="text-xs text-muted-foreground">
                  Find your Voice ID in the ElevenLabs dashboard under Voices. Use a multilingual v2-compatible voice for best Arabic quality.
                  The <span className="font-mono text-foreground">ELEVENLABS_API_KEY</span> secret must also be set in your environment.
                </p>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
