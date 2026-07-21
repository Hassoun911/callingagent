import { useEffect, useMemo, useState } from "react";
import { useListCompanies } from "@workspace/api-client-react";
import { CalendarClock, Plus, Save, Scissors, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface BookingResource {
  id: number;
  companyId: number;
  name: string;
  resourceType: string;
  description: string | null;
  allowRandomAssignment: boolean;
  active: boolean;
}

interface BookingService {
  id: number;
  companyId: number;
  name: string;
  description: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  active: boolean;
}

interface BookingSettings {
  enabled: boolean;
  timezone: string;
  slotIntervalMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  allowResourceSelection: boolean;
  allowRandomAssignment: boolean;
  requireApproval: boolean;
}

const DEFAULT_SETTINGS: BookingSettings = {
  enabled: true,
  timezone: "America/Toronto",
  slotIntervalMinutes: 30,
  minimumNoticeMinutes: 60,
  maximumAdvanceDays: 90,
  allowResourceSelection: true,
  allowRandomAssignment: true,
  requireApproval: false,
};

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

export default function BookingSetupPage() {
  const { toast } = useToast();
  const { data: companies = [] } = useListCompanies();
  const queryCompanyId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("companyId");
    return value ? Number(value) : undefined;
  }, []);
  const [companyId, setCompanyId] = useState<number | undefined>(queryCompanyId);
  const [resources, setResources] = useState<BookingResource[]>([]);
  const [services, setServices] = useState<BookingService[]>([]);
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);

  const [resourceForm, setResourceForm] = useState({ name: "", resourceType: "staff", description: "", allowRandomAssignment: true });
  const [serviceForm, setServiceForm] = useState({ name: "", description: "", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
  const [hoursForm, setHoursForm] = useState({ resourceId: "", dayOfWeek: "1", startTime: "09:00", endTime: "17:00" });

  useEffect(() => {
    if (!companyId && companies.length === 1) setCompanyId(companies[0].id);
  }, [companies, companyId]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [resourceRows, serviceRows, settingsRow] = await Promise.all([
        api(`/api/booking/resources?companyId=${companyId}`),
        api(`/api/booking/services?companyId=${companyId}`),
        api(`/api/booking/settings?companyId=${companyId}`),
      ]);
      setResources(resourceRows ?? []);
      setServices(serviceRows ?? []);
      setSettings(settingsRow ? { ...DEFAULT_SETTINGS, ...settingsRow } : DEFAULT_SETTINGS);
    } catch (error: any) {
      toast({ title: "Booking setup could not load", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [companyId]);

  async function createResource() {
    if (!companyId || !resourceForm.name.trim()) return;
    try {
      await api("/api/booking/resources", { method: "POST", body: JSON.stringify({ companyId, ...resourceForm }) });
      setResourceForm({ name: "", resourceType: "staff", description: "", allowRandomAssignment: true });
      await load();
      toast({ title: "Resource added" });
    } catch (error: any) {
      toast({ title: "Could not add resource", description: error.message, variant: "destructive" });
    }
  }

  async function createService() {
    if (!companyId || !serviceForm.name.trim()) return;
    try {
      await api("/api/booking/services", { method: "POST", body: JSON.stringify({ companyId, ...serviceForm }) });
      setServiceForm({ name: "", description: "", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
      await load();
      toast({ title: "Service added" });
    } catch (error: any) {
      toast({ title: "Could not add service", description: error.message, variant: "destructive" });
    }
  }

  async function saveSettings() {
    if (!companyId) return;
    try {
      await api("/api/booking/settings", { method: "PUT", body: JSON.stringify({ companyId, ...settings }) });
      toast({ title: "Booking rules saved" });
    } catch (error: any) {
      toast({ title: "Could not save booking rules", description: error.message, variant: "destructive" });
    }
  }

  async function addHours() {
    if (!companyId || !hoursForm.resourceId) return;
    try {
      await api("/api/booking/availability", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          resourceId: Number(hoursForm.resourceId),
          dayOfWeek: Number(hoursForm.dayOfWeek),
          startTime: hoursForm.startTime,
          endTime: hoursForm.endTime,
        }),
      });
      toast({ title: "Working hours added", description: `${DAYS[Number(hoursForm.dayOfWeek)]}, ${hoursForm.startTime}–${hoursForm.endTime}` });
    } catch (error: any) {
      toast({ title: "Could not add working hours", description: error.message, variant: "destructive" });
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Booking Setup</h1>
          <p className="text-sm text-muted-foreground mt-1">Configure staff, chairs, agents, technicians, services, hours and AI booking rules.</p>
        </div>
        <Select value={companyId?.toString() ?? ""} onValueChange={value => setCompanyId(Number(value))}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select company" /></SelectTrigger>
          <SelectContent>{companies.map(company => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {!companyId ? (
        <div className="border border-dashed border-border rounded-lg p-10 text-center text-muted-foreground">Select a company to configure its booking system.</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /><h2 className="font-semibold">Bookable Resources</h2></div>
            <p className="text-xs text-muted-foreground">Examples: barber, stylist, realtor, technician, chair, room or service vehicle.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={resourceForm.name} onChange={e => setResourceForm(v => ({ ...v, name: e.target.value }))} placeholder="Ahmad or Chair 1" /></div>
              <div className="space-y-1.5"><Label>Type</Label><Input value={resourceForm.resourceType} onChange={e => setResourceForm(v => ({ ...v, resourceType: e.target.value }))} placeholder="barber" /></div>
              <div className="col-span-2 space-y-1.5"><Label>Description</Label><Textarea value={resourceForm.description} onChange={e => setResourceForm(v => ({ ...v, description: e.target.value }))} placeholder="Services, specialties or notes" rows={2} /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={resourceForm.allowRandomAssignment} onCheckedChange={checked => setResourceForm(v => ({ ...v, allowRandomAssignment: checked }))} />Allow automatic assignment when the caller has no preference</label>
            </div>
            <Button onClick={createResource} disabled={!resourceForm.name.trim()}><Plus className="h-4 w-4 mr-2" />Add Resource</Button>
            <div className="space-y-2 border-t border-border pt-4">
              {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : resources.length === 0 ? <p className="text-sm text-muted-foreground">No resources yet.</p> : resources.map(resource => (
                <div key={resource.id} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
                  <div><div className="text-sm font-medium">{resource.name}</div><div className="text-xs text-muted-foreground">{resource.resourceType}{resource.allowRandomAssignment ? " · automatic assignment enabled" : ""}</div></div>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Scissors className="h-5 w-5 text-primary" /><h2 className="font-semibold">Services</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Service name</Label><Input value={serviceForm.name} onChange={e => setServiceForm(v => ({ ...v, name: e.target.value }))} placeholder="Haircut" /></div>
              <div className="space-y-1.5"><Label>Duration (minutes)</Label><Input type="number" min={5} value={serviceForm.durationMinutes} onChange={e => setServiceForm(v => ({ ...v, durationMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Buffer before</Label><Input type="number" min={0} value={serviceForm.bufferBeforeMinutes} onChange={e => setServiceForm(v => ({ ...v, bufferBeforeMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Buffer after</Label><Input type="number" min={0} value={serviceForm.bufferAfterMinutes} onChange={e => setServiceForm(v => ({ ...v, bufferAfterMinutes: Number(e.target.value) }))} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Description</Label><Textarea value={serviceForm.description} onChange={e => setServiceForm(v => ({ ...v, description: e.target.value }))} rows={2} placeholder="What the AI should know about this service" /></div>
            </div>
            <Button onClick={createService} disabled={!serviceForm.name.trim()}><Plus className="h-4 w-4 mr-2" />Add Service</Button>
            <div className="space-y-2 border-t border-border pt-4">
              {services.length === 0 ? <p className="text-sm text-muted-foreground">No services yet.</p> : services.map(service => (
                <div key={service.id} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2">
                  <div><div className="text-sm font-medium">{service.name}</div><div className="text-xs text-muted-foreground">{service.durationMinutes} minutes · {service.bufferBeforeMinutes + service.bufferAfterMinutes} minutes total buffer</div></div>
                  <span className="text-xs text-emerald-400">Active</span>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /><h2 className="font-semibold">Working Hours</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Resource</Label><Select value={hoursForm.resourceId} onValueChange={value => setHoursForm(v => ({ ...v, resourceId: value }))}><SelectTrigger><SelectValue placeholder="Choose staff or resource" /></SelectTrigger><SelectContent>{resources.map(resource => <SelectItem key={resource.id} value={String(resource.id)}>{resource.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2 space-y-1.5"><Label>Day</Label><Select value={hoursForm.dayOfWeek} onValueChange={value => setHoursForm(v => ({ ...v, dayOfWeek: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Start</Label><Input type="time" value={hoursForm.startTime} onChange={e => setHoursForm(v => ({ ...v, startTime: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>End</Label><Input type="time" value={hoursForm.endTime} onChange={e => setHoursForm(v => ({ ...v, endTime: e.target.value }))} /></div>
            </div>
            <Button onClick={addHours} disabled={!hoursForm.resourceId}><Plus className="h-4 w-4 mr-2" />Add Working Hours</Button>
            <p className="text-xs text-muted-foreground">Add one row for each day the resource works. Breaks and time off will be added in the next setup phase.</p>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Save className="h-5 w-5 text-primary" /><h2 className="font-semibold">Company Booking Rules</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={settings.enabled} onCheckedChange={enabled => setSettings(v => ({ ...v, enabled }))} />Enable AI and dashboard bookings</label>
              <div className="col-span-2 space-y-1.5"><Label>Timezone</Label><Input value={settings.timezone} onChange={e => setSettings(v => ({ ...v, timezone: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Slot interval</Label><Input type="number" min={5} value={settings.slotIntervalMinutes} onChange={e => setSettings(v => ({ ...v, slotIntervalMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Minimum notice (minutes)</Label><Input type="number" min={0} value={settings.minimumNoticeMinutes} onChange={e => setSettings(v => ({ ...v, minimumNoticeMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Maximum advance days</Label><Input type="number" min={1} value={settings.maximumAdvanceDays} onChange={e => setSettings(v => ({ ...v, maximumAdvanceDays: Number(e.target.value) }))} /></div>
              <div className="space-y-3 pt-5">
                <label className="flex items-center gap-2 text-sm"><Switch checked={settings.allowResourceSelection} onCheckedChange={allowResourceSelection => setSettings(v => ({ ...v, allowResourceSelection }))} />Allow preferred staff</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={settings.allowRandomAssignment} onCheckedChange={allowRandomAssignment => setSettings(v => ({ ...v, allowRandomAssignment }))} />Allow random assignment</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={settings.requireApproval} onCheckedChange={requireApproval => setSettings(v => ({ ...v, requireApproval }))} />Require admin approval</label>
              </div>
            </div>
            <Button onClick={saveSettings}><Save className="h-4 w-4 mr-2" />Save Booking Rules</Button>
          </section>
        </div>
      )}
    </div>
  );
}
