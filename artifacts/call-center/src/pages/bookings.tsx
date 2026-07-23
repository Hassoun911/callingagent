import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Calendar as CalendarIcon,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Edit,
  Mail,
  Plus,
  Phone,
  Trash2,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useListCompanies } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type AppointmentStatus = "scheduled" | "confirmed" | "cancelled" | "no_show";

interface Appointment {
  id: number;
  companyId: number | null;
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  title: string;
  notes: string | null;
  startTime: string;
  endTime: string | null;
  status: AppointmentStatus;
  createdAt: string;
}

const STATUS_STYLES: Record<AppointmentStatus, string> = {
  scheduled: "border-blue-500/20 bg-blue-500/10 text-blue-400",
  confirmed: "border-green-500/20 bg-green-500/10 text-green-400",
  cancelled: "border-red-500/20 bg-red-500/10 text-red-400",
  no_show: "border-yellow-500/20 bg-yellow-500/10 text-yellow-400",
};

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

function useAppointments(companyId?: number) {
  return useQuery<Appointment[]>({
    queryKey: ["appointments", companyId ?? "all"],
    queryFn: async () => {
      const url = companyId ? `${BASE}/api/companies/${companyId}/appointments` : `${BASE}/api/appointments`;
      const response = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Could not load appointments.");
      return response.json();
    },
  });
}

