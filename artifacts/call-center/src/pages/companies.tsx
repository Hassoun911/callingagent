import { useState } from "react";
import { useLocation, Link } from "wouter";
import { 
  useListCompanies, 
  useCreateCompany, 
  useUpdateCompany, 
  useDeleteCompany,
  getListCompaniesQueryKey,
  useListPhoneNumbers,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Building2, Globe, Phone, Loader2, Download, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Trash2, Edit } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function linkPhoneNumber(phoneNumberId: number, companyId: number) {
  await fetch(`${BASE}/api/phone-numbers/${phoneNumberId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId }),
  });
}

export default function Companies() {
  const { data: companies, isLoading } = useListCompanies();
  const { data: allNumbers } = useListPhoneNumbers();
  const companyLines = (id: number) => (allNumbers ?? []).filter(n => n.companyId === id);
  const industryTone = (industry?: string | null) => {
    const name = (industry ?? "").toLowerCase();
    if (/health|medical/.test(name)) return "bg-rose-50 text-rose-700 border-rose-100";
    if (/software|it|technology|computer/.test(name)) return "bg-indigo-50 text-indigo-700 border-indigo-100";
    if (/construction|renovat/.test(name)) return "bg-amber-50 text-amber-800 border-amber-100";
    if (/tire|auto/.test(name)) return "bg-orange-50 text-orange-700 border-orange-100";
    return "bg-sky-50 text-sky-700 border-sky-100";
  };
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState<string>("");
  const [showInlineImport, setShowInlineImport] = useState(false);
  const [inlineImportNumber, setInlineImportNumber] = useState("");
  const [inlineImportLoading, setInlineImportLoading] = useState(false);

  // Only numbers not already linked to a company
  const unlinkdNumbers = allNumbers?.filter(n => !n.companyId) ?? [];

  const filteredCompanies = (() => {
    const q = search.trim().toLowerCase();
    if (!q || !companies) return companies ?? [];
    return companies.filter(c =>
      (c.name?.toLowerCase().includes(q)) ||
      ((c as any).ownerName?.toLowerCase().includes(q)) ||
      (c.industry?.toLowerCase().includes(q)) ||
      (c.phone?.toLowerCase().includes(q)) ||
      (c.email?.toLowerCase().includes(q)) ||
      (c.website?.toLowerCase().includes(q)) ||
      (c.notes?.toLowerCase().includes(q))
    );
  })();
  
  const [formData, setFormData] = useState({
    name: "",
    ownerName: "",
    industry: "",
    website: "",
    phone: "",
    notes: ""
  });

  const createMutation = useCreateCompany({
    mutation: {
      onSuccess: async (newCompany: any) => {
        if (selectedPhoneNumberId) {
          try {
            await linkPhoneNumber(parseInt(selectedPhoneNumberId, 10), newCompany.id);
            queryClient.invalidateQueries({ queryKey: ["listPhoneNumbers"] });
          } catch {
            toast({ title: "Company created, but failed to link phone number", variant: "destructive" });
          }
        }
        queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        setDialogOpen(false);
        setSelectedPhoneNumberId("");
        toast({ title: "Company created" });
      }
    }
  });

  const updateMutation = useUpdateCompany({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        setDialogOpen(false);
        toast({ title: "Company updated" });
      }
    }
  });

  const deleteMutation = useDeleteCompany({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListCompaniesQueryKey() });
        toast({ title: "Company deleted" });
      }
    }
  });

  const handleOpenDialog = (company: any = null) => {
    if (company) {
      setEditingCompany(company);
      setFormData({
        name: company.name,
        ownerName: company.ownerName || "",
        industry: company.industry || "",
        website: company.website || "",
        phone: company.phone || "",
        notes: company.notes || ""
      });
    } else {
      setEditingCompany(null);
      setFormData({ name: "", ownerName: "", industry: "", website: "", phone: "", notes: "" });
      setSelectedPhoneNumberId("");
    }
    setShowInlineImport(false);
    setInlineImportNumber("");
    setDialogOpen(true);
  };

  // A phone number purchase must belong to an existing company. Save this form
  // before leaving, instead of losing the draft and reaching an unassigned checkout.
  const createCompanyAndProvision = async () => {
    if (!formData.name.trim()) {
      toast({ title: "Company name required", description: "Enter a company name before provisioning its number.", variant: "destructive" });
      return;
    }
    if (createMutation.isPending) return;
    try {
      const company = await createMutation.mutateAsync({ data: formData });
      if (!company?.id) throw new Error("Company was saved but no ID was returned. Check the Companies list before retrying.");
      navigate(`/numbers?provision=1&companyId=${company.id}`);
    } catch (error: any) {
      toast({ title: "Could not continue to provisioning", description: error?.message || "Please review the company information and try again.", variant: "destructive" });
    }
  };

  const handleInlineImport = async () => {
    const num = inlineImportNumber.trim();
    if (!num) return;
    setInlineImportLoading(true);
    try {
      const res = await fetch(`${BASE}/api/phone-numbers/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: num }),
      });
      const body = await res.json();
      if (!res.ok) {
        const message =
          res.status === 409
            ? "This number is already provisioned in CallingAgent."
            : body.error || "Import failed";
        toast({ title: message, variant: "destructive" });
        return;
      }
      await queryClient.refetchQueries({ queryKey: ["listPhoneNumbers"] });
      setSelectedPhoneNumberId(String(body.id));
      setShowInlineImport(false);
      setInlineImportNumber("");
      toast({ title: `Imported ${body.number} — now selected below` });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setInlineImportLoading(false);
    }
  };

  const handleSave = () => {
    if (editingCompany) {
      updateMutation.mutate({ id: editingCompany.id, data: formData });
    } else {
      createMutation.mutate({ data: formData });
    }
  };

  return (
    <div className="companies-admin-page space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground"><span className="rounded-xl bg-blue-50 p-2 text-blue-600"><Building2 className="h-7 w-7" /></span>Companies</h1>
          <p className="text-muted-foreground mt-1">Manage organizations and accounts.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Company
        </Button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, industry, phone, email..."
          className="pl-9 pr-9 bg-card border-border"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm">
        <div className="overflow-x-auto">
        <Table className="min-w-[700px] text-sm sm:text-base">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Company Name</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Line Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredCompanies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center">
                    <Building2 className="h-8 w-8 mb-4 opacity-50" />
                    <p>{search ? `No companies match "${search}"` : "No companies found."}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredCompanies.map((company) => (
              <TableRow key={company.id} className="border-border cursor-pointer hover:bg-blue-50/70 text-sm sm:text-base" onClick={() => navigate(`/companies/${company.id}`)}>
                <TableCell>
                  <div className="flex items-center gap-3"><span className="hidden sm:flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-xs font-bold text-blue-700">{company.name.slice(0,2).toUpperCase()}</span><div className="text-base sm:text-lg font-bold leading-snug text-foreground">{company.name}</div></div>
                  {(company as any).ownerName && (
                    <div className="text-sm font-medium text-muted-foreground mt-1">{(company as any).ownerName}</div>
                  )}
                </TableCell>
                <TableCell className="text-foreground text-sm sm:text-base font-semibold">
                  <span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-semibold ${industryTone(company.industry)}`}>{company.industry || "Uncategorized"}</span>
                </TableCell>
                <TableCell>
                  {company.website ? (
                    <a href={`https://${company.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm sm:text-base font-semibold text-primary hover:underline">
                      <Globe className="h-3 w-3" />
                      {company.website}
                    </a>
                  ) : '--'}
                </TableCell>
                <TableCell>
                  {(() => {
                    if (company.phone) {
                      return (
                        <div className="flex items-center gap-1.5 text-sm sm:text-base font-medium text-foreground">
                          <Phone className="h-4 w-4 text-emerald-600" />
                          {company.phone}
                        </div>
                      );
                    }
                    const linked = allNumbers?.filter(n => n.companyId === company.id) ?? [];
                    if (linked.length > 0) {
                      return (
                        <div className="space-y-0.5">
                          {linked.map(n => (
                            <div key={n.id} className="flex items-center gap-1.5 text-sm sm:text-base font-medium text-foreground">
                              <Phone className={`h-4 w-4 flex-shrink-0 ${n.isActive ? "text-emerald-600" : "text-slate-400"}`} />
                              {n.number}
                            </div>
                          ))}
                        </div>
                      );
                    }
                    return <span className="text-muted-foreground/40">--</span>;
                  })()}
                </TableCell>
                <TableCell><div className="flex flex-wrap gap-1.5">{companyLines(company.id).length ? companyLines(company.id).map(n => <span key={n.id} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${n.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${n.isActive ? "bg-emerald-500" : "bg-slate-400"}`}/>{n.isActive ? "Active" : "Inactive"}</span>) : <span className="text-xs text-slate-400">No linked line</span>}</div></TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleOpenDialog(company); }}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={(e) => e.stopPropagation()}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="bg-card border-border">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Company</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete {company.name}? This will not delete associated contacts.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive" onClick={() => deleteMutation.mutate({ id: company.id })}>
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingCompany ? 'Edit Company' : 'New Company'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Company Name</Label>
              <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="bg-background" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Owner Name</Label>
                <Input value={formData.ownerName} onChange={e => setFormData({...formData, ownerName: e.target.value})} className="bg-background" placeholder="e.g. Jane Smith" />
              </div>
              <div className="space-y-2">
                <Label>Industry</Label>
                <Input value={formData.industry} onChange={e => setFormData({...formData, industry: e.target.value})} className="bg-background" placeholder="e.g. Dental, Real Estate" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Website</Label>
                <Input value={formData.website} onChange={e => setFormData({...formData, website: e.target.value})} className="bg-background" placeholder="example.com" />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="bg-background font-mono" />
              </div>
            </div>

            {!editingCompany && (
              <div className="space-y-2">
                <Label>
                  Provisioned Phone Number
                  <span className="text-muted-foreground text-xs ml-2">(optional)</span>
                </Label>
                <Select value={selectedPhoneNumberId} onValueChange={setSelectedPhoneNumberId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select a number to link..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {unlinkdNumbers.map(n => (
                      <SelectItem key={n.id} value={String(n.id)}>
                        {n.friendlyName ? `${n.friendlyName} — ${n.number}` : n.number}
                      </SelectItem>
                    ))}
                    {unlinkdNumbers.length === 0 && (
                      <SelectItem value="__empty" disabled>No unlinked numbers available</SelectItem>
                    )}
                  </SelectContent>
                </Select>

                {!editingCompany && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground pt-0.5">
                    <span>Number not listed?</span>
                    <button
                      type="button"
                      className="text-primary hover:underline flex items-center gap-1"
                      onClick={() => setShowInlineImport(v => !v)}
                    >
                      <Download className="h-3 w-3" />
                      Import existing
                    </button>
                    <span className="text-border/60">|</span>
                    <button type="button" disabled={createMutation.isPending} className="font-semibold text-primary hover:underline disabled:opacity-50" onClick={createCompanyAndProvision}>
                      {createMutation.isPending ? "Saving company…" : "Save company & provision new"}
                    </button>
                  </div>
                )}

                {!editingCompany && showInlineImport && (
                  <div className="rounded border border-border bg-background/60 p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Enter any number already in your Twilio account (E.164 format, e.g. +12125551234). Webhooks will be configured automatically.
                    </p>
                    <div className="flex gap-2">
                      <Input
                        placeholder="+12125551234"
                        value={inlineImportNumber}
                        onChange={e => setInlineImportNumber(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleInlineImport()}
                        className="bg-background font-mono text-sm flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleInlineImport}
                        disabled={!inlineImportNumber.trim() || inlineImportLoading}
                      >
                        {inlineImportLoading
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : "Import"
                        }
                      </Button>
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  Links one of your provisioned numbers to this company. You can also do this later from the company detail page.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})} className="bg-background" />
            </div>

            <Button onClick={handleSave} className="w-full mt-4" disabled={createMutation.isPending || updateMutation.isPending || !formData.name}>
              {editingCompany ? 'Save Changes' : 'Create Company'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
