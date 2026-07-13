import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAiVoiceConfig,
  useUpdateAiVoiceConfig,
  getGetAiVoiceConfigQueryKey,
  useListElevenLabsVoices,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Bot, Save, Loader2, Mic2, Globe, Play, Square, Eye, EyeOff, Zap } from "lucide-react";

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

export const GLOBAL_AI_LANGUAGES = [
  { id: "en-US", label: "English (US)", flag: "EN" },
  { id: "ar-LB", label: "Arabic (Lebanon)", flag: "AR" },
  { id: "ar-SA", label: "Arabic (Saudi Arabia)", flag: "AR" },
];

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

export function GlobalAiSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data: config } = useGetAiVoiceConfig();
  const updateMutation = useUpdateAiVoiceConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: elevenLabsVoices } = useListElevenLabsVoices();

  const [formData, setFormData] = useState<any>({
    voice: "", language: "en-US", greeting: "", systemPrompt: "",
    voiceStyle: "", maxCallDuration: 300, speechTimeout: 1.0, maxTokens: 100,
    campaignVoiceEngine: "google", elevenLabsVoiceId: "", aiVoiceEngine: "openai",
  });
  const initRef = useRef(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [voiceLangFilter, setVoiceLangFilter] = useState("all");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (config && !initRef.current) {
      setFormData({
        voice: config.voice ?? "",
        language: config.language ?? "en-US",
        greeting: config.greeting ?? "",
        systemPrompt: config.systemPrompt ?? "",
        voiceStyle: (config as any).voiceStyle ?? "",
        maxCallDuration: config.maxCallDuration ?? 300,
        speechTimeout: (config as any).speechTimeout ?? 1.0,
        maxTokens: (config as any).maxTokens ?? 100,
        campaignVoiceEngine: (config as any).campaignVoiceEngine ?? "google",
        elevenLabsVoiceId: (config as any).elevenLabsVoiceId ?? "",
        aiVoiceEngine: (config as any).aiVoiceEngine ?? "openai",
      });
      initRef.current = true;
    }
  }, [config]);

  useEffect(() => {
    if (open) initRef.current = false;
  }, [open]);

  const elevenLabsLanguageOptions = Array.from(
    new Set((elevenLabsVoices?.voices ?? []).flatMap(v => [v.language, ...(v.languages ?? [])].filter(Boolean) as string[]))
  ).sort();

  const filteredElevenLabsVoices = (elevenLabsVoices?.voices ?? []).filter(v =>
    voiceLangFilter === "all" || v.language === voiceLangFilter || v.languages?.includes(voiceLangFilter)
  );

  const playPreview = async (e: React.MouseEvent, engine: "openai" | "elevenlabs", voiceId: string, lang?: string) => {
    e.preventDefault(); e.stopPropagation();
    const key = `${engine}:${voiceId}`;
    if (previewingVoice === key) { audioRef.current?.pause(); setPreviewingVoice(null); return; }
    audioRef.current?.pause(); setPreviewingVoice(null); setLoadingVoice(key);
    try {
      const url = engine === "elevenlabs"
        ? `/api/ai-voice/preview?engine=elevenlabs&voiceId=${encodeURIComponent(voiceId)}${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`
        : `/api/ai-voice/preview?voice=${voiceId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const audio = new Audio(objectUrl);
      audioRef.current = audio;
      audio.onended = () => { setPreviewingVoice(null); URL.revokeObjectURL(objectUrl); };
      audio.onerror  = () => { setPreviewingVoice(null); URL.revokeObjectURL(objectUrl); };
      setLoadingVoice(null); setPreviewingVoice(key); audio.play();
    } catch { setLoadingVoice(null); setPreviewingVoice(null); }
  };

  const handleSave = () => {
    updateMutation.mutate({ data: formData }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAiVoiceConfigQueryKey() });
        toast({ title: "AI settings saved", description: "Global defaults updated." });
        onOpenChange(false);
      },
      onError: (err: any) => {
        toast({ title: "Save failed", description: err.message, variant: "destructive" });
      }
    });
  };

  const resolvedPrompt = resolvePromptTemplate(formData.systemPrompt ?? "", {
    companyName: "{{company_name}}", phoneNumber: "{{phone_number}}", callerNumber: "<caller>",
  });

  const selectedLang = GLOBAL_AI_LANGUAGES.find(l => l.id === formData.language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Bot className="h-5 w-5 text-primary" />
            AI Voice Settings — Global Defaults
          </DialogTitle>
          <p className="text-xs text-muted-foreground pt-1">
            Shared defaults for all numbers. Per-number overrides are configured on each number's detail page.
          </p>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Voice Engine */}
          <div className="space-y-2">
            <Label className="text-green-400">Voice Engine</Label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: "openai",     label: "OpenAI TTS",  desc: "Fast, no extra API key required." },
                { id: "elevenlabs", label: "ElevenLabs",  desc: "Real human-sounding voices." },
              ].map(e => (
                <button key={e.id} type="button" onClick={() => setFormData({...formData, aiVoiceEngine: e.id})}
                  className={`relative flex flex-col gap-1 rounded-lg border p-3 text-left transition-colors ${formData.aiVoiceEngine === e.id ? "border-primary bg-primary/5" : "border-border hover:border-border/80 hover:bg-muted/30"}`}>
                  {formData.aiVoiceEngine === e.id && <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-primary" />}
                  <span className="font-semibold text-sm text-foreground">{e.label}</span>
                  <span className="text-xs text-muted-foreground">{e.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Voice + Language */}
          <div className="grid grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label className="text-green-400">Voice</Label>
              {formData.aiVoiceEngine === "elevenlabs" ? (
                <>
                  {elevenLabsLanguageOptions.length > 1 && (
                    <Select value={voiceLangFilter} onValueChange={setVoiceLangFilter}>
                      <SelectTrigger className="bg-background h-8 text-xs mb-1"><SelectValue placeholder="All languages" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All languages</SelectItem>
                        {elevenLabsLanguageOptions.map(code => <SelectItem key={code} value={code}>{code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={formData.elevenLabsVoiceId || ""} onValueChange={v => setFormData({...formData, elevenLabsVoiceId: v})}>
                    <SelectTrigger className="bg-background"><SelectValue placeholder="Select an ElevenLabs voice" /></SelectTrigger>
                    <SelectContent>
                      {filteredElevenLabsVoices.map(v => {
                        const displayLang = voiceLangFilter !== "all" && v.languages?.includes(voiceLangFilter) ? voiceLangFilter : v.language;
                        return (
                          <SelectItem key={v.voiceId} value={v.voiceId} className="pr-2" onSelect={e => e.preventDefault()}>
                            <div className="flex items-center gap-2 w-full">
                              <Mic2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium">{v.name}</span>
                              {displayLang && <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-primary/15 text-primary uppercase tracking-wide">{displayLang}</span>}
                              <button type="button" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}
                                onClick={e => playPreview(e, "elevenlabs", v.voiceId, displayLang || undefined)}
                                className={`ml-auto shrink-0 flex items-center justify-center h-6 w-6 rounded transition-colors ${previewingVoice === `elevenlabs:${v.voiceId}` ? "bg-green-500/20 text-green-400" : loadingVoice === `elevenlabs:${v.voiceId}` ? "text-muted-foreground" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>
                                {loadingVoice === `elevenlabs:${v.voiceId}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : previewingVoice === `elevenlabs:${v.voiceId}` ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                              </button>
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </>
              ) : (
                <Select value={formData.voice} onValueChange={v => setFormData({...formData, voice: v})}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select voice">
                      {formData.voice && (() => { const v = VOICES.find(v => v.id === formData.voice); return v ? <div className="flex items-center gap-2"><Mic2 className="h-4 w-4 text-muted-foreground" /><span>{v.name}</span><span className={`text-xs px-1.5 py-0.5 rounded font-medium ${v.gender === "Female" ? "bg-pink-500/20 text-pink-400" : "bg-blue-500/20 text-blue-400"}`}>{v.gender}</span></div> : null; })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {["Female", "Male"].map(gender => (
                      <div key={gender}>
                        <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">{gender}</div>
                        {VOICES.filter(v => v.gender === gender).map(v => (
                          <SelectItem key={v.id} value={v.id} className="pr-2" onSelect={e => e.preventDefault()}>
                            <div className="flex items-center gap-2 w-full">
                              <Mic2 className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="font-medium">{v.name}</span>
                              <span className="text-muted-foreground text-xs">— {v.desc}</span>
                              <button type="button" onPointerDown={e => { e.preventDefault(); e.stopPropagation(); }}
                                onClick={e => playPreview(e, "openai", v.id)}
                                className={`ml-auto shrink-0 flex items-center justify-center h-6 w-6 rounded transition-colors ${previewingVoice === `openai:${v.id}` ? "bg-green-500/20 text-green-400" : loadingVoice === `openai:${v.id}` ? "text-muted-foreground" : "text-muted-foreground hover:bg-primary/10 hover:text-primary"}`}>
                                {loadingVoice === `openai:${v.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : previewingVoice === `openai:${v.id}` ? <Square className="h-3 w-3 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                              </button>
                            </div>
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-green-400">Language</Label>
              <Select value={formData.language} onValueChange={v => setFormData({...formData, language: v})}>
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
                  {GLOBAL_AI_LANGUAGES.map(l => (
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
              <p className="text-xs text-muted-foreground">Sets speech recognition and response language.</p>
            </div>
          </div>

          {/* Speaking Style */}
          <div className="space-y-2">
            <Label className="text-green-400">Speaking Style</Label>
            <Textarea
              value={formData.voiceStyle}
              onChange={e => setFormData({...formData, voiceStyle: e.target.value})}
              className="min-h-[80px] font-mono text-sm bg-background"
              placeholder="e.g. Speak with a warm, confident tone. Add natural pauses..."
            />
            <p className="text-xs text-muted-foreground">Instructions to the TTS model shaping pace, tone, and delivery.</p>
          </div>

          {/* Greeting */}
          <div className="space-y-2">
            <Label className="text-green-400">Initial Greeting</Label>
            <Input
              value={formData.greeting}
              onChange={e => setFormData({...formData, greeting: e.target.value})}
              className="bg-background"
              dir={formData.language === "ar-SA" ? "rtl" : "ltr"}
              placeholder="Hello, thank you for calling. How can I help you today?"
            />
            <p className="text-xs text-muted-foreground">First sentence spoken when the AI answers.</p>
          </div>

          {/* System Prompt */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-green-400">System Prompt (Instructions)</Label>
              <button type="button" onClick={() => setShowPreview(p => !p)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showPreview ? "Hide preview" : "Preview resolved"}
              </button>
            </div>
            <Textarea
              value={formData.systemPrompt}
              onChange={e => setFormData({...formData, systemPrompt: e.target.value})}
              className="min-h-[180px] font-mono text-sm bg-background leading-relaxed"
              dir={formData.language === "ar-SA" ? "rtl" : "ltr"}
              placeholder="You are a professional phone agent for {{company_name}}..."
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {["{{company_name}}", "{{phone_number}}", "{{caller_number}}"].map(token => (
                <span key={token} className="inline-flex items-center gap-1 text-xs bg-muted/60 border border-border rounded px-2 py-0.5 font-mono">
                  <span className="text-primary">{token}</span>
                </span>
              ))}
            </div>
            {showPreview && (
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Resolved preview</p>
                <pre className="text-sm whitespace-pre-wrap leading-relaxed text-foreground font-mono">{resolvedPrompt}</pre>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Core instructions shaping the AI's personality. Can be overridden per number.</p>
          </div>

          {/* Response Settings */}
          <div className="space-y-3 border-t border-border pt-5">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <Label className="text-green-400">Response Settings</Label>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Max Duration (s)</Label>
                <Input type="number" value={formData.maxCallDuration}
                  onChange={e => setFormData({...formData, maxCallDuration: Number(e.target.value)})}
                  className="bg-background font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Reaction Pause (s)</Label>
                <Input type="number" step="0.1" min="0.5" max="3" value={formData.speechTimeout}
                  onChange={e => setFormData({...formData, speechTimeout: parseFloat(e.target.value)})}
                  className="bg-background font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">Max Tokens</Label>
                <Input type="number" step="20" min="40" max="200" value={formData.maxTokens}
                  onChange={e => setFormData({...formData, maxTokens: Number(e.target.value)})}
                  className="bg-background font-mono text-sm" />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-border">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Defaults
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
