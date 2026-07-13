import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Calendar as CalendarIcon, Clock, User, Phone, Mail, Building2,
  Plus, Trash2, Edit, ChevronLeft, ChevronRight, X, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useListCompanies } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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
  status: "scheduled" | "confirmed" | "cancelled" | "no_show";
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  confirmed: "bg-green-500/10 text-green-400 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
  no_show: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
};

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  no_show: "No Show",
};

function useAppointments(companyId?: number) {
  return useQuery<Appointment[]>({
    queryKey: ["appointments", companyId ?? "all"],
    queryFn: async () => {
      const url = companyId
        ? `${BASE}/api/companies/${companyId}/appointments`
        : `${BASE}/api/appointments`;
      const r = await fetch(url, { credentials: "include" });
      if (!r.ok) throw new Error("Failed to fetch appointments");
      return r.json();
    },
  });
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function daysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function dayOfWeek(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1).getDay();
}

export default function BookingsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const urlCompanyId = useMemo(() => {
    const p = new URLSearchParams(window.location.search).get("companyId");
    return p ? parseInt(p, 10) : undefined;
  }, []);
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | undefined>(urlCompanyId);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [createOpen, setCreateOpen] = useState(false);
  const [editAppointment, setEditAppointment] = useState<Appointment | null>(null);

  const { data: companies } = useListCompanies();
  const { data: appointments = [], isLoading } = useAppointments(selectedCompanyId);

  // Calendar grid helpers
  const firstDow = dayOfWeek(currentMonth);
  const totalDays = daysInMonth(currentMonth);
  const totalCells = Math.ceil((firstDow + totalDays) / 7) * 7;

  const appointmentsByDay = useMemo(() => {
    const map: Record<string, Appointment[]> = {};
    for (const a of appointments) {
      const d = new Date(a.startTime);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    }
    return map;
  }, [appointments]);

  const selectedDayAppointments = useMemo(() => {
    if (!selectedDate) return [];
    const key = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}-${selectedDate.getDate()}`;
    return appointmentsByDay[key] ?? [];
  }, [selectedDate, appointmentsByDay]);

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));

  const monthLabel = currentMonth.toLocaleString("en-US", { month: "long", year: "numeric" });

  async function deleteAppointment(id: number) {
    await fetch(`${BASE}/api/appointments/${id}`, { method: "DELETE", credentials: "include" });
    qc.invalidateQueries({ queryKey: ["appointments"] });
    toast({ title: "Appointment deleted" });
  }

  async function updateStatus(a: Appointment, status: string) {
    await fetch(`${BASE}/api/appointments/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ status }),
    });
    qc.invalidateQueries({ queryKey: ["appointments"] });
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Bookings</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Appointments booked via AI calls</p>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={selectedCompanyId?.toString() ?? "all"}
            onValueChange={v => setSelectedCompanyId(v === "all" ? undefined : parseInt(v, 10))}
          >
            <SelectTrigger className="h-8 text-xs w-44 bg-background border-border">
              <SelectValue placeholder="All companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All companies</SelectItem>
              {companies?.map(c => (
                <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Booking
          </Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Calendar panel */}
        <div className="w-80 flex-shrink-0 border-r border-border flex flex-col">
          {/* Month nav */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <button onClick={prevMonth} className="h-7 w-7 flex items-center justify-center rounded hover:bg-secondary transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold">{monthLabel}</span>
            <button onClick={nextMonth} className="h-7 w-7 flex items-center justify-center rounded hover:bg-secondary transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {/* Day headers */}
          <div className="grid grid-cols-7 px-3 pt-2">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(d => (
              <div key={d} className="text-[10px] text-center text-muted-foreground font-semibold py-1">{d}</div>
            ))}
          </div>
          {/* Calendar grid */}
          <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5">
            {Array.from({ length: totalCells }).map((_, i) => {
              const dayNum = i - firstDow + 1;
              if (dayNum < 1 || dayNum > totalDays) {
                return <div key={i} />;
              }
              const cellDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), dayNum);
              const key = `${cellDate.getFullYear()}-${cellDate.getMonth()}-${cellDate.getDate()}`;
              const hasAppts = !!appointmentsByDay[key]?.length;
              const isSelected = selectedDate && isSameDay(cellDate, selectedDate);
              const isToday = isSameDay(cellDate, new Date());
              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(cellDate)}
                  className={`relative h-8 w-full flex flex-col items-center justify-center rounded text-xs transition-colors
                    ${isSelected ? "bg-primary text-primary-foreground" : isToday ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
                >
                  {dayNum}
                  {hasAppts && !isSelected && (
                    <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />
                  )}
                </button>
              );
            })}
          </div>
          {/* Summary */}
          <div className="mt-auto border-t border-border px-4 py-3 text-xs text-muted-foreground">
            {isLoading ? "Loading..." : `${appointments.length} total · ${appointments.filter(a => a.status === "scheduled").length} scheduled`}
          </div>
        </div>

        {/* Day detail panel */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="px-6 py-3 border-b border-border flex-shrink-0">
            <span className="text-sm font-semibold">
              {selectedDate
                ? selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
                : "Select a day"}
            </span>
            <span className="ml-3 text-xs text-muted-foreground">
              {selectedDayAppointments.length > 0 ? `${selectedDayAppointments.length} appointment${selectedDayAppointments.length > 1 ? "s" : ""}` : "No appointments"}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {isLoading ? (
              [...Array(3)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
            ) : selectedDayAppointments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
                <CalendarIcon className="h-8 w-8 opacity-20" />
                <span className="text-sm">No appointments on this day</span>
                <button onClick={() => setCreateOpen(true)} className="text-xs text-primary hover:underline mt-1">
                  + Add appointment
                </button>
              </div>
            ) : (
              selectedDayAppointments
                .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                .map(appt => (
                  <AppointmentCard
                    key={appt.id}
                    appointment={appt}
                    companyName={companies?.find(c => c.id === appt.companyId)?.name}
                    onEdit={() => setEditAppointment(appt)}
                    onDelete={() => deleteAppointment(appt.id)}
                    onStatusChange={(s) => updateStatus(appt, s)}
                  />
                ))
            )}
          </div>
        </div>
      </div>

      {/* Create dialog */}
      {createOpen && (
        <AppointmentFormDialog
          defaultDate={selectedDate ?? undefined}
          companies={companies ?? []}
          defaultCompanyId={selectedCompanyId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ["appointments"] });
          }}
        />
      )}

      {/* Edit dialog */}
      {editAppointment && (
        <AppointmentFormDialog
          appointment={editAppointment}
          companies={companies ?? []}
          onClose={() => setEditAppointment(null)}
          onSaved={() => {
            setEditAppointment(null);
            qc.invalidateQueries({ queryKey: ["appointments"] });
          }}
        />
      )}
    </div>
  );
}

function AppointmentCard({
  appointment: a,
  companyName,
  onEdit,
  onDelete,
  onStatusChange,
}: {
  appointment: Appointment;
  companyName?: string;
  onEdit: () => void;
  onDelete: () => void;
  onStatusChange: (s: string) => void;
}) {
  const start = new Date(a.startTime);
  const timeStr = start.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  const endStr = a.endTime ? new Date(a.endTime).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 flex gap-4">
      {/* Time column */}
      <div className="text-center flex-shrink-0 w-16">
        <div className="text-sm font-bold text-foreground">{timeStr}</div>
        {endStr && <div className="text-[10px] text-muted-foreground">→ {endStr}</div>}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{a.title}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${STATUS_COLORS[a.status]}`}>
            {STATUS_LABELS[a.status]}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="h-3 w-3 flex-shrink-0" />
          <span>{a.customerName}</span>
          <span className="text-muted-foreground/40 mx-0.5">·</span>
          <Phone className="h-3 w-3 flex-shrink-0" />
          <span className="font-mono">{a.customerPhone}</span>
          {a.customerEmail && (
            <>
              <span className="text-muted-foreground/40 mx-0.5">·</span>
              <Mail className="h-3 w-3 flex-shrink-0" />
              <span>{a.customerEmail}</span>
            </>
          )}
        </div>
        {companyName && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Building2 className="h-3 w-3 flex-shrink-0" />
            <span>{companyName}</span>
          </div>
        )}
        {a.notes && (
          <p className="text-xs text-muted-foreground/70 bg-secondary/30 rounded px-2 py-1">{a.notes}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex-shrink-0 flex flex-col gap-1 items-end">
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
            <Edit className="h-3.5 w-3.5" />
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent className="bg-card border-border">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete appointment?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently remove the appointment for {a.customerName}.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive" onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {a.status === "scheduled" && (
          <button
            onClick={() => onStatusChange("confirmed")}
            className="text-[10px] px-2 py-0.5 rounded border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors flex items-center gap-1"
          >
            <Check className="h-2.5 w-2.5" /> Confirm
          </button>
        )}
        {a.status !== "cancelled" && a.status !== "no_show" && (
          <button
            onClick={() => onStatusChange("cancelled")}
            className="text-[10px] px-2 py-0.5 rounded border border-red-500/20 text-red-400/70 hover:bg-red-500/10 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function AppointmentFormDialog({
  appointment,
  companies,
  defaultDate,
  defaultCompanyId,
  onClose,
  onSaved,
}: {
  appointment?: Appointment;
  companies: { id: number; name: string }[];
  defaultDate?: Date;
  defaultCompanyId?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!appointment;

  const defaultStartTime = defaultDate
    ? new Date(defaultDate.getFullYear(), defaultDate.getMonth(), defaultDate.getDate(), 9, 0)
    : new Date();
  const toLocal = (d: Date) => {
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
  };

  const [form, setForm] = useState({
    companyId: appointment?.companyId?.toString() ?? defaultCompanyId?.toString() ?? "",
    customerName: appointment?.customerName ?? "",
    customerPhone: appointment?.customerPhone ?? "",
    customerEmail: appointment?.customerEmail ?? "",
    title: appointment?.title ?? "Appointment",
    notes: appointment?.notes ?? "",
    startTime: appointment ? toLocal(new Date(appointment.startTime)) : toLocal(defaultStartTime),
    endTime: appointment?.endTime ? toLocal(new Date(appointment.endTime)) : "",
    status: appointment?.status ?? "scheduled",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.customerName || !form.customerPhone || !form.startTime) {
      toast({ title: "Name, phone, and start time are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const body = {
        companyId: form.companyId ? parseInt(form.companyId, 10) : null,
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        customerEmail: form.customerEmail || null,
        title: form.title || "Appointment",
        notes: form.notes || null,
        startTime: new Date(form.startTime).toISOString(),
        endTime: form.endTime ? new Date(form.endTime).toISOString() : null,
        status: form.status,
      };
      const url = isEdit ? `${BASE}/api/appointments/${appointment!.id}` : `${BASE}/api/appointments`;
      const r = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      toast({ title: isEdit ? "Appointment updated" : "Appointment created" });
      onSaved();
    } catch (err: any) {
      toast({ title: "Failed to save appointment", description: err?.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-card border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Appointment" : "New Appointment"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Customer Name *</Label>
              <Input className="h-8 text-xs bg-background" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} placeholder="John Smith" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Customer Phone *</Label>
              <Input className="h-8 text-xs bg-background font-mono" value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value }))} placeholder="+1 555 000 0000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Customer Email</Label>
              <Input className="h-8 text-xs bg-background" value={form.customerEmail} onChange={e => setForm(f => ({ ...f, customerEmail: e.target.value }))} placeholder="email@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Company</Label>
              <Select value={form.companyId || "none"} onValueChange={v => setForm(f => ({ ...f, companyId: v === "none" ? "" : v }))}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue placeholder="Select company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Appointment Title</Label>
            <Input className="h-8 text-xs bg-background" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Consultation" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Start Time *</Label>
              <Input type="datetime-local" className="h-8 text-xs bg-background" value={form.startTime} onChange={e => setForm(f => ({ ...f, startTime: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">End Time</Label>
              <Input type="datetime-local" className="h-8 text-xs bg-background" value={form.endTime} onChange={e => setForm(f => ({ ...f, endTime: e.target.value }))} />
            </div>
          </div>
          {isEdit && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as "scheduled" | "confirmed" | "cancelled" | "no_show" }))}>
                <SelectTrigger className="h-8 text-xs bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No Show</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea className="text-xs bg-background resize-none" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional details..." />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Booking"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
