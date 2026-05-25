import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetPhoneNumber, 
  useUpdatePhoneNumber, 
  useReleasePhoneNumber, 
  getGetPhoneNumberQueryKey,
  useTestCall,
  useGetPhoneNumberTwilioStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Save, Trash2, PhoneCall, PhoneForwarded, Bot, Voicemail, Ban, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export default function NumberDetail() {
  const { id } = useParams();
  const numId = Number(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: number, isLoading } = useGetPhoneNumber(numId);
  const { data: twilioStatus, isLoading: twilioLoading, isError: twilioError } = useGetPhoneNumberTwilioStatus(numId);
  const updateMutation = useUpdatePhoneNumber();
  const releaseMutation = useReleasePhoneNumber({
    mutation: {
      onSuccess: () => {
        window.location.href = "/numbers";
      }
    }
  });
  const testCallMutation = useTestCall();

  const [formData, setFormData] = useState<any>({});
  const initRef = useRef(false);

  useEffect(() => {
    if (number && !initRef.current) {
      setFormData({
        friendlyName: number.friendlyName || "",
        callerIdName: number.callerIdName || "",
        forwardTo: number.forwardTo || "",
        ringCount: number.ringCount || 4,
        answerMode: number.answerMode || "forward",
        aiSystemPrompt: number.aiSystemPrompt || "",
        voicemailGreeting: number.voicemailGreeting || ""
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
    if (!formData.forwardTo && formData.answerMode === 'forward') {
      toast({ title: "Missing number", description: "Please specify a forward-to number to test.", variant: "destructive" });
      return;
    }
    const targetNumber = formData.answerMode === 'forward' ? formData.forwardTo : "+1234567890"; // Mock target for non-forward modes
    testCallMutation.mutate({
      id: numId,
      data: { toNumber: targetNumber }
    }, {
      onSuccess: () => {
        toast({ title: "Test call initiated", description: "Ringing destination number..." });
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
        <div className="flex gap-3">
          <Button variant="outline" onClick={handleTestCall} disabled={testCallMutation.isPending} className="gap-2">
            <PhoneCall className="h-4 w-4" />
            Test Routing
          </Button>
          <Button onClick={handleSave} disabled={updateMutation.isPending} className="gap-2">
            <Save className="h-4 w-4" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Routing Mode</CardTitle>
              <CardDescription>Determine how incoming calls are handled.</CardDescription>
            </CardHeader>
            <CardContent>
              <ToggleGroup 
                type="single" 
                value={formData.answerMode} 
                onValueChange={(val) => val && setFormData({ ...formData, answerMode: val })}
                className="justify-start bg-secondary/50 p-1 rounded-lg border border-border"
              >
                <ToggleGroupItem value="forward" className="data-[state=on]:bg-background data-[state=on]:shadow-sm px-6 py-2 h-auto gap-2">
                  <PhoneForwarded className="h-4 w-4" />
                  <div className="text-left">
                    <div className="font-medium text-sm">Forward</div>
                  </div>
                </ToggleGroupItem>
                <ToggleGroupItem value="ai_voice" className="data-[state=on]:bg-background data-[state=on]:shadow-sm px-6 py-2 h-auto gap-2">
                  <Bot className="h-4 w-4" />
                  <div className="text-left">
                    <div className="font-medium text-sm">AI Agent</div>
                  </div>
                </ToggleGroupItem>
                <ToggleGroupItem value="voicemail" className="data-[state=on]:bg-background data-[state=on]:shadow-sm px-6 py-2 h-auto gap-2">
                  <Voicemail className="h-4 w-4" />
                  <div className="text-left">
                    <div className="font-medium text-sm">Voicemail</div>
                  </div>
                </ToggleGroupItem>
                <ToggleGroupItem value="reject" className="data-[state=on]:bg-background data-[state=on]:shadow-sm px-6 py-2 h-auto gap-2">
                  <Ban className="h-4 w-4" />
                  <div className="text-left">
                    <div className="font-medium text-sm">Reject</div>
                  </div>
                </ToggleGroupItem>
              </ToggleGroup>

              <div className="mt-8 space-y-6">
                {formData.answerMode === 'forward' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-2">
                      <Label>Destination Number</Label>
                      <Input 
                        placeholder="+1 (555) 000-0000" 
                        value={formData.forwardTo} 
                        onChange={(e) => setFormData({...formData, forwardTo: e.target.value})}
                        className="font-mono bg-background"
                      />
                      <p className="text-xs text-muted-foreground">Calls will be routed to this number.</p>
                    </div>
                    <div className="space-y-4 pt-2 border-t border-border">
                      <div className="flex items-center justify-between">
                        <Label>Ring Count</Label>
                        <span className="font-mono text-sm text-muted-foreground">{formData.ringCount} rings</span>
                      </div>
                      <Slider 
                        value={[formData.ringCount]} 
                        min={1} 
                        max={10} 
                        step={1}
                        onValueChange={([val]) => setFormData({...formData, ringCount: val})}
                      />
                      <p className="text-xs text-muted-foreground">Number of rings before falling back to voicemail.</p>
                    </div>
                  </div>
                )}

                {formData.answerMode === 'ai_voice' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-2">
                      <Label>AI System Prompt (Optional Override)</Label>
                      <Textarea 
                        placeholder="Leave blank to use global AI settings, or provide a specific prompt for this line..." 
                        value={formData.aiSystemPrompt} 
                        onChange={(e) => setFormData({...formData, aiSystemPrompt: e.target.value})}
                        className="h-40 bg-background font-mono text-sm"
                      />
                      <p className="text-xs text-muted-foreground">Overrides the global AI prompt for calls to this specific number.</p>
                    </div>
                  </div>
                )}

                {formData.answerMode === 'voicemail' && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="space-y-2">
                      <Label>Voicemail Greeting Text</Label>
                      <Textarea 
                        placeholder="Please leave a message after the beep." 
                        value={formData.voicemailGreeting} 
                        onChange={(e) => setFormData({...formData, voicemailGreeting: e.target.value})}
                        className="bg-background"
                      />
                      <p className="text-xs text-muted-foreground">Text-to-speech will read this before recording starts.</p>
                    </div>
                  </div>
                )}

                {formData.answerMode === 'reject' && (
                  <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-md animate-in fade-in slide-in-from-top-2 duration-300">
                    <p className="text-sm text-red-500">All incoming calls to this number will be rejected immediately without answering.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-border">
            <CardHeader>
              <CardTitle>Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Internal Name</Label>
                <Input 
                  value={formData.friendlyName} 
                  onChange={(e) => setFormData({...formData, friendlyName: e.target.value})}
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label>Caller ID Name (CNAM)</Label>
                <Input 
                  value={formData.callerIdName} 
                  onChange={(e) => setFormData({...formData, callerIdName: e.target.value})}
                  className="bg-background"
                  maxLength={15}
                />
                <p className="text-xs text-muted-foreground">Max 15 characters.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader>
              <CardTitle>Line Status</CardTitle>
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
                      <span className="text-xs font-mono">{new Date(twilioStatus.dateCreated).toLocaleDateString()}</span>
                    </div>
                  )}
                  <div className="pt-1 border-t border-border">
                    <p className="text-xs text-muted-foreground font-mono truncate" title={twilioStatus.sid}>{twilioStatus.sid}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="border-border border-destructive/20 bg-destructive/5">
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
    </div>
  );
}
