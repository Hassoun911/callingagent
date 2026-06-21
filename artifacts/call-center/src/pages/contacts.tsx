import { useState, useRef } from "react";
import {
  useListContacts,
  useCreateContact,
  useUpdateContact,
  useDeleteContact,
  useListCompanies,
  useImportContacts,
  getListContactsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, User, Building, Mail, Phone, Edit, Trash2, Upload, Globe, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";

type AccessType = "all" | "selected";

function parseCSV(text: string): Array<{ firstName: string; lastName: string; phone?: string; email?: string; notes?: string; tags?: string }> {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const rawHeaders = lines[0].split(delimiter).map(h => h.trim().replace(/^["']|["']$/g, "").toLowerCase());

  function mapHeader(h: string): string {
    if (/first.?name/i.test(h)) return "firstName";
    if (/last.?name/i.test(h)) return "lastName";
    if (/^name$/i.test(h) || /full.?name/i.test(h)) return "fullName";
    if (/phone|mobile|cell|tel/i.test(h)) return "phone";
    if (/email/i.test(h)) return "email";
    if (/note/i.test(h)) return "notes";
    if (/tag/i.test(h)) return "tags";
    return h;
  }

  const mappedHeaders = rawHeaders.map(mapHeader);
  const hasHeaders = mappedHeaders.some(h => ["firstName", "lastName", "fullName", "phone", "email"].includes(h));
  const dataLines = hasHeaders ? lines.slice(1) : lines;

  return dataLines
    .map(line => {
      const vals = line.split(delimiter).map(v => v.trim().replace(/^["']|["']$/g, ""));
      if (hasHeaders) {
        const row: any = {};
        mappedHeaders.forEach((h, i) => { if (vals[i]) row[h] = vals[i]; });
        if (row.fullName) {
          const parts = row.fullName.trim().split(/\s+/);
          row.firstName = parts[0] ?? "";
          row.lastName = parts.slice(1).join(" ") || "-";
          delete row.fullName;
        }
        return row;
      } else {
        // No headers: try to detect format
        if (vals.length === 1) {
          const v = vals[0];
          return /^[\w._%+\-]+@[\w.\-]+\.[a-z]{2,}$/i.test(v)
            ? { firstName: v.split("@")[0], lastName: "-", email: v }
            : { firstName: v, lastName: "-", phone: v.replace(/\D/g, "").length >= 7 ? v : undefined };
        }
        const nameParts = vals[0].trim().split(/\s+/);
        return {
          firstName: nameParts[0],
          lastName: nameParts.slice(1).join(" ") || "-",
          phone: vals[1] || undefined,
          email: vals[2] || undefined,
        };
      }
    })
    .filter(row => row.firstName);
}

export default function Contacts() {
  const [search, setSearch] = useState("");
  const { data: contacts, isLoading } = useListContacts({ search });
  const { data: companies } = useListCompanies();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Add / Edit dialog ──────────────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyId: "none",
    tags: "",
    accessType: "all" as AccessType,
    allowedCompanyIds: [] as string[],
  });

  // ── CSV Import dialog ──────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false);
  const [csvRows, setCsvRows] = useState<any[]>([]);
  const [importAccessType, setImportAccessType] = useState<AccessType>("all");
  const [importAllowedIds, setImportAllowedIds] = useState<string[]>([]);

  const createMutation = useCreateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setDialogOpen(false);
        toast({ title: "Contact created" });
      },
    },
  });

  const updateMutation = useUpdateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setDialogOpen(false);
        toast({ title: "Contact updated" });
      },
    },
  });

  const deleteMutation = useDeleteContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Contact deleted" });
      },
    },
  });

  const importMutation = useImportContacts({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setImportOpen(false);
        setCsvRows([]);
        toast({ title: `Imported ${data.imported} contact${data.imported !== 1 ? "s" : ""}${data.skipped > 0 ? ` (${data.skipped} skipped)` : ""}` });
      },
      onError: () => toast({ title: "Import failed", variant: "destructive" }),
    },
  });

  function handleOpenDialog(contact: any = null) {
    if (contact) {
      setEditingContact(contact);
      const allowedIds = contact.allowedCompanyIds
        ? contact.allowedCompanyIds.split(",").map((s: string) => s.trim()).filter(Boolean)
        : [];
      setFormData({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email || "",
        phone: contact.phone || "",
        companyId: contact.companyId?.toString() || "none",
        tags: contact.tags || "",
        accessType: (contact.accessType === "selected" ? "selected" : "all") as AccessType,
        allowedCompanyIds: allowedIds,
      });
    } else {
      setEditingContact(null);
      setFormData({ firstName: "", lastName: "", email: "", phone: "", companyId: "none", tags: "", accessType: "all", allowedCompanyIds: [] });
    }
    setDialogOpen(true);
  }

  function handleSave() {
    const payload = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      email: formData.email || null,
      phone: formData.phone || null,
      companyId: formData.companyId === "none" ? null : Number(formData.companyId),
      tags: formData.tags || null,
      accessType: formData.accessType,
      allowedCompanyIds:
        formData.accessType === "selected" && formData.allowedCompanyIds.length > 0
          ? formData.allowedCompanyIds.join(",")
          : null,
    };
    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  }

  function toggleAllowedCompany(companyId: string) {
    setFormData(f => {
      const already = f.allowedCompanyIds.includes(companyId);
      return {
        ...f,
        allowedCompanyIds: already
          ? f.allowedCompanyIds.filter(id => id !== companyId)
          : [...f.allowedCompanyIds, companyId],
      };
    });
  }

  function toggleImportAllowedCompany(companyId: string) {
    setImportAllowedIds(ids => {
      const already = ids.includes(companyId);
      return already ? ids.filter(id => id !== companyId) : [...ids, companyId];
    });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setCsvRows(rows);
      setImportOpen(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function handleImport() {
    importMutation.mutate({
      data: {
        contacts: csvRows.map(r => ({
          firstName: r.firstName || "",
          lastName: r.lastName || "-",
          phone: r.phone || null,
          email: r.email || null,
          notes: r.notes || null,
          tags: r.tags || null,
        })),
        accessType: importAccessType,
        allowedCompanyIds:
          importAccessType === "selected" && importAllowedIds.length > 0
            ? importAllowedIds.join(",")
            : null,
      },
    });
  }

  function accessLabel(contact: any): React.ReactNode {
    if (!contact.accessType || contact.accessType === "all") {
      return (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Globe className="h-3 w-3" />
          All
        </div>
      );
    }
    const ids = (contact.allowedCompanyIds || "")
      .split(",")
      .map((s: string) => parseInt(s.trim(), 10))
      .filter(Boolean);
    const names = ids
      .map((id: number) => companies?.find(c => c.id === id)?.name)
      .filter(Boolean);
    return (
      <div className="flex items-center gap-1 text-xs text-amber-400">
        <Lock className="h-3 w-3 flex-shrink-0" />
        <span className="truncate max-w-[120px]">{names.length > 0 ? names.join(", ") : "Selected"}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Contacts</h1>
          <p className="text-muted-foreground mt-1">CRM contact library. Control which companies can use each contact in campaigns.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.tsv,.txt"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button onClick={() => handleOpenDialog()} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search name, email, or phone..."
          className="pl-9 bg-card border-border"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="border-border">
        <div className="overflow-x-auto">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Contact Info</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Access</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <TableRow key={i} className="border-border">
                    <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-40" /></TableCell>
                    <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : contacts?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center">
                      <User className="h-8 w-8 mb-4 opacity-50" />
                      <p>No contacts found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : contacts?.map((contact) => (
                <TableRow key={contact.id} className="border-border">
                  <TableCell className="font-medium">
                    {contact.firstName} {contact.lastName}
                  </TableCell>
                  <TableCell>
                    {contact.companyName ? (
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <Building className="h-3 w-3" />
                        {contact.companyName}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-sm">--</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm text-muted-foreground">
                      {contact.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" /> {contact.email}</div>}
                      {contact.phone && <div className="flex items-center gap-1.5 font-mono"><Phone className="h-3 w-3" /> {contact.phone}</div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {contact.tags ? (
                      <div className="flex gap-1 flex-wrap">
                        {contact.tags.split(",").map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs bg-primary/10 text-primary hover:bg-primary/20">{tag.trim()}</Badge>
                        ))}
                      </div>
                    ) : "--"}
                  </TableCell>
                  <TableCell>{accessLabel(contact)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(contact)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="bg-card border-border">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Contact</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete {contact.firstName} {contact.lastName}?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction className="bg-destructive" onClick={() => deleteMutation.mutate({ id: contact.id })}>
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

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingContact ? "Edit Contact" : "New Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input value={formData.firstName} onChange={e => setFormData({ ...formData, firstName: e.target.value })} className="bg-background" />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input value={formData.lastName} onChange={e => setFormData({ ...formData, lastName: e.target.value })} className="bg-background" />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} className="bg-background" />
            </div>

            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="bg-background font-mono" />
            </div>

            <div className="space-y-2">
              <Label>Belongs to Company <span className="text-muted-foreground font-normal">(CRM grouping)</span></Label>
              <Select value={formData.companyId} onValueChange={(v) => setFormData({ ...formData, companyId: v })}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">-- None --</SelectItem>
                  {companies?.map(c => (
                    <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tags <span className="text-muted-foreground font-normal">(comma separated)</span></Label>
              <Input value={formData.tags} onChange={e => setFormData({ ...formData, tags: e.target.value })} className="bg-background" placeholder="vip, lead, partner" />
            </div>

            {/* Company Access */}
            <div className="space-y-2 border border-border rounded-md p-3 bg-background/40">
              <Label className="text-foreground font-semibold">Campaign Access</Label>
              <p className="text-xs text-muted-foreground">Which companies can include this contact in their campaigns.</p>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setFormData(f => ({ ...f, accessType: "all", allowedCompanyIds: [] }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    formData.accessType === "all"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  All companies
                </button>
                <button
                  type="button"
                  onClick={() => setFormData(f => ({ ...f, accessType: "selected" }))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    formData.accessType === "selected"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" />
                  Selected only
                </button>
              </div>
              {formData.accessType === "selected" && (
                <div className="mt-2 space-y-1.5 pl-1 max-h-32 overflow-y-auto">
                  {companies?.length === 0 && (
                    <p className="text-xs text-muted-foreground">No companies yet.</p>
                  )}
                  {companies?.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={formData.allowedCompanyIds.includes(c.id.toString())}
                        onCheckedChange={() => toggleAllowedCompany(c.id.toString())}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <Button
              onClick={handleSave}
              className="w-full mt-4"
              disabled={
                !formData.firstName ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {editingContact ? "Save Changes" : "Create Contact"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── CSV Import Dialog ── */}
      <Dialog open={importOpen} onOpenChange={v => { setImportOpen(v); if (!v) setCsvRows([]); }}>
        <DialogContent className="sm:max-w-2xl bg-card border-border max-h-[85vh] flex flex-col gap-0 p-0">
          <div className="px-6 py-4 border-b border-border flex-shrink-0">
            <DialogTitle>Import Contacts from CSV</DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              {csvRows.length} contact{csvRows.length !== 1 ? "s" : ""} detected. Review before importing.
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Preview table */}
            {csvRows.length > 0 && (
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/30">
                    <tr>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Name</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 50).map((row, i) => (
                      <tr key={i} className="border-t border-border/50">
                        <td className="px-3 py-1.5 font-medium">{row.firstName} {row.lastName}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground text-xs">{row.phone || "--"}</td>
                        <td className="px-3 py-1.5 text-muted-foreground text-xs">{row.email || "--"}</td>
                      </tr>
                    ))}
                    {csvRows.length > 50 && (
                      <tr className="border-t border-border/50">
                        <td colSpan={3} className="px-3 py-2 text-xs text-muted-foreground text-center">
                          ...and {csvRows.length - 50} more
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Campaign Access for imported batch */}
            <div className="border border-border rounded-md p-3 bg-background/40 space-y-2">
              <Label className="text-foreground font-semibold">Campaign Access for Imported Contacts</Label>
              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => { setImportAccessType("all"); setImportAllowedIds([]); }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    importAccessType === "all"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  <Globe className="h-3.5 w-3.5" />
                  All companies
                </button>
                <button
                  type="button"
                  onClick={() => setImportAccessType("selected")}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm border transition-colors ${
                    importAccessType === "selected"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  }`}
                >
                  <Lock className="h-3.5 w-3.5" />
                  Selected only
                </button>
              </div>
              {importAccessType === "selected" && (
                <div className="mt-2 space-y-1.5 pl-1 max-h-32 overflow-y-auto">
                  {companies?.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={importAllowedIds.includes(c.id.toString())}
                        onCheckedChange={() => toggleImportAllowedCompany(c.id.toString())}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="px-6 py-4 border-t border-border flex-shrink-0 flex justify-between items-center">
            <button
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => { setCsvRows([]); setImportOpen(false); fileRef.current?.click(); }}
            >
              Choose different file
            </button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setImportOpen(false); setCsvRows([]); }}>Cancel</Button>
              <Button
                onClick={handleImport}
                disabled={csvRows.length === 0 || importMutation.isPending}
              >
                {importMutation.isPending ? "Importing..." : `Import ${csvRows.length} Contact${csvRows.length !== 1 ? "s" : ""}`}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
