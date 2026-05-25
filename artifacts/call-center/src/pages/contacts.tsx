import { useState } from "react";
import { 
  useListContacts, 
  useCreateContact, 
  useUpdateContact, 
  useDeleteContact,
  useListCompanies,
  getListContactsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Plus, User, Building, Mail, Phone, Edit, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export default function Contacts() {
  const [search, setSearch] = useState("");
  const { data: contacts, isLoading } = useListContacts({ search });
  const { data: companies } = useListCompanies();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    companyId: "none",
    tags: ""
  });

  const createMutation = useCreateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setDialogOpen(false);
        toast({ title: "Contact created" });
      }
    }
  });

  const updateMutation = useUpdateContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        setDialogOpen(false);
        toast({ title: "Contact updated" });
      }
    }
  });

  const deleteMutation = useDeleteContact({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListContactsQueryKey() });
        toast({ title: "Contact deleted" });
      }
    }
  });

  const handleOpenDialog = (contact = null) => {
    if (contact) {
      setEditingContact(contact);
      setFormData({
        firstName: contact.firstName,
        lastName: contact.lastName,
        email: contact.email || "",
        phone: contact.phone || "",
        companyId: contact.companyId?.toString() || "none",
        tags: contact.tags || ""
      });
    } else {
      setEditingContact(null);
      setFormData({ firstName: "", lastName: "", email: "", phone: "", companyId: "none", tags: "" });
    }
    setDialogOpen(true);
  };

  const handleSave = () => {
    const payload = {
      ...formData,
      companyId: formData.companyId === "none" ? null : Number(formData.companyId)
    };
    
    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Contacts</h1>
          <p className="text-muted-foreground mt-1">Manage CRM contacts and relationships.</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="gap-2">
          <Plus className="h-4 w-4" />
          Add Contact
        </Button>
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
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Contact Info</TableHead>
              <TableHead>Tags</TableHead>
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
                  <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : contacts?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
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
                      {contact.tags.split(',').map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs bg-primary/10 text-primary hover:bg-primary/20">{tag.trim()}</Badge>
                      ))}
                    </div>
                  ) : '--'}
                </TableCell>
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
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border">
          <DialogHeader>
            <DialogTitle>{editingContact ? 'Edit Contact' : 'New Contact'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input value={formData.firstName} onChange={e => setFormData({...formData, firstName: e.target.value})} className="bg-background" />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input value={formData.lastName} onChange={e => setFormData({...formData, lastName: e.target.value})} className="bg-background" />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="bg-background" />
            </div>
            
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="bg-background font-mono" />
            </div>

            <div className="space-y-2">
              <Label>Company</Label>
              <Select value={formData.companyId} onValueChange={(v) => setFormData({...formData, companyId: v})}>
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
              <Label>Tags (comma separated)</Label>
              <Input value={formData.tags} onChange={e => setFormData({...formData, tags: e.target.value})} className="bg-background" placeholder="vip, lead, partner" />
            </div>

            <Button onClick={handleSave} className="w-full mt-4" disabled={createMutation.isPending || updateMutation.isPending}>
              {editingContact ? 'Save Changes' : 'Create Contact'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
