import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Play, Pause, Trash2, Users, ChevronRight, Target } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  script: string;
  systemPrompt: string | null;
  fromPhoneNumberId: number | null;
  notificationEmail: string | null;
  status: "draft" | "active" | "paused" | "completed";
  maxCallDuration: number | null;
  createdAt: string;
  updatedAt: string;
  totalContacts: number | null;
  pendingContacts: number | null;
  completedContacts: number | null;
  interestedContacts: number | null;
}

interface PhoneNumber {
  id: number;
  number: string;
  friendlyName: string | null;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchCampaigns(): Promise<Campaign[]> {
  const r = await fetch(`${BASE}/api/campaigns`);
  if (!r.ok) throw new Error("Failed to fetch campaigns");
  return r.json();
}

async function fetchPhoneNumbers(): Promise<PhoneNumber[]> {
  const r = await fetch(`${BASE}/api/phone-numbers`);
  if (!r.ok) throw new Error("Failed to fetch phone numbers");
  return r.json();
}

function statusBadge(status: Campaign["status"]) {
  const variants: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-green-500/15 text-green-400 border border-green-500/20",
    paused: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
    completed: "bg-blue-500/15 text-blue-400 border border-blue-500/20",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider ${variants[status] ?? ""}`}>
      {status}
    </span>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] font-mono text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}

export default function Campaigns() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: "",
    script: "مرحبا، أنا سارة من The Property Cousins Group. أتواصل معك اليوم بخصوص عقارك. هل أنت مهتم بالبيع؟",
    systemPrompt: "",
    fromPhoneNumberId: "",
    notificationEmail: "",
    maxCallDuration: "300",
  });

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: fetchCampaigns,
    refetchInterval: 8000,
  });

  const { data: phoneNumbers = [] } = useQuery<PhoneNumber[]>({
    queryKey: ["phone-numbers"],
    queryFn: fetchPhoneNumbers,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch(`${BASE}/api/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          script: data.script,
          systemPrompt: data.systemPrompt || null,
          fromPhoneNumberId: data.fromPhoneNumberId ? parseInt(data.fromPhoneNumberId, 10) : null,
          notificationEmail: data.notificationEmail || null,
          maxCallDuration: parseInt(data.maxCallDuration, 10) || 300,
        }),
      });
      if (!r.ok) throw new Error("Failed to create campaign");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      setShowCreate(false);
      setForm({ name: "", script: "مرحبا، أنا سارة من The Property Cousins Group. أتواصل معك اليوم بخصوص عقارك. هل أنت مهتم بالبيع؟", systemPrompt: "", fromPhoneNumberId: "", notificationEmail: "", maxCallDuration: "300" });
      toast({ title: "Campaign created" });
    },
    onError: () => toast({ title: "Failed to create campaign", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`${BASE}/api/campaigns/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["campaigns"] }); toast({ title: "Campaign deleted" }); },
    onError: () => toast({ title: "Failed to delete campaign", variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, action }: { id: number; action: "start" | "pause" }) => {
      const r = await fetch(`${BASE}/api/campaigns/${id}/${action}`, { method: "POST" });
      if (!r.ok) throw new Error(`Failed to ${action} campaign`);
      return r.json();
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast({ title: vars.action === "start" ? "Campaign started — dialing contacts" : "Campaign paused" });
    },
    onError: (_, vars) => toast({ title: `Failed to ${vars.action} campaign`, variant: "destructive" }),
  });

  const totalContacts = campaigns.reduce((s, c) => s + (c.totalContacts ?? 0), 0);
  const totalInterested = campaigns.reduce((s, c) => s + (c.interestedContacts ?? 0), 0);
  const activeCampaigns = campaigns.filter(c => c.status === "active").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-green-400">Campaigns</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Outbound cold calling — AI-powered seller qualification</p>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Active Campaigns", value: activeCampaigns, accent: activeCampaigns > 0 },
          { label: "Total Contacts", value: totalContacts, accent: false },
          { label: "Hot Leads", value: totalInterested, accent: totalInterested > 0 },
        ].map(({ label, value, accent }) => (
          <div key={label} className="bg-card border border-border rounded-lg px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${accent ? "text-green-400" : "text-foreground"}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">Loading campaigns...</div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-3">
            <Target className="h-8 w-8 opacity-30" />
            <div className="text-sm">No campaigns yet. Create your first to start dialing.</div>
            <Button size="sm" onClick={() => setShowCreate(true)} variant="outline">Create Campaign</Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Campaign</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Progress</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Hot Leads</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Created</th>
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c, i) => (
                <tr key={c.id} className={`border-b border-border/50 hover:bg-secondary/20 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/5"}`}>
                  <td className="px-4 py-3">
                    <Link href={`/campaigns/${c.id}`} className="font-medium text-foreground hover:text-primary transition-colors flex items-center gap-1.5 group">
                      {c.name}
                      <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                    </Link>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {(c.totalContacts ?? 0)} contacts
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusBadge(c.status)}</td>
                  <td className="px-4 py-3 w-40">
                    {(c.totalContacts ?? 0) > 0 ? (
                      <>
                        <ProgressBar value={c.completedContacts ?? 0} max={c.totalContacts ?? 1} />
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {c.completedContacts ?? 0} / {c.totalContacts ?? 0} called
                        </div>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">No contacts</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {(c.interestedContacts ?? 0) > 0 ? (
                      <span className="text-green-400 font-bold text-sm">{c.interestedContacts}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {new Date(c.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1.5 justify-end">
                      {c.status === "active" ? (
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1" onClick={() => statusMutation.mutate({ id: c.id, action: "pause" })} disabled={statusMutation.isPending}>
                          <Pause className="h-3 w-3" />
                          Pause
                        </Button>
                      ) : c.status !== "completed" ? (
                        <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1 text-green-400 border-green-500/30 hover:bg-green-500/10" onClick={() => statusMutation.mutate({ id: c.id, action: "start" })} disabled={statusMutation.isPending || (c.totalContacts ?? 0) === 0}>
                          <Play className="h-3 w-3" />
                          {c.status === "paused" ? "Resume" : "Start"}
                        </Button>
                      ) : null}
                      <Link href={`/campaigns/${c.id}`}>
                        <Button size="sm" variant="ghost" className="h-7 px-2.5 text-xs gap-1">
                          <Users className="h-3 w-3" />
                          Contacts
                        </Button>
                      </Link>
                      <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive" onClick={() => { if (confirm(`Delete "${c.name}"?`)) deleteMutation.mutate(c.id); }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Cold Calling Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div>
              <Label>Campaign Name</Label>
              <Input className="mt-1.5" placeholder="e.g. Q1 Real Estate Outreach" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>

            {/* Mode toggle */}
            <div className="flex items-center gap-1 p-1 bg-secondary/40 rounded-lg w-fit">
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, systemPrompt: "" }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${!form.systemPrompt ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                Script Mode
              </button>
              <button
                type="button"
                onClick={() => setForm(f => ({ ...f, systemPrompt: f.systemPrompt || " " }))}
                className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${form.systemPrompt ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                AI Prompt Mode
              </button>
            </div>

            {!form.systemPrompt ? (
              <div>
                <Label>Opening Script (Arabic)</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">The AI reads this verbatim when the contact answers, then qualifies using the default prompt.</p>
                <Textarea className="mt-1.5 min-h-[100px] text-right" dir="rtl" placeholder="مرحبا، أنا سارة..." value={form.script} onChange={e => setForm(f => ({ ...f, script: e.target.value }))} />
              </div>
            ) : (
              <div>
                <Label>AI System Prompt</Label>
                <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">The AI generates its own opening and drives the entire conversation. The opening script is not used.</p>
                <Textarea
                  className="mt-1.5 min-h-[120px]"
                  placeholder="e.g. You are Sarah, a real estate agent from The Property Cousins Group. Call homeowners and determine if they are interested in selling..."
                  value={form.systemPrompt.trimStart()}
                  onChange={e => setForm(f => ({ ...f, systemPrompt: e.target.value }))}
                />
                <button type="button" className="mt-1.5 text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setForm(f => ({ ...f, systemPrompt: "" }))}>
                  Switch back to Script Mode
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>From Phone Number</Label>
                <select
                  className="mt-1.5 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.fromPhoneNumberId}
                  onChange={e => setForm(f => ({ ...f, fromPhoneNumberId: e.target.value }))}
                >
                  <option value="">Select a number...</option>
                  {phoneNumbers.map((p: PhoneNumber) => (
                    <option key={p.id} value={p.id}>{p.friendlyName ?? p.number} — {p.number}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Max Call Duration (seconds)</Label>
                <Input className="mt-1.5" type="number" min="60" max="600" value={form.maxCallDuration} onChange={e => setForm(f => ({ ...f, maxCallDuration: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label>Hot Lead Notification Email</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">Receive an email when a contact says they're interested in selling.</p>
              <Input className="mt-1.5" type="email" placeholder="agent@example.com" value={form.notificationEmail} onChange={e => setForm(f => ({ ...f, notificationEmail: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={() => createMutation.mutate(form)} disabled={!form.name || !form.script || createMutation.isPending}>
                {createMutation.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
