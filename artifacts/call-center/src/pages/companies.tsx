import { useState } from "react";
import { useLocation } from "wouter";
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
import { Plus, Building2, Globe, Phone } from "lucide-react";
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
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<any>(null);
  const [selectedPhoneNumberId, setSelectedPhoneNumberId] = useState<string>("");

  // Only numbers not already linked to a company
  const unlinkdNumbers = allNumbers?.filter(n => !n.companyId) ?? [];
  
  const [formData, setFormData] = useState({
    name: "",
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
        industry: company.industry || "",
        website: company.website || "",
        phone: company.phone || "",
        notes: company.notes || ""
      });
    } else {
      setEditingCompany(null);
      setFormData({ name: "", industry: "", website: "", phone: "", notes: "" });
      setSelectedPhoneNumberId("");
    }
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (editingCompany) {
      updateMutation.mutate({ id: editingCompany.id, data: formData });
    } else {
      createMutation.mutate({ data: formData });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Companies</h1>
          <p className="text-muted-foreground mt-1">Manage organizations and accounts.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Company
        </Button>
      </div>

      <Card className="border-border">
        <div className="overflow-x-auto">
        <Table className="min-w-[560px]">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Company Name</TableHead>
              <TableHead>Industry</TableHead>
              <TableHead>Website</TableHead>
              <TableHead>Phone</TableHead>
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
            ) : companies?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                  <div className="flex flex-col items-center justify-center">
                    <Building2 className="h-8 w-8 mb-4 opacity-50" />
                    <p>No companies found.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : companies?.map((company) => (
              <TableRow key={company.id} className="border-border cursor-pointer hover:bg-secondary/30" onClick={() => navigate(`/companies/${company.id}`)}>
                <TableCell className="font-medium text-foreground">
                  {company.name}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {company.industry || '--'}
                </TableCell>
                <TableCell>
                  {company.website ? (
                    <a href={`https://${company.website.replace(/^https?:\/\//, '')}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                      <Globe className="h-3 w-3" />
                      {company.website}
                    </a>
                  ) : '--'}
                </TableCell>
                <TableCell>
                  {company.phone ? (
                    <div className="flex items-center gap-1.5 text-sm font-mono text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {company.phone}
                    </div>
                  ) : '--'}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(company)}>
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
            
            <div className="space-y-2">
              <Label>Industry</Label>
              <Input value={formData.industry} onChange={e => setFormData({...formData, industry: e.target.value})} className="bg-background" />
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
