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
import { ArrowLeft, Save, Trash2, PhoneCall, PhoneForwarded, Bot, Voicemail, Ban, CheckCircle2, AlertCircle, Loader2, ShieldCheck, MessageSquare, Keyboard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const PRESET_HOLD = "Connecting your call, please hold.";

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
        callScreen: number.callScreen ?? false,
        callScreenFallback: number.callScreenFallback || "voicemail",
        holdMessage: number.holdMessage ?? "",
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
                {formData.answerMode === 'forward' && (() => {
                  const callerExp = !formData.holdMessage
                    ? "ringing"
                    : formData.holdMessage === PRESET_HOLD
                      ? "connecting"
                      : "custom";
                  const radioBase = "flex items-start gap-3 w-full p-3 rounded-md border text-left transition-colors cursor-pointer";
                  const radioOn  = "border-primary bg-primary/10 text-foreground";
                  const radioOff = "border-border bg-background text-muted-foreground hover:border-muted-foreground hover:text-foreground";
                  const Radio = ({ on }: { on: boolean }) => (
                    <span className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${on ? "border-primary" : "border-muted-foreground"}`}>
                      {on && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                  );
                  return (
                    <div className="space-y-0 animate-in fade-in slide-in-from-top-2 duration-300">

                      {/* Destination number */}
                      <div className="space-y-2 pb-6">
                        <Label>Destination Number</Label>
                        <Input
                          placeholder="+1 (555) 000-0000"
                          value={formData.forwardTo}
                          onChange={(e) => setFormData({...formData, forwardTo: e.target.value})}
                          className="font-mono bg-background"
                        />
                        <p className="text-xs text-muted-foreground">Calls will be routed to this number.</p>
                      </div>

                      {/* When someone calls — caller experience */}
                      <div className="space-y-3 py-6 border-t border-border">
                        <div>
                          <Label>When Someone Calls</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">What does the caller hear while being connected?</p>
                        </div>
                        <div className="space-y-2">
                          <button type="button" onClick={() => setFormData({...formData, holdMessage: ""})} className={`${radioBase} ${callerExp === "ringing" ? radioOn : radioOff}`}>
                            <Radio on={callerExp === "ringing"} />
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium"><PhoneCall className="h-3.5 w-3.5" /> Ringing only</div>
                              <div className="text-xs opacity-70 mt-0.5">Caller hears standard ringing directly</div>
                            </div>
                          </button>
                          <button type="button" onClick={() => setFormData({...formData, holdMessage: PRESET_HOLD})} className={`${radioBase} ${callerExp === "connecting" ? radioOn : radioOff}`}>
                            <Radio on={callerExp === "connecting"} />
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium"><PhoneForwarded className="h-3.5 w-3.5" /> Connecting message then ringing</div>
                              <div className="text-xs opacity-70 mt-0.5">Plays "Connecting your call, please hold." then rings</div>
                            </div>
                          </button>
                          <button type="button" onClick={() => setFormData({...formData, holdMessage: callerExp === "custom" ? formData.holdMessage : ""})} className={`${radioBase} ${callerExp === "custom" ? radioOn : radioOff}`}>
                            <Radio on={callerExp === "custom"} />
                            <div>
                              <div className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="h-3.5 w-3.5" /> Custom message then ringing</div>
                              <div className="text-xs opacity-70 mt-0.5">Play your own recorded message before ringing starts</div>
                            </div>
                          </button>
                        </div>
                        {callerExp === "custom" && (
                          <input
                            type="text"
                            value={formData.holdMessage}
                            onChange={e => setFormData({...formData, holdMessage: e.target.value})}
                            placeholder="Type the message the caller will hear..."
                            className="w-full h-9 rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            autoFocus
                          />
                        )}
                      </div>

                      {/* When call routes to you — acceptance mode */}
                      <div className="space-y-3 py-6 border-t border-border">
                        <div>
                          <Label>When Call Routes to You</Label>
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
                        {formData.callScreen && (
                          <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                            <Label className="text-xs text-muted-foreground uppercase tracking-wider">If you don't answer, send to</Label>
                            <div className="grid grid-cols-2 gap-2">
                              <button type="button" onClick={() => setFormData({...formData, callScreenFallback: "ai_voice"})} className={`flex items-center gap-2 p-3 rounded-md border text-left transition-colors ${formData.callScreenFallback === "ai_voice" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground"}`}>
                                <Bot className="h-4 w-4 shrink-0" />
                                <div>
                                  <div className="text-sm font-medium">AI Agent</div>
                                  <div className="text-xs opacity-70">AI answers for you</div>
                                </div>
                              </button>
                              <button type="button" onClick={() => setFormData({...formData, callScreenFallback: "voicemail"})} className={`flex items-center gap-2 p-3 rounded-md border text-left transition-colors ${formData.callScreenFallback === "voicemail" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground"}`}>
                                <Voicemail className="h-4 w-4 shrink-0" />
                                <div>
                                  <div className="text-sm font-medium">Voicemail</div>
                                  <div className="text-xs opacity-70">Caller leaves a message</div>
                                </div>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Caller ID shown to you */}
                      <div className="space-y-3 py-6 border-t border-border">
                        <div>
                          <Label>Caller ID Shown to You</Label>
                          <p className="text-xs text-muted-foreground mt-0.5">What number appears on your phone when a call is forwarded?</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setFormData({...formData, forwardCallerId: "caller"})} className={`flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors ${formData.forwardCallerId === "caller" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground"}`}>
                            <span className="text-sm font-medium">Caller's Number</span>
                            <span className="text-xs opacity-70">Shows who's calling you</span>
                          </button>
                          <button type="button" onClick={() => setFormData({...formData, forwardCallerId: "line"})} className={`flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors ${formData.forwardCallerId === "line" ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-muted-foreground hover:border-muted-foreground"}`}>
                            <span className="text-sm font-medium">This Line's Number</span>
                            <span className="text-xs opacity-70">Always shows your Twilio number</span>
                          </button>
                        </div>
                      </div>

                      {/* Ring count */}
                      <div className="space-y-3 py-6 border-t border-border">
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
                  );
                })()}

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
                <Label>Display Name</Label>
                <Input 
                  value={formData.callerIdName} 
                  onChange={(e) => setFormData({...formData, callerIdName: e.target.value})}
                  className="bg-background"
                  maxLength={15}
                />
                <p className="text-xs text-muted-foreground">Used in the call screen announcement — "Incoming call for <em>{formData.callerIdName || "Solutions"}</em>." Also synced to Twilio as the line's friendly name. Max 15 characters.</p>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
                <p className="text-xs font-medium text-foreground">About caller name on your phone</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When a call is forwarded, your phone displays the caller's name via <strong className="text-foreground">CNAM</strong> — a carrier database separate from Twilio's friendly name. To make your phone show <em>{formData.callerIdName || "your line name"}</em> instead of a number, you need CNAM registration for this Twilio number.
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  In Twilio console: <strong className="text-foreground/80">Phone Numbers → Manage → select this number → Properties → Caller Name (CNAM)</strong>. Alternatively, enable "Require key press to accept" — the call screen verbally announces the line name before you pick up.
                </p>
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
