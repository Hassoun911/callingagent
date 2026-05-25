import { useState, useEffect, useRef } from "react";
import { 
  useGetAiVoiceConfig, 
  useUpdateAiVoiceConfig,
  getGetAiVoiceConfigQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Bot, Save, Mic2 } from "lucide-react";
import { AiVoiceConfigUpdateVoice } from "@workspace/api-zod"; // Using type from api if needed, or inline string

const VOICES = [
  { id: "alloy", name: "Alloy (Neutral)" },
  { id: "echo", name: "Echo (Warm)" },
  { id: "fable", name: "Fable (Expressive)" },
  { id: "onyx", name: "Onyx (Deep)" },
  { id: "nova", name: "Nova (Energetic)" },
  { id: "shimmer", name: "Shimmer (Clear)" },
];

export default function Settings() {
  const { data: config, isLoading } = useGetAiVoiceConfig();
  const updateMutation = useUpdateAiVoiceConfig();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [formData, setFormData] = useState<any>({
    voice: "",
    greeting: "",
    systemPrompt: "",
    maxCallDuration: 300,
  });
  const initRef = useRef(false);

  useEffect(() => {
    if (config && !initRef.current) {
      setFormData({
        voice: config.voice,
        greeting: config.greeting,
        systemPrompt: config.systemPrompt,
        maxCallDuration: config.maxCallDuration
      });
      initRef.current = true;
    }
  }, [config]);

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

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">AI Voice Settings</h1>
          <p className="text-muted-foreground mt-1">Global configuration for AI answering agents.</p>
        </div>
        <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
          <Save className="h-4 w-4" />
          Save Global Config
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
          <div className="space-y-2">
            <Label>Voice Selection</Label>
            <div className="flex gap-4">
              <Select value={formData.voice} onValueChange={(v) => setFormData({...formData, voice: v})}>
                <SelectTrigger className="w-[300px] bg-background">
                  <SelectValue placeholder="Select voice" />
                </SelectTrigger>
                <SelectContent>
                  {VOICES.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      <div className="flex items-center gap-2">
                        <Mic2 className="h-4 w-4 text-muted-foreground" />
                        {v.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">OpenAI TTS models used for synthesis.</p>
          </div>

          <div className="space-y-2">
            <Label>Initial Greeting</Label>
            <Input 
              value={formData.greeting} 
              onChange={e => setFormData({...formData, greeting: e.target.value})}
              className="bg-background"
            />
            <p className="text-xs text-muted-foreground">The first sentence spoken when the AI answers the call.</p>
          </div>

          <div className="space-y-2">
            <Label>System Prompt (Instructions)</Label>
            <Textarea 
              value={formData.systemPrompt} 
              onChange={e => setFormData({...formData, systemPrompt: e.target.value})}
              className="min-h-[200px] font-mono text-sm bg-background leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">
              Core instructions that dictate the AI's knowledge, boundaries, and personality. 
              Can be overridden on a per-number basis.
            </p>
          </div>

          <div className="space-y-2 border-t border-border pt-6">
            <Label>Max Call Duration (seconds)</Label>
            <Input 
              type="number" 
              value={formData.maxCallDuration} 
              onChange={e => setFormData({...formData, maxCallDuration: Number(e.target.value)})}
              className="w-[200px] bg-background font-mono"
            />
            <p className="text-xs text-muted-foreground">Hard cutoff limit to prevent runaway costs.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
