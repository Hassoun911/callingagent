import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetCompany, useUpdateCompany, getListCompaniesQueryKey, useListPhoneNumbers } from "@workspace/api-client-react";
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
  ChevronRight, Hash, PhoneForwarded, ToggleLeft, ToggleRight,
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

  const { data: company, isLoading: companyLoading } = useGetCompany({ id: companyId });
  const { data: allNumbers } = useListPhoneNumbers();
  const linkedNumber = allNumbers?.find(n => n.companyId === companyId) ?? null;

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

  async function handleUnlinkNumber() {
    if (!linkedNumber) return;
    await linkPhoneNumber(linkedNumber.id, null);
    qc.invalidateQueries({ queryKey: ["listPhoneNumbers"] });
    toast({ title: "Phone number unlinked" });
  }

  async function handleSetIvr(mode: string) {
    if (!linkedNumber) return;
    await setAnswerMode(linkedNumber.id, mode);
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
      <div className="bg-card border border-border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        {(company as any).email && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{(company as any).email}</span>
          </div>
        )}
        {company.phone && (
          <div className="flex items-center gap-2 text-muted-foreground font-mono">
            <Phone className="h-3.5 w-3.5 flex-shrink-0" />
            <span>{company.phone}</span>
          </div>
        )}
        {company.website && (
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
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

      {/* Phone Number */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center gap-2">
            <Phone className="h-4 w-4 text-blue-400" />
            <span className="text-sm font-semibold">Phone Number</span>
          </div>
          {!linkedNumber && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setLinkDialog(true)}>
              <Plus className="h-3.5 w-3.5" /> Link Number
            </Button>
          )}
        </div>

        {linkedNumber ? (
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-mono text-sm font-medium">{formatPhone(linkedNumber.number)}</div>
                {linkedNumber.friendlyName && (
                  <div className="text-xs text-muted-foreground mt-0.5">{linkedNumber.friendlyName}</div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge variant="outline" className={`text-[10px] ${
                  linkedNumber.answerMode === "ivr" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                  linkedNumber.answerMode === "forward" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  linkedNumber.answerMode === "ai_voice" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                  "bg-secondary text-muted-foreground"
                }`}>
                  {linkedNumber.answerMode === "ivr" ? "IVR / Extensions" : linkedNumber.answerMode}
                </Badge>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button size="sm" variant={linkedNumber.answerMode === "ivr" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => handleSetIvr("ivr")}>
                <Hash className="h-3.5 w-3.5" /> IVR / Extensions
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate(`/numbers/${linkedNumber.id}`)}>
                Configure
                <ChevronRight className="h-3 w-3" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground gap-1 ml-auto">
                    Unlink
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-card border-border">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Unlink Phone Number</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the association between {company.name} and {linkedNumber.number}. The number will still exist in your account.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleUnlinkNumber}>Unlink</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-24 text-muted-foreground gap-2">
            <Phone className="h-6 w-6 opacity-25" />
            <span className="text-xs">No phone number linked.</span>
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

        {!linkedNumber && (
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

        {linkedNumber && extensions.length > 0 && linkedNumber.answerMode !== "ivr" && (
          <div className="px-4 py-3 border-t border-border bg-yellow-500/5 text-xs text-yellow-400 flex items-center gap-2">
            <Hash className="h-3.5 w-3.5 flex-shrink-0" />
            Extensions configured but answer mode is not set to IVR. Click "IVR / Extensions" above to activate.
          </div>
        )}
      </div>

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
