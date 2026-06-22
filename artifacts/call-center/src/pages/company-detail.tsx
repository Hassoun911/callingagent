import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useGetCompany, useUpdateCompany, getListCompaniesQueryKey, useListPhoneNumbers,
  useGetPhoneNumber, useUpdatePhoneNumber, getGetPhoneNumberQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft, Building2, Phone, Globe, Mail, Edit, Plus, Trash2,
  ChevronRight, Hash, PhoneForwarded, Bot, Voicemail, Ban, Target,
  Settings2, Save, Loader2, Users, Shield, ChevronDown, Copy, Check,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Extension {
  id: number;
  companyId: number;
  name: string;
  digit: string;
  forwardTo: string;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

async function fetchExtensions(companyId: number): Promise<Extension[]> {
  const r = await fetch(`${BASE}/api/companies/${companyId}/extensions`);
  if (!r.ok) throw new Error("Failed to fetch extensions");
  return r.json();
}

async function createExtension(companyId: number, body: Partial<Extension>): Promise<Extension> {
  const r = await fetch(`${BASE}/api/companies/${companyId}/extensions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function updateExtension(companyId: number, extId: number, body: Partial<Extension>): Promise<Extension> {
  const r = await fetch(`${BASE}/api/companies/${companyId}/extensions/${extId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function deleteExtension(companyId: number, extId: number): Promise<void> {
  await fetch(`${BASE}/api/companies/${companyId}/extensions/${extId}`, { method: "DELETE" });
}

async function linkPhoneNumber(phoneNumberId: number, companyId: number | null): Promise<void> {
  await fetch(`${BASE}/api/phone-numbers/${phoneNumberId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  });
}

async function setAnswerMode(phoneNumberId: number, answerMode: string): Promise<void> {
  await fetch(`${BASE}/api/phone-numbers/${phoneNumberId}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answerMode }),
  });
}

function NumberConfigPanel({ numberId, companyName }: { numberId: number; companyName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { data: number, isLoading } = useGetPhoneNumber(numberId);
  const updateMutation = useUpdatePhoneNumber();
  const initRef = useRef(false);

  const [form, setForm] = useState<any>({});

  const campaigns = useQuery({
    queryKey: ["campaigns-for-number", numberId],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/campaigns?phoneNumberId=${numberId}`);
      if (!r.ok) throw new Error("failed");
      return r.json() as Promise<Array<{ id: number; name: string; status: string; totalContacts: number }>>;
    },
    enabled: !!numberId,
  });

  useEffect(() => {
    initRef.current = false;
  }, [numberId]);

  useEffect(() => {
    if (number && !initRef.current) {
      setForm({
        friendlyName: number.friendlyName || "",
        callerIdName: number.callerIdName || "",
        forwardTo: number.forwardTo || "",
        ringCount: number.ringCount || 4,
        answerMode: number.answerMode || "forward",
        aiSystemPrompt: number.aiSystemPrompt || "",
        aiGreeting: number.aiGreeting || "",
        aiVoice: number.aiVoice || "",
        voicemailGreeting: number.voicemailGreeting || "",
        notificationEmail: number.notificationEmail || "",
      });
      initRef.current = true;
    }
  }, [number]);

  function handleSave() {
    updateMutation.mutate({ id: numberId, data: form }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetPhoneNumberQueryKey(numberId) });
        toast({ title: "Number configuration saved" });
      },
      onError: (err: any) => {
        toast({ title: "Save failed", description: err.message, variant: "destructive" });
      },
    });
  }

  if (isLoading) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  if (!number) return null;

  const mode = form.answerMode || "forward";

  const MODES = [
    { id: "forward",   label: "Forward",  icon: PhoneForwarded, color: "text-blue-400" },
    { id: "ai_voice",  label: "AI Voice", icon: Bot,            color: "text-green-400" },
    { id: "voicemail", label: "Voicemail",icon: Voicemail,      color: "text-yellow-400" },
    { id: "ivr",       label: "IVR",      icon: Hash,           color: "text-purple-400" },
    { id: "reject",    label: "Reject",   icon: Ban,            color: "text-red-400" },
  ];

  return (
    <div className="border-t border-border/50 bg-secondary/10 p-5 space-y-5">
      {/* Row 1: Friendly name + Caller ID */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Display Name</Label>
          <Input
            className="h-8 text-xs bg-background border-border"
            value={form.friendlyName}
            onChange={e => setForm((f: any) => ({ ...f, friendlyName: e.target.value }))}
            placeholder="e.g. Sales Line"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Caller ID Name</Label>
          <Input
            className="h-8 text-xs bg-background border-border"
            value={form.callerIdName}
            onChange={e => setForm((f: any) => ({ ...f, callerIdName: e.target.value }))}
            placeholder={companyName}
          />
        </div>
      </div>

      {/* Row 2: Answer Mode */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Answer Mode</Label>
        <div className="flex flex-wrap gap-2">
          {MODES.map(m => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setForm((f: any) => ({ ...f, answerMode: m.id }))}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  active
                    ? `bg-primary/10 border-primary/40 text-primary`
                    : "bg-background border-border text-muted-foreground hover:text-foreground hover:border-border/80"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? "text-primary" : m.color}`} />
                {m.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mode-specific fields */}
      {mode === "forward" && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Forward To</Label>
            <Input
              className="h-8 text-xs bg-background border-border font-mono"
              value={form.forwardTo}
              onChange={e => setForm((f: any) => ({ ...f, forwardTo: e.target.value }))}
              placeholder="+1 555 000 0000"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ring Count: {form.ringCount}</Label>
            <input
              type="range" min={1} max={10} value={form.ringCount}
              onChange={e => setForm((f: any) => ({ ...f, ringCount: Number(e.target.value) }))}
              className="w-full accent-primary h-1.5 mt-2"
            />
          </div>
        </div>
      )}

      {mode === "ai_voice" && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">AI Greeting</Label>
            <Input
              className="h-8 text-xs bg-background border-border"
              value={form.aiGreeting}
              onChange={e => setForm((f: any) => ({ ...f, aiGreeting: e.target.value }))}
              placeholder="Thank you for calling..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">AI System Prompt</Label>
            <Textarea
              className="text-xs bg-background border-border resize-none"
              rows={4}
              value={form.aiSystemPrompt}
              onChange={e => setForm((f: any) => ({ ...f, aiSystemPrompt: e.target.value }))}
              placeholder="You are a helpful assistant for..."
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notification Email</Label>
            <Input
              className="h-8 text-xs bg-background border-border"
              value={form.notificationEmail}
              onChange={e => setForm((f: any) => ({ ...f, notificationEmail: e.target.value }))}
              placeholder="alerts@company.com"
            />
          </div>
        </div>
      )}

      {(mode === "voicemail" || mode === "ai_voice") && (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Voicemail Greeting</Label>
          <Input
            className="h-8 text-xs bg-background border-border"
            value={form.voicemailGreeting}
            onChange={e => setForm((f: any) => ({ ...f, voicemailGreeting: e.target.value }))}
            placeholder="Please leave a message..."
          />
        </div>
      )}

      {/* Campaigns */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5" /> Campaigns
            {campaigns.data && campaigns.data.length > 0 && (
              <span className="ml-1 text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">{campaigns.data.length}</span>
            )}
          </Label>
          <button
            onClick={() => navigate(`/numbers/${numberId}`)}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            Manage <ChevronRight className="h-3 w-3" />
          </button>
        </div>
        {campaigns.data && campaigns.data.length > 0 ? (
          <div className="space-y-1">
            {campaigns.data.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-background border border-border rounded px-3 py-1.5 text-xs">
                <span className="text-foreground font-medium">{c.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`capitalize text-[10px] px-1.5 py-0.5 rounded ${c.status === "active" ? "bg-green-500/10 text-green-400" : "bg-secondary text-muted-foreground"}`}>{c.status}</span>
                  <button onClick={() => navigate(`/campaigns/${c.id}`)} className="text-primary hover:underline">Open</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No campaigns yet.</p>
        )}
      </div>

      {/* Save */}
      <div className="flex justify-end pt-1">
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleSave} disabled={updateMutation.isPending}>
          {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

function formatPhone(n: string) {
  const d = n.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  return n;
}

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const companyId = parseInt(id!, 10);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: company, isLoading: companyLoading } = useGetCompany(companyId);
  const { data: allNumbers } = useListPhoneNumbers();
  const linkedNumbers = allNumbers?.filter(n => n.companyId === companyId) ?? [];
  const linkedNumber = linkedNumbers[0] ?? null;

  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [extsLoading, setExtsLoading] = useState(true);

  const [editingCompany, setEditingCompany] = useState(false);
  const [companyForm, setCompanyForm] = useState({ name: "", industry: "", phone: "", email: "", website: "", notes: "" });

  const [extDialog, setExtDialog] = useState(false);
  const [editingExt, setEditingExt] = useState<Extension | null>(null);
  const [extForm, setExtForm] = useState({ name: "", digit: "1", forwardTo: "", description: "" });

  const [linkDialog, setLinkDialog] = useState(false);
  const [selectedNumberId, setSelectedNumberId] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [expandedNumberId, setExpandedNumberId] = useState<number | null>(null);

  type PortalUser = { id: number; username: string; email: string | null; role: string; isActive: boolean };
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userDialog, setUserDialog] = useState(false);
  const [userForm, setUserForm] = useState({ username: "", email: "", password: "", role: "company_user" });
  const [savingUser, setSavingUser] = useState(false);
  const [userError, setUserError] = useState("");
  const [copiedUrl, setCopiedUrl] = useState(false);

  const updateCompany = useUpdateCompany({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        setEditingCompany(false);
        toast({ title: "Company updated" });
      }
    }
  });

  useEffect(() => {
    if (!companyLoading && company) {
      setCompanyForm({
        name: company.name ?? "",
        industry: company.industry ?? "",
        phone: company.phone ?? "",
        email: (company as any).email ?? "",
        website: company.website ?? "",
        notes: (company as any).notes ?? "",
      });
    }
  }, [company, companyLoading]);

  useEffect(() => {
    if (!isNaN(companyId)) {
      setExtsLoading(true);
      fetchExtensions(companyId)
        .then(setExtensions)
        .catch(() => toast({ title: "Failed to load extensions", variant: "destructive" }))
        .finally(() => setExtsLoading(false));
    }
  }, [companyId]);

  async function loadPortalUsers() {
    setUsersLoading(true);
    try {
      const r = await fetch(`${BASE}/api/platform-users?companyId=${companyId}`, { credentials: "include" });
      if (r.ok) setPortalUsers(await r.json());
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    if (!isNaN(companyId)) loadPortalUsers();
  }, [companyId]);

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    setUserError("");
    try {
      const r = await fetch(`${BASE}/api/platform-users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...userForm, companyId, email: userForm.email || null }),
      });
      if (!r.ok) {
        const d = await r.json();
        setUserError(d.error ?? "Failed to create user");
      } else {
        setUserDialog(false);
        setUserForm({ username: "", email: "", password: "", role: "company_user" });
        loadPortalUsers();
        toast({ title: "User created" });
      }
    } finally {
      setSavingUser(false);
    }
  }

  async function toggleUserActive(userId: number, isActive: boolean) {
    await fetch(`${BASE}/api/platform-users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ isActive: !isActive }),
    });
    loadPortalUsers();
  }

  async function deletePortalUser(userId: number) {
    await fetch(`${BASE}/api/platform-users/${userId}`, { method: "DELETE", credentials: "include" });
    loadPortalUsers();
    toast({ title: "User deleted" });
  }

  function openNewExt() {
    setEditingExt(null);
    setExtForm({ name: "", digit: "1", forwardTo: "", description: "" });
    setExtDialog(true);
  }

  function openEditExt(ext: Extension) {
    setEditingExt(ext);
    setExtForm({ name: ext.name, digit: ext.digit, forwardTo: ext.forwardTo, description: ext.description ?? "" });
    setExtDialog(true);
  }

  async function saveExt() {
    if (!extForm.name || !extForm.digit || !extForm.forwardTo) {
      toast({ title: "Name, digit, and forward-to number are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (editingExt) {
        const updated = await updateExtension(companyId, editingExt.id, extForm);
        setExtensions(prev => prev.map(e => e.id === updated.id ? updated : e));
      } else {
        const created = await createExtension(companyId, extForm);
        setExtensions(prev => [...prev, created]);
      }
      setExtDialog(false);
      toast({ title: editingExt ? "Extension updated" : "Extension added" });
    } catch (err: any) {
      toast({ title: err.message ?? "Failed to save extension", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function deleteExt(ext: Extension) {
    try {
      await deleteExtension(companyId, ext.id);
      setExtensions(prev => prev.filter(e => e.id !== ext.id));
      toast({ title: "Extension deleted" });
    } catch {
      toast({ title: "Failed to delete extension", variant: "destructive" });
    }
  }

  async function toggleExt(ext: Extension) {
    const updated = await updateExtension(companyId, ext.id, { enabled: !ext.enabled });
    setExtensions(prev => prev.map(e => e.id === updated.id ? updated : e));
  }

  async function handleLinkNumber() {
    const numId = parseInt(selectedNumberId, 10);
    if (isNaN(numId)) return;
    setSaving(true);
    try {
      await linkPhoneNumber(numId, companyId);
      qc.invalidateQueries({ queryKey: ["listPhoneNumbers"] });
      setLinkDialog(false);
      toast({ title: "Phone number linked to company" });
    } catch {
      toast({ title: "Failed to link phone number", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleUnlinkNumber(phoneNumberId: number) {
    await linkPhoneNumber(phoneNumberId, null);
    qc.invalidateQueries({ queryKey: ["listPhoneNumbers"] });
    toast({ title: "Phone number unlinked" });
  }

  async function handleSetIvr(phoneNumberId: number, mode: string) {
    await setAnswerMode(phoneNumberId, mode);
    qc.invalidateQueries({ queryKey: ["listPhoneNumbers"] });
    toast({ title: `Answer mode set to ${mode}` });
  }

  if (companyLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!company) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        <Building2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <div>Company not found.</div>
      </div>
    );
  }

  const usedDigits = extensions.map(e => e.digit);
  const availableDigits = ["1","2","3","4","5","6","7","8","9"].filter(d => !usedDigits.includes(d) || d === extForm.digit);

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/companies")} className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <h1 className="text-xl font-bold tracking-tight truncate">{company.name}</h1>
          {company.industry && (
            <span className="text-xs px-2 py-0.5 rounded bg-secondary text-muted-foreground">{company.industry}</span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="ml-auto flex-shrink-0" onClick={() => setEditingCompany(true)}>
          <Edit className="h-4 w-4" />
        </Button>
      </div>

      {/* Company info */}
      {((company as any).email || company.phone || company.website || (company as any).notes) && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border bg-secondary/20">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contact Info</span>
          </div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            {(company as any).email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-xs text-muted-foreground/60 mr-1">Email</span>
                <span>{(company as any).email}</span>
              </div>
            )}
            {company.phone && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-xs text-muted-foreground/60 mr-1">Contact Phone</span>
                <span className="font-mono">{company.phone}</span>
              </div>
            )}
            {company.website && (
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="text-xs text-muted-foreground/60 mr-1">Website</span>
                <a href={`https://${company.website.replace(/^https?:\/\//, "")}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {company.website}
                </a>
              </div>
            )}
            {(company as any).notes && (
              <div className="sm:col-span-2 text-muted-foreground text-xs bg-secondary/30 rounded px-3 py-2">
                {(company as any).notes}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phone Numbers */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold">Phone Numbers</span>
            {linkedNumbers.length > 0 && (
              <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-semibold">{linkedNumbers.length}</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLinkDialog(true)}>
            <Plus className="h-3.5 w-3.5" /> Link Number
          </Button>
        </div>

        {linkedNumbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
            <Phone className="h-6 w-6 opacity-25" />
            <span className="text-xs">No phone numbers linked. Link a number to enable inbound calling.</span>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {linkedNumbers.map(ln => {
              const isExpanded = expandedNumberId === ln.id;
              return (
                <div key={ln.id}>
                  {/* Number header row */}
                  <div className="p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-sm font-medium">{formatPhone(ln.number)}</div>
                      {ln.friendlyName && (
                        <div className="text-xs text-muted-foreground mt-0.5">{ln.friendlyName}</div>
                      )}
                    </div>
                    <Badge variant="outline" className={`text-[10px] flex-shrink-0 ${
                      (ln.answerMode as string) === "ivr" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                      ln.answerMode === "forward" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                      ln.answerMode === "ai_voice" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                      "bg-secondary text-muted-foreground"
                    }`}>
                      {(ln.answerMode as string) === "ivr" ? "IVR" : ln.answerMode?.replace("_", " ")}
                    </Badge>
                    <Button
                      size="sm"
                      variant={isExpanded ? "default" : "outline"}
                      className="h-7 text-xs gap-1.5 flex-shrink-0"
                      onClick={() => setExpandedNumberId(isExpanded ? null : ln.id)}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Configure
                      <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground flex-shrink-0">
                          Unlink
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Unlink Phone Number</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the association between {company.name} and {ln.number}. The number will still exist in your account.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleUnlinkNumber(ln.id)}>Unlink</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  {/* Inline config panel */}
                  {isExpanded && (
                    <NumberConfigPanel numberId={ln.id} companyName={company.name} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Extensions / IVR */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Hash className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-semibold">Extensions (IVR)</span>
            {extensions.length > 0 && (
              <span className="text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20 px-1.5 py-0.5 rounded font-semibold">{extensions.length}</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openNewExt} disabled={availableDigits.length === 0}>
            <Plus className="h-3.5 w-3.5" /> Add Extension
          </Button>
        </div>

        {linkedNumbers.length === 0 && (
          <div className="px-4 py-3 bg-yellow-500/5 border-b border-yellow-500/10 text-xs text-yellow-400 flex items-center gap-2">
            <Phone className="h-3.5 w-3.5 flex-shrink-0" />
            Link a phone number above and set it to IVR mode for extensions to activate.
          </div>
        )}

        {extsLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : extensions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
            <Hash className="h-6 w-6 opacity-25" />
            <span className="text-xs">No extensions yet. Add one to enable IVR routing.</span>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {extensions.sort((a, b) => a.digit.localeCompare(b.digit)).map(ext => (
              <div key={ext.id} className="flex items-center gap-3 px-4 py-3">
                <div className="h-8 w-8 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-sm font-bold text-purple-400">{ext.digit}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{ext.name}</span>
                    {!ext.enabled && (
                      <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">Disabled</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <PhoneForwarded className="h-3 w-3 flex-shrink-0" />
                    <span className="font-mono">{ext.forwardTo}</span>
                    {ext.description && <span className="text-muted-foreground/60 ml-1">· {ext.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => toggleExt(ext)} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors" title={ext.enabled ? "Disable" : "Enable"}>
                    {ext.enabled ? <ToggleRight className="h-4 w-4 text-green-400" /> : <ToggleLeft className="h-4 w-4" />}
                  </button>
                  <button onClick={() => openEditExt(ext)} className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card border-border">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Extension</AlertDialogTitle>
                        <AlertDialogDescription>Delete extension {ext.digit} ({ext.name})?</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive" onClick={() => deleteExt(ext)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}

        {linkedNumbers.length > 0 && extensions.length > 0 && !linkedNumbers.some(n => (n.answerMode as string) === "ivr") && (
          <div className="px-4 py-3 border-t border-border bg-yellow-500/5 text-xs text-yellow-400 flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 flex-shrink-0" />
            Extensions configured but answer mode is not set to IVR. Click "IVR / Extensions" above to activate.
          </div>
        )}
      </div>

      {/* Portal Users */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold">Portal Users</span>
            {portalUsers.length > 0 && (
              <span className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-semibold">{portalUsers.length}</span>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => { setUserError(""); setUserDialog(true); }}>
            <Plus className="h-3.5 w-3.5" /> Add User
          </Button>
        </div>
        <div className="px-4 py-2 bg-blue-500/5 border-b border-blue-500/10 text-xs text-blue-300/70 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Shield className="h-3.5 w-3.5 flex-shrink-0" />
            <span>Share this login link with company admins:</span>
            <span className="font-mono text-blue-300 truncate">{window.location.origin}/</span>
          </div>
          <button
            onClick={() => {
              navigator.clipboard.writeText(`${window.location.origin}/`).then(() => {
                setCopiedUrl(true);
                setTimeout(() => setCopiedUrl(false), 2000);
              });
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border border-blue-500/20 hover:bg-blue-500/10 transition-colors flex-shrink-0"
          >
            {copiedUrl ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
            {copiedUrl ? "Copied" : "Copy"}
          </button>
        </div>
        {usersLoading ? (
          <div className="p-4 space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : portalUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-muted-foreground gap-1">
            <Users className="h-5 w-5 opacity-25" />
            <span className="text-xs">No portal users yet.</span>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {portalUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="h-7 w-7 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-blue-400">{u.username[0].toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{u.username}</span>
                    <span className="text-[10px] bg-secondary text-muted-foreground px-1.5 py-0.5 rounded capitalize">
                      {u.role === "company_admin" ? "Admin" : "User"}
                    </span>
                    {!u.isActive && <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">Disabled</span>}
                  </div>
                  {u.email && <p className="text-xs text-muted-foreground">{u.email}</p>}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button onClick={() => toggleUserActive(u.id, u.isActive)}
                    className="text-xs text-muted-foreground hover:text-foreground underline">
                    {u.isActive ? "Disable" : "Enable"}
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="bg-card border-border">
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete User</AlertDialogTitle>
                        <AlertDialogDescription>Delete user "{u.username}"? They will no longer be able to log in.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-destructive" onClick={() => deletePortalUser(u.id)}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add user dialog */}
      <Dialog open={userDialog} onOpenChange={setUserDialog}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader><DialogTitle>Add Portal User</DialogTitle></DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Username *</Label>
                <input required value={userForm.username} onChange={e => setUserForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full mt-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                  placeholder="username" />
              </div>
              <div>
                <Label>Role</Label>
                <Select value={userForm.role} onValueChange={v => setUserForm(f => ({ ...f, role: v }))}>
                  <SelectTrigger className="mt-1 bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="company_user">User</SelectItem>
                    <SelectItem value="company_admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Email <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <input type="email" value={userForm.email} onChange={e => setUserForm(f => ({ ...f, email: e.target.value }))}
                className="w-full mt-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="user@company.com" />
            </div>
            <div>
              <Label>Password *</Label>
              <input required type="password" value={userForm.password} onChange={e => setUserForm(f => ({ ...f, password: e.target.value }))}
                className="w-full mt-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
                placeholder="password" />
            </div>
            {userError && <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{userError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setUserDialog(false)}>Cancel</Button>
              <Button type="submit" disabled={savingUser}>{savingUser ? "Creating..." : "Create User"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit company dialog */}
      <Dialog open={editingCompany} onOpenChange={setEditingCompany}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader><DialogTitle>Edit Company</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div><Label>Company Name</Label><Input className="mt-1 bg-background" value={companyForm.name} onChange={e => setCompanyForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Industry</Label><Input className="mt-1 bg-background" value={companyForm.industry} onChange={e => setCompanyForm(f => ({ ...f, industry: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input className="mt-1 bg-background" value={companyForm.phone} onChange={e => setCompanyForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div><Label>Email</Label><Input className="mt-1 bg-background" value={companyForm.email} onChange={e => setCompanyForm(f => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div><Label>Website</Label><Input className="mt-1 bg-background" value={companyForm.website} onChange={e => setCompanyForm(f => ({ ...f, website: e.target.value }))} /></div>
            <div><Label>Notes</Label><Textarea className="mt-1 bg-background resize-none min-h-[70px]" value={companyForm.notes} onChange={e => setCompanyForm(f => ({ ...f, notes: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingCompany(false)}>Cancel</Button>
            <Button onClick={() => updateCompany.mutate({ id: companyId, data: companyForm })} disabled={updateCompany.isPending}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Extension dialog */}
      <Dialog open={extDialog} onOpenChange={setExtDialog}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader><DialogTitle>{editingExt ? "Edit Extension" : "Add Extension"}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Extension Digit</Label>
                <Select value={extForm.digit} onValueChange={v => setExtForm(f => ({ ...f, digit: v }))}>
                  <SelectTrigger className="mt-1 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["1","2","3","4","5","6","7","8","9"].map(d => (
                      <SelectItem key={d} value={d} disabled={usedDigits.includes(d) && d !== extForm.digit}>
                        Press {d} {usedDigits.includes(d) && d !== extForm.digit ? "(in use)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Name</Label>
                <Input className="mt-1 bg-background" placeholder="e.g. Payroll" value={extForm.name} onChange={e => setExtForm(f => ({ ...f, name: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Forward To (Phone Number)</Label>
              <Input className="mt-1 bg-background font-mono" placeholder="+1 555 000 0000" value={extForm.forwardTo} onChange={e => setExtForm(f => ({ ...f, forwardTo: e.target.value }))} />
              <p className="text-xs text-muted-foreground mt-1">Calls pressing this digit will be forwarded to this number.</p>
            </div>
            <div>
              <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input className="mt-1 bg-background" placeholder="e.g. HR department" value={extForm.description} onChange={e => setExtForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setExtDialog(false)}>Cancel</Button>
            <Button onClick={saveExt} disabled={saving}>Save</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Link number dialog */}
      <Dialog open={linkDialog} onOpenChange={setLinkDialog}>
        <DialogContent className="sm:max-w-sm bg-card border-border">
          <DialogHeader><DialogTitle>Link Phone Number</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-muted-foreground">Select a number from your account to associate with {company.name}.</p>
            <Select value={selectedNumberId} onValueChange={setSelectedNumberId}>
              <SelectTrigger className="bg-background">
                <SelectValue placeholder="Select a number..." />
              </SelectTrigger>
              <SelectContent>
                {allNumbers?.filter(n => !n.companyId || n.companyId === companyId).map(n => (
                  <SelectItem key={n.id} value={String(n.id)}>
                    {n.friendlyName ?? n.number}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Need a new number? <button className="text-primary underline" onClick={() => { setLinkDialog(false); navigate("/numbers"); }}>Provision one here.</button>
            </p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setLinkDialog(false)}>Cancel</Button>
            <Button onClick={handleLinkNumber} disabled={saving || !selectedNumberId}>Link Number</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