function dayKey(date: Date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function isSameDay(first: Date, second: Date) {
  return dayKey(first) === dayKey(second);
}

function formatPhone(raw: string) {
  const digits = raw.replace(/\D/g, "");
  const value = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return value.length === 10 ? `(${value.slice(0, 3)}) ${value.slice(3, 6)}-${value.slice(6)}` : raw;
}

export default function BookingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scopedCompanyId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("companyId");
    return value ? Number(value) : undefined;
  }, []);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | undefined>(scopedCompanyId);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const [editAppointment, setEditAppointment] = useState<Appointment | null>(null);

  const { data: companies = [] } = useListCompanies();
  const { data: appointments = [], isLoading, isError, refetch } = useAppointments(selectedCompanyId);
  const selectedCompany = companies.find(company => company.id === selectedCompanyId);

  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  const totalDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + totalDays) / 7) * 7;
  const monthLabel = currentMonth.toLocaleString("en-US", { month: "long", year: "numeric" });

  const appointmentsByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const appointment of appointments) {
      const key = dayKey(new Date(appointment.startTime));
      (map[key] ??= []).push(appointment);
    }
    return map;
  }, [appointments]);

  const selectedAppointments = useMemo(
    () => [...(appointmentsByDay[dayKey(selectedDate)] ?? [])].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime)),
    [appointmentsByDay, selectedDate],
  );

  async function deleteAppointment(id: number) {
    const response = await fetch(`${BASE}/api/appointments/${id}`, { method: "DELETE", credentials: "include" });
    if (!response.ok) {
      toast({ title: "Could not delete appointment", variant: "destructive" });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["appointments"] });
    toast({ title: "Appointment deleted" });
  }

  async function updateStatus(appointment: Appointment, status: AppointmentStatus) {
    const response = await fetch(`${BASE}/api/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      toast({ title: "Could not update appointment", variant: "destructive" });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["appointments"] });
  }

  return (
    <div className="space-y-4 pb-24 sm:space-y-6 sm:pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {selectedCompany && (
            <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /><span className="truncate">{selectedCompany.name}</span><span>/</span><span>Appointments</span>
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Appointments</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review and manage bookings created by the AI or dashboard.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 min-[430px]:grid-cols-2 sm:flex">
          {!scopedCompanyId && (
            <Select value={selectedCompanyId?.toString() ?? "all"} onValueChange={value => setSelectedCompanyId(value === "all" ? undefined : Number(value))}>
              <SelectTrigger className="min-h-11 w-full bg-background sm:min-h-9 sm:w-48"><SelectValue placeholder="All companies" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All companies</SelectItem>{companies.map(company => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Button onClick={() => setCreateOpen(true)} className="min-h-11 gap-2 sm:min-h-9"><Plus className="h-4 w-4" />New Appointment</Button>
        </div>
      </header>

      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          Appointments could not be loaded. <button className="font-semibold underline" onClick={() => refetch()}>Try again</button>
        </div>
      )}

      <div className="grid min-h-[570px] grid-cols-1 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[340px_minmax(0,1fr)]">
        <section className="border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border px-3 py-3 sm:px-4">
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1))} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
            <div className="text-center"><div className="text-sm font-semibold">{monthLabel}</div><button className="mt-0.5 text-[11px] text-primary hover:underline" onClick={() => { const today = new Date(); setCurrentMonth(today); setSelectedDate(today); }}>Go to today</button></div>
            <button onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1))} className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-secondary" aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          </div>

          <div className="grid grid-cols-7 px-3 pt-3">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(day => <div key={day} className="py-1 text-center text-[10px] font-semibold text-muted-foreground">{day}</div>)}</div>
          <div className="grid grid-cols-7 gap-1 px-3 pb-3">
            {Array.from({ length: totalCells }).map((_, index) => {
              const number = index - firstDay + 1;
              if (number < 1 || number > totalDays) return <div key={index} className="aspect-square" />;
              const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), number);
              const count = appointmentsByDay[dayKey(date)]?.length ?? 0;
              const selected = isSameDay(date, selectedDate);
              const today = isSameDay(date, new Date());
              return (
                <button key={index} onClick={() => setSelectedDate(date)} className={`relative flex aspect-square min-h-10 flex-col items-center justify-center rounded-lg text-xs transition-colors ${selected ? "bg-primary text-primary-foreground" : today ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`} aria-label={`${date.toDateString()}, ${count} appointments`}>
                  <span>{number}</span>
                  {count > 0 && <span className={`mt-0.5 h-1.5 min-w-1.5 rounded-full ${selected ? "bg-primary-foreground" : "bg-primary"}`} />}
                </button>
              );
            })}
          </div>
          <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">{isLoading ? "Loading appointments…" : `${appointments.length} total · ${appointments.filter(item => item.status === "scheduled").length} scheduled`}</div>
        </section>

        <section className="min-w-0">
          <div className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <h2 className="text-sm font-semibold">{selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</h2>
            <span className="text-xs text-muted-foreground">{selectedAppointments.length ? `${selectedAppointments.length} appointment${selectedAppointments.length === 1 ? "" : "s"}` : "No appointments"}</span>
          </div>
          <div className="space-y-3 p-3 sm:p-6">
            {isLoading ? [...Array(3)].map((_, index) => <Skeleton key={index} className="h-32 rounded-xl" />) : selectedAppointments.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center gap-2 px-4 text-center text-muted-foreground"><CalendarIcon className="h-9 w-9 opacity-20" /><p className="text-sm">No appointments on this day</p><Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="mt-1 min-h-10 gap-2"><Plus className="h-4 w-4" />Add appointment</Button></div>
            ) : selectedAppointments.map(appointment => (
              <AppointmentCard key={appointment.id} appointment={appointment} companyName={companies.find(company => company.id === appointment.companyId)?.name} onEdit={() => setEditAppointment(appointment)} onDelete={() => deleteAppointment(appointment.id)} onStatusChange={status => updateStatus(appointment, status)} />
            ))}
          </div>
        </section>
      </div>

      {createOpen && <AppointmentFormDialog defaultDate={selectedDate} companies={companies} defaultCompanyId={selectedCompanyId} companyLocked={!!scopedCompanyId} onClose={() => setCreateOpen(false)} onSaved={() => { setCreateOpen(false); queryClient.invalidateQueries({ queryKey: ["appointments"] }); }} />}
      {editAppointment && <AppointmentFormDialog appointment={editAppointment} companies={companies} companyLocked={!!scopedCompanyId} onClose={() => setEditAppointment(null)} onSaved={() => { setEditAppointment(null); queryClient.invalidateQueries({ queryKey: ["appointments"] }); }} />}
    </div>
  );
}

function AppointmentCard({ appointment, companyName, onEdit, onDelete, onStatusChange }: { appointment: Appointment; companyName?: string; onEdit: () => void; onDelete: () => void; onStatusChange: (status: AppointmentStatus) => void }) {
  const start = new Date(appointment.startTime);
  const end = appointment.endTime ? new Date(appointment.endTime) : null;
  return (
    <article className="rounded-xl border border-border bg-background/30 p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex items-center gap-3 sm:w-24 sm:flex-col sm:items-start sm:gap-1">
          <div className="text-base font-bold">{start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>
          {end && <div className="text-xs text-muted-foreground">to {end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</div>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2"><h3 className="break-words text-sm font-semibold">{appointment.title}</h3><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[appointment.status]}`}>{STATUS_LABELS[appointment.status]}</span></div>
          <div className="grid grid-cols-1 gap-1.5 text-xs text-muted-foreground sm:grid-cols-2">
            <span className="flex min-w-0 items-center gap-1.5"><User className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{appointment.customerName}</span></span>
            <a href={`tel:${appointment.customerPhone}`} className="flex min-w-0 items-center gap-1.5 hover:text-foreground"><Phone className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate font-mono">{formatPhone(appointment.customerPhone)}</span></a>
            {appointment.customerEmail && <a href={`mailto:${appointment.customerEmail}`} className="flex min-w-0 items-center gap-1.5 hover:text-foreground"><Mail className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{appointment.customerEmail}</span></a>}
            {companyName && <span className="flex min-w-0 items-center gap-1.5"><Building2 className="h-3.5 w-3.5 flex-shrink-0" /><span className="truncate">{companyName}</span></span>}
          </div>
          {appointment.notes && <p className="break-words rounded-lg bg-secondary/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">{appointment.notes}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:w-28 sm:flex-col sm:items-stretch">
          <button onClick={onEdit} className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"><Edit className="h-3.5 w-3.5" />Edit</button>
          <AlertDialog><AlertDialogTrigger asChild><button className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-red-500/20 px-3 text-xs text-red-400 hover:bg-red-500/10"><Trash2 className="h-3.5 w-3.5" />Delete</button></AlertDialogTrigger><AlertDialogContent className="w-[calc(100vw-1rem)] border-border bg-card sm:w-full"><AlertDialogHeader><AlertDialogTitle>Delete appointment?</AlertDialogTitle><AlertDialogDescription>This permanently removes the appointment for {appointment.customerName}.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep appointment</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={onDelete}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
          {appointment.status === "scheduled" && <button onClick={() => onStatusChange("confirmed")} className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md border border-green-500/30 px-3 text-xs text-green-400 hover:bg-green-500/10"><Check className="h-3.5 w-3.5" />Confirm</button>}
          {!(["cancelled", "no_show"] as AppointmentStatus[]).includes(appointment.status) && <button onClick={() => onStatusChange("cancelled")} className="min-h-10 flex-1 rounded-md border border-red-500/20 px-3 text-xs text-red-400 hover:bg-red-500/10">Cancel</button>}
        </div>
      </div>
    </article>
  );
}

function AppointmentFormDialog({ appointment, companies, defaultDate, defaultCompanyId, companyLocked, onClose, onSaved }: { appointment?: Appointment; companies: { id: number; name: string }[]; defaultDate?: Date; defaultCompanyId?: number; companyLocked?: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isEdit = !!appointment;
  const defaultStart = defaultDate ? new Date(defaultDate.getFullYear(), defaultDate.getMonth(), defaultDate.getDate(), 9, 0) : new Date();
  const toLocal = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyId: String(appointment?.companyId ?? defaultCompanyId ?? ""),
    customerName: appointment?.customerName ?? "",
    customerPhone: appointment?.customerPhone ?? "",
    customerEmail: appointment?.customerEmail ?? "",
    title: appointment?.title ?? "Appointment",
    notes: appointment?.notes ?? "",
    startTime: appointment ? toLocal(new Date(appointment.startTime)) : toLocal(defaultStart),
    endTime: appointment?.endTime ? toLocal(new Date(appointment.endTime)) : "",
    status: appointment?.status ?? "scheduled" as AppointmentStatus,
  });

  async function save() {
    if (!form.companyId || !form.customerName.trim() || !form.customerPhone.trim() || !form.startTime) {
      toast({ title: "Company, customer name, phone, and start time are required", variant: "destructive" });
      return;
    }
    const start = new Date(form.startTime);
    const end = form.endTime ? new Date(form.endTime) : null;
    if (Number.isNaN(start.getTime()) || (end && Number.isNaN(end.getTime()))) {
      toast({ title: "Enter a valid date and time", variant: "destructive" });
      return;
    }
    if (end && end <= start) {
      toast({ title: "End time must be after start time", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(isEdit ? `${BASE}/api/appointments/${appointment.id}` : `${BASE}/api/appointments`, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          companyId: Number(form.companyId),
          customerName: form.customerName.trim(),
          customerPhone: form.customerPhone.trim(),
          customerEmail: form.customerEmail.trim() || null,
          title: form.title.trim() || "Appointment",
          notes: form.notes.trim() || null,
          startTime: start.toISOString(),
          endTime: end?.toISOString() ?? null,
          status: form.status,
        }),
      });
      if (!response.ok) throw new Error((await response.text()) || "Request failed");
      toast({ title: isEdit ? "Appointment updated" : "Appointment created" });
      onSaved();
    } catch (error: any) {
      toast({ title: "Could not save appointment", description: error?.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1rem)] overflow-y-auto border-border bg-card p-4 sm:max-w-lg sm:p-6">
        <DialogHeader><DialogTitle>{isEdit ? "Edit Appointment" : "New Appointment"}</DialogTitle></DialogHeader>
        <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer Name *"><Input value={form.customerName} onChange={event => setForm(current => ({ ...current, customerName: event.target.value }))} placeholder="John Smith" /></Field>
          <Field label="Customer Phone *"><Input type="tel" value={form.customerPhone} onChange={event => setForm(current => ({ ...current, customerPhone: event.target.value }))} placeholder="+1 555 000 0000" className="font-mono" /></Field>
          <Field label="Customer Email"><Input type="email" value={form.customerEmail} onChange={event => setForm(current => ({ ...current, customerEmail: event.target.value }))} placeholder="email@example.com" /></Field>
          <Field label="Company *"><Select disabled={companyLocked} value={form.companyId || "none"} onValueChange={value => setForm(current => ({ ...current, companyId: value === "none" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger><SelectContent><SelectItem value="none">Select company</SelectItem>{companies.map(company => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}</SelectContent></Select></Field>
          <div className="sm:col-span-2"><Field label="Appointment Title"><Input value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="Consultation" /></Field></div>
          <Field label="Start Time *"><Input type="datetime-local" value={form.startTime} onChange={event => setForm(current => ({ ...current, startTime: event.target.value }))} /></Field>
          <Field label="End Time"><Input type="datetime-local" value={form.endTime} onChange={event => setForm(current => ({ ...current, endTime: event.target.value }))} /></Field>
          {isEdit && <div className="sm:col-span-2"><Field label="Status"><Select value={form.status} onValueChange={value => setForm(current => ({ ...current, status: value as AppointmentStatus }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></Field></div>}
          <div className="sm:col-span-2"><Field label="Notes"><Textarea rows={4} value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} placeholder="Service, location, quoted price, or other details..." /></Field></div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2"><Button variant="outline" onClick={onClose} className="min-h-11">Cancel</Button><Button onClick={save} disabled={saving} className="min-h-11">{saving ? "Saving…" : isEdit ? "Save Changes" : "Create Appointment"}</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
}
