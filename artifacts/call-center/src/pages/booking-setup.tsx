import { useEffect, useMemo, useState } from "react";
import { useListCompanies } from "@workspace/api-client-react";
import { CalendarClock, CalendarOff, Check, Pencil, Plus, Save, Scissors, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface BookingResource { id: number; companyId: number; name: string; resourceType: string; description: string | null; allowRandomAssignment: boolean; active: boolean; }
interface BookingService { id: number; companyId: number; name: string; description: string | null; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; active: boolean; }
interface Availability { id: number; companyId: number; resourceId: number; dayOfWeek: number; startTime: string; endTime: string; active: boolean; }
interface TimeOff { id: number; companyId: number; resourceId: number; startTime: string; endTime: string; reason: string | null; }
interface ResourceService { id: number; companyId: number; resourceId: number; serviceId: number; }
interface BookingSettings { enabled: boolean; timezone: string; slotIntervalMinutes: number; minimumNoticeMinutes: number; maximumAdvanceDays: number; allowResourceSelection: boolean; allowRandomAssignment: boolean; requireApproval: boolean; }

const DEFAULT_SETTINGS: BookingSettings = { enabled: true, timezone: "America/Toronto", slotIntervalMinutes: 30, minimumNoticeMinutes: 60, maximumAdvanceDays: 90, allowResourceSelection: true, allowRandomAssignment: true, requireApproval: false };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? "Request failed");
  return data;
}

function localInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
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
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [resourceServices, setResourceServices] = useState<ResourceService[]>([]);
  const [settings, setSettings] = useState<BookingSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<number | null>(null);
  const [editingServiceId, setEditingServiceId] = useState<number | null>(null);

  const [resourceForm, setResourceForm] = useState({ name: "", resourceType: "staff", description: "", allowRandomAssignment: true });
  const [serviceForm, setServiceForm] = useState({ name: "", description: "", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
  const [hoursForm, setHoursForm] = useState({ resourceId: "", dayOfWeek: "1", startTime: "09:00", endTime: "17:00" });
  const now = new Date();
  const later = new Date(now.getTime() + 60 * 60 * 1000);
  const [timeOffForm, setTimeOffForm] = useState({ resourceId: "", startTime: localInputValue(now), endTime: localInputValue(later), reason: "" });
  const [assignmentResourceId, setAssignmentResourceId] = useState("");
  const [selectedServiceIds, setSelectedServiceIds] = useState<number[]>([]);

  useEffect(() => { if (!companyId && companies.length === 1) setCompanyId(companies[0].id); }, [companies, companyId]);

  async function load() {
    if (!companyId) return;
    setLoading(true);
    try {
      const [resourceRows, serviceRows, settingsRow, availabilityRows, timeOffRows, assignmentRows] = await Promise.all([
        api(`/api/booking/resources?companyId=${companyId}`),
        api(`/api/booking/services?companyId=${companyId}`),
        api(`/api/booking/settings?companyId=${companyId}`),
        api(`/api/booking/availability?companyId=${companyId}`),
        api(`/api/booking/time-off?companyId=${companyId}`),
        api(`/api/booking/resource-services?companyId=${companyId}`),
      ]);
      setResources(resourceRows ?? []); setServices(serviceRows ?? []); setAvailability(availabilityRows ?? []); setTimeOff(timeOffRows ?? []); setResourceServices(assignmentRows ?? []);
      setSettings(settingsRow ? { ...DEFAULT_SETTINGS, ...settingsRow } : DEFAULT_SETTINGS);
    } catch (error: any) {
      toast({ title: "Booking setup could not load", description: error.message, variant: "destructive" });
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [companyId]);

  function changeCompany(value: string) {
    const id = Number(value); setCompanyId(id);
    const url = new URL(window.location.href); url.searchParams.set("companyId", String(id)); window.history.replaceState({}, "", url);
  }

  function resetResourceForm() { setResourceForm({ name: "", resourceType: "staff", description: "", allowRandomAssignment: true }); setEditingResourceId(null); }
  function resetServiceForm() { setServiceForm({ name: "", description: "", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 }); setEditingServiceId(null); }

  async function saveResource() {
    if (!companyId || !resourceForm.name.trim()) return;
    try {
      if (editingResourceId) await api(`/api/booking/resources/${editingResourceId}`, { method: "PATCH", body: JSON.stringify(resourceForm) });
      else await api("/api/booking/resources", { method: "POST", body: JSON.stringify({ companyId, ...resourceForm }) });
      resetResourceForm(); await load(); toast({ title: editingResourceId ? "Resource updated" : "Resource added" });
    } catch (error: any) { toast({ title: "Could not save resource", description: error.message, variant: "destructive" }); }
  }
  function editResource(resource: BookingResource) { setEditingResourceId(resource.id); setResourceForm({ name: resource.name, resourceType: resource.resourceType, description: resource.description ?? "", allowRandomAssignment: resource.allowRandomAssignment }); }
  async function toggleResource(resource: BookingResource) {
    try { await api(`/api/booking/resources/${resource.id}`, { method: "PATCH", body: JSON.stringify({ active: !resource.active }) }); await load(); }
    catch (error: any) { toast({ title: "Could not update resource", description: error.message, variant: "destructive" }); }
  }

  async function saveService() {
    if (!companyId || !serviceForm.name.trim()) return;
    try {
      if (editingServiceId) await api(`/api/booking/services/${editingServiceId}`, { method: "PATCH", body: JSON.stringify(serviceForm) });
      else await api("/api/booking/services", { method: "POST", body: JSON.stringify({ companyId, ...serviceForm }) });
      resetServiceForm(); await load(); toast({ title: editingServiceId ? "Service updated" : "Service added" });
    } catch (error: any) { toast({ title: "Could not save service", description: error.message, variant: "destructive" }); }
  }
  function editService(service: BookingService) { setEditingServiceId(service.id); setServiceForm({ name: service.name, description: service.description ?? "", durationMinutes: service.durationMinutes, bufferBeforeMinutes: service.bufferBeforeMinutes, bufferAfterMinutes: service.bufferAfterMinutes }); }
  async function toggleService(service: BookingService) {
    try { await api(`/api/booking/services/${service.id}`, { method: "PATCH", body: JSON.stringify({ active: !service.active }) }); await load(); }
    catch (error: any) { toast({ title: "Could not update service", description: error.message, variant: "destructive" }); }
  }

  async function saveSettings() {
    if (!companyId) return;
    try { await api("/api/booking/settings", { method: "PUT", body: JSON.stringify({ companyId, ...settings }) }); toast({ title: "Booking rules saved" }); }
    catch (error: any) { toast({ title: "Could not save booking rules", description: error.message, variant: "destructive" }); }
  }

  async function addHours() {
    if (!companyId || !hoursForm.resourceId) return;
    if (hoursForm.endTime <= hoursForm.startTime) { toast({ title: "End time must be after start time", variant: "destructive" }); return; }
    try {
      await api("/api/booking/availability", { method: "POST", body: JSON.stringify({ companyId, resourceId: Number(hoursForm.resourceId), dayOfWeek: Number(hoursForm.dayOfWeek), startTime: hoursForm.startTime, endTime: hoursForm.endTime }) });
      await load(); toast({ title: "Working hours added" });
    } catch (error: any) { toast({ title: "Could not add working hours", description: error.message, variant: "destructive" }); }
  }
  async function deleteHours(id: number) { try { await api(`/api/booking/availability/${id}`, { method: "DELETE" }); await load(); } catch (error: any) { toast({ title: "Could not remove hours", description: error.message, variant: "destructive" }); } }

  async function addTimeOff() {
    if (!companyId || !timeOffForm.resourceId) return;
    try {
      await api("/api/booking/time-off", { method: "POST", body: JSON.stringify({ companyId, resourceId: Number(timeOffForm.resourceId), startTime: new Date(timeOffForm.startTime).toISOString(), endTime: new Date(timeOffForm.endTime).toISOString(), reason: timeOffForm.reason }) });
      await load(); toast({ title: "Time off added" });
    } catch (error: any) { toast({ title: "Could not add time off", description: error.message, variant: "destructive" }); }
  }
  async function deleteTimeOff(id: number) { try { await api(`/api/booking/time-off/${id}`, { method: "DELETE" }); await load(); } catch (error: any) { toast({ title: "Could not remove time off", description: error.message, variant: "destructive" }); } }

  function chooseAssignmentResource(value: string) {
    setAssignmentResourceId(value);
    setSelectedServiceIds(resourceServices.filter(row => row.resourceId === Number(value)).map(row => row.serviceId));
  }
  async function saveAssignments() {
    if (!assignmentResourceId) return;
    try { await api(`/api/booking/resource-services/${assignmentResourceId}`, { method: "PUT", body: JSON.stringify({ serviceIds: selectedServiceIds }) }); await load(); toast({ title: "Service assignments saved" }); }
    catch (error: any) { toast({ title: "Could not save assignments", description: error.message, variant: "destructive" }); }
  }

  const activeResources = resources.filter(resource => resource.active);
  const activeServices = services.filter(service => service.active);
  const resourceName = (id: number) => resources.find(resource => resource.id === id)?.name ?? `Resource ${id}`;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Booking Setup</h1><p className="text-sm text-muted-foreground mt-1">Configure resources, services, schedules, time off and AI booking rules for any type of company.</p></div>
        <Select value={companyId?.toString() ?? ""} onValueChange={changeCompany}><SelectTrigger className="w-64"><SelectValue placeholder="Select company" /></SelectTrigger><SelectContent>{companies.map(company => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}</SelectContent></Select>
      </div>

      {!companyId ? <div className="border border-dashed border-border rounded-lg p-10 text-center text-muted-foreground">Select a company to configure its booking system.</div> : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /><h2 className="font-semibold">Bookable Resources</h2></div>
            <p className="text-xs text-muted-foreground">People or capacity being booked: barber, realtor, technician, chair, room, table or service vehicle.</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Name</Label><Input value={resourceForm.name} onChange={e => setResourceForm(v => ({ ...v, name: e.target.value }))} placeholder="Technician 1 or Chair 1" /></div>
              <div className="space-y-1.5"><Label>Type</Label><Input value={resourceForm.resourceType} onChange={e => setResourceForm(v => ({ ...v, resourceType: e.target.value }))} placeholder="technician" /></div>
              <div className="col-span-2 space-y-1.5"><Label>Description</Label><Textarea value={resourceForm.description} onChange={e => setResourceForm(v => ({ ...v, description: e.target.value }))} placeholder="Skills, specialties, service area or notes" rows={2} /></div>
              <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={resourceForm.allowRandomAssignment} onCheckedChange={checked => setResourceForm(v => ({ ...v, allowRandomAssignment: checked }))} />Allow automatic assignment when the caller has no preference</label>
            </div>
            <div className="flex gap-2"><Button onClick={saveResource} disabled={!resourceForm.name.trim()}>{editingResourceId ? <Save className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}{editingResourceId ? "Save Resource" : "Add Resource"}</Button>{editingResourceId && <Button variant="outline" onClick={resetResourceForm}>Cancel</Button>}</div>
            <div className="space-y-2 border-t border-border pt-4">
              {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : resources.length === 0 ? <p className="text-sm text-muted-foreground">No resources yet.</p> : resources.map(resource => (
                <div key={resource.id} className={`flex items-center justify-between rounded-md border px-3 py-2 ${resource.active ? "border-border/70" : "border-border/40 opacity-60"}`}>
                  <div><div className="text-sm font-medium">{resource.name}</div><div className="text-xs text-muted-foreground">{resource.resourceType}{resource.allowRandomAssignment ? " · random assignment" : ""}</div></div>
                  <div className="flex items-center gap-1"><Button size="icon" variant="ghost" onClick={() => editResource(resource)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" onClick={() => toggleResource(resource)}>{resource.active ? "Disable" : "Enable"}</Button></div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Scissors className="h-5 w-5 text-primary" /><h2 className="font-semibold">Services</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Service name</Label><Input value={serviceForm.name} onChange={e => setServiceForm(v => ({ ...v, name: e.target.value }))} placeholder="Emergency tire service" /></div>
              <div className="space-y-1.5"><Label>Duration (minutes)</Label><Input type="number" min={5} value={serviceForm.durationMinutes} onChange={e => setServiceForm(v => ({ ...v, durationMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Buffer before</Label><Input type="number" min={0} value={serviceForm.bufferBeforeMinutes} onChange={e => setServiceForm(v => ({ ...v, bufferBeforeMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Buffer after</Label><Input type="number" min={0} value={serviceForm.bufferAfterMinutes} onChange={e => setServiceForm(v => ({ ...v, bufferAfterMinutes: Number(e.target.value) }))} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Description</Label><Textarea value={serviceForm.description} onChange={e => setServiceForm(v => ({ ...v, description: e.target.value }))} rows={2} placeholder="Information the AI should know about this service" /></div>
            </div>
            <div className="flex gap-2"><Button onClick={saveService} disabled={!serviceForm.name.trim()}>{editingServiceId ? <Save className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}{editingServiceId ? "Save Service" : "Add Service"}</Button>{editingServiceId && <Button variant="outline" onClick={resetServiceForm}>Cancel</Button>}</div>
            <div className="space-y-2 border-t border-border pt-4">
              {services.length === 0 ? <p className="text-sm text-muted-foreground">No services yet.</p> : services.map(service => (
                <div key={service.id} className={`flex items-center justify-between rounded-md border px-3 py-2 ${service.active ? "border-border/70" : "border-border/40 opacity-60"}`}>
                  <div><div className="text-sm font-medium">{service.name}</div><div className="text-xs text-muted-foreground">{service.durationMinutes} min · {service.bufferBeforeMinutes + service.bufferAfterMinutes} min buffer</div></div>
                  <div className="flex items-center gap-1"><Button size="icon" variant="ghost" onClick={() => editService(service)}><Pencil className="h-3.5 w-3.5" /></Button><Button size="sm" variant="outline" onClick={() => toggleService(service)}>{service.active ? "Disable" : "Enable"}</Button></div>
                </div>
              ))}
            </div>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><CalendarClock className="h-5 w-5 text-primary" /><h2 className="font-semibold">Working Hours</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Resource</Label><Select value={hoursForm.resourceId} onValueChange={value => setHoursForm(v => ({ ...v, resourceId: value }))}><SelectTrigger><SelectValue placeholder="Choose staff or resource" /></SelectTrigger><SelectContent>{activeResources.map(resource => <SelectItem key={resource.id} value={String(resource.id)}>{resource.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="col-span-2 space-y-1.5"><Label>Day</Label><Select value={hoursForm.dayOfWeek} onValueChange={value => setHoursForm(v => ({ ...v, dayOfWeek: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{DAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Start</Label><Input type="time" value={hoursForm.startTime} onChange={e => setHoursForm(v => ({ ...v, startTime: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>End</Label><Input type="time" value={hoursForm.endTime} onChange={e => setHoursForm(v => ({ ...v, endTime: e.target.value }))} /></div>
            </div>
            <Button onClick={addHours} disabled={!hoursForm.resourceId}><Plus className="h-4 w-4 mr-2" />Add Working Hours</Button>
            <div className="space-y-2 border-t border-border pt-4 max-h-64 overflow-auto">
              {availability.length === 0 ? <p className="text-sm text-muted-foreground">No working hours entered.</p> : availability.sort((a,b) => a.resourceId-b.resourceId || a.dayOfWeek-b.dayOfWeek).map(row => (
                <div key={row.id} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2"><div><div className="text-sm font-medium">{resourceName(row.resourceId)}</div><div className="text-xs text-muted-foreground">{DAYS[row.dayOfWeek]} · {row.startTime}–{row.endTime}</div></div><Button size="icon" variant="ghost" onClick={() => deleteHours(row.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button></div>
              ))}
            </div>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><CalendarOff className="h-5 w-5 text-primary" /><h2 className="font-semibold">Breaks & Time Off</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5"><Label>Resource</Label><Select value={timeOffForm.resourceId} onValueChange={value => setTimeOffForm(v => ({ ...v, resourceId: value }))}><SelectTrigger><SelectValue placeholder="Choose staff or resource" /></SelectTrigger><SelectContent>{activeResources.map(resource => <SelectItem key={resource.id} value={String(resource.id)}>{resource.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Start</Label><Input type="datetime-local" value={timeOffForm.startTime} onChange={e => setTimeOffForm(v => ({ ...v, startTime: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>End</Label><Input type="datetime-local" value={timeOffForm.endTime} onChange={e => setTimeOffForm(v => ({ ...v, endTime: e.target.value }))} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Reason</Label><Input value={timeOffForm.reason} onChange={e => setTimeOffForm(v => ({ ...v, reason: e.target.value }))} placeholder="Lunch, vacation, unavailable, vehicle maintenance" /></div>
            </div>
            <Button onClick={addTimeOff} disabled={!timeOffForm.resourceId}><Plus className="h-4 w-4 mr-2" />Add Time Off</Button>
            <div className="space-y-2 border-t border-border pt-4 max-h-64 overflow-auto">
              {timeOff.length === 0 ? <p className="text-sm text-muted-foreground">No breaks or time off entered.</p> : timeOff.map(row => (
                <div key={row.id} className="flex items-center justify-between rounded-md border border-border/70 px-3 py-2"><div><div className="text-sm font-medium">{resourceName(row.resourceId)}{row.reason ? ` · ${row.reason}` : ""}</div><div className="text-xs text-muted-foreground">{new Date(row.startTime).toLocaleString()} – {new Date(row.endTime).toLocaleString()}</div></div><Button size="icon" variant="ghost" onClick={() => deleteTimeOff(row.id)}><Trash2 className="h-3.5 w-3.5 text-red-400" /></Button></div>
              ))}
            </div>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Check className="h-5 w-5 text-primary" /><h2 className="font-semibold">Who Can Perform Each Service</h2></div>
            <p className="text-xs text-muted-foreground">Choose a resource, then select the services it can perform. Leaving all services unchecked means it may be considered for any service.</p>
            <Select value={assignmentResourceId} onValueChange={chooseAssignmentResource}><SelectTrigger><SelectValue placeholder="Choose resource" /></SelectTrigger><SelectContent>{activeResources.map(resource => <SelectItem key={resource.id} value={String(resource.id)}>{resource.name}</SelectItem>)}</SelectContent></Select>
            {assignmentResourceId && <div className="space-y-2">{activeServices.map(service => <label key={service.id} className="flex items-center gap-2 rounded border border-border/70 px-3 py-2 text-sm"><input type="checkbox" checked={selectedServiceIds.includes(service.id)} onChange={e => setSelectedServiceIds(ids => e.target.checked ? [...ids, service.id] : ids.filter(id => id !== service.id))} />{service.name}<span className="ml-auto text-xs text-muted-foreground">{service.durationMinutes} min</span></label>)}</div>}
            <Button onClick={saveAssignments} disabled={!assignmentResourceId}><Save className="h-4 w-4 mr-2" />Save Service Assignments</Button>
          </section>

          <section className="border border-border rounded-lg bg-card p-5 space-y-5">
            <div className="flex items-center gap-2"><Save className="h-5 w-5 text-primary" /><h2 className="font-semibold">Company Booking Rules</h2></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex items-center gap-2 text-sm"><Switch checked={settings.enabled} onCheckedChange={enabled => setSettings(v => ({ ...v, enabled }))} />Enable AI and dashboard bookings</label>
              <div className="col-span-2 space-y-1.5"><Label>Timezone</Label><Input value={settings.timezone} onChange={e => setSettings(v => ({ ...v, timezone: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Slot interval</Label><Input type="number" min={5} value={settings.slotIntervalMinutes} onChange={e => setSettings(v => ({ ...v, slotIntervalMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Minimum notice (minutes)</Label><Input type="number" min={0} value={settings.minimumNoticeMinutes} onChange={e => setSettings(v => ({ ...v, minimumNoticeMinutes: Number(e.target.value) }))} /></div>
              <div className="space-y-1.5"><Label>Maximum advance days</Label><Input type="number" min={1} value={settings.maximumAdvanceDays} onChange={e => setSettings(v => ({ ...v, maximumAdvanceDays: Number(e.target.value) }))} /></div>
              <div className="space-y-3 pt-5"><label className="flex items-center gap-2 text-sm"><Switch checked={settings.allowResourceSelection} onCheckedChange={allowResourceSelection => setSettings(v => ({ ...v, allowResourceSelection }))} />Allow preferred resource</label><label className="flex items-center gap-2 text-sm"><Switch checked={settings.allowRandomAssignment} onCheckedChange={allowRandomAssignment => setSettings(v => ({ ...v, allowRandomAssignment }))} />Allow random assignment</label><label className="flex items-center gap-2 text-sm"><Switch checked={settings.requireApproval} onCheckedChange={requireApproval => setSettings(v => ({ ...v, requireApproval }))} />Require admin approval</label></div>
            </div>
            <Button onClick={saveSettings}><Save className="h-4 w-4 mr-2" />Save Booking Rules</Button>
          </section>
        </div>
      )}
    </div>
  );
}
