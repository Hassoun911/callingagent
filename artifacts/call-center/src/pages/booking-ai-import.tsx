import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface SuggestedResource { name: string; resourceType: string; description: string; allowRandomAssignment: boolean; }
interface SuggestedService { name: string; description: string; durationMinutes: number; bufferBeforeMinutes: number; bufferAfterMinutes: number; }
interface SuggestedAvailability { resourceName: string; dayOfWeek: number; startTime: string; endTime: string; }
interface SuggestedSettings { enabled: boolean; timezone: string; slotIntervalMinutes: number; minimumNoticeMinutes: number; maximumAdvanceDays: number; allowResourceSelection: boolean; allowRandomAssignment: boolean; requireApproval: boolean; }
interface ImportDraft { companyId: number; companyName: string; resources: SuggestedResource[]; services: SuggestedService[]; availability: SuggestedAvailability[]; settings: SuggestedSettings; warnings: string[]; }

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error ?? `Request failed (${response.status})`);
  return data;
}

function to24(hourRaw: string, minuteRaw: string | undefined, meridiem: string): string {
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  if (meridiem.toLowerCase() === "pm" && hour < 12) hour += 12;
  if (meridiem.toLowerCase() === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function browserFallback(promptText: string, companyName: string, companyId: number): ImportDraft {
  const text = String(promptText || "").replace(/\r/g, "");
  const lower = text.toLowerCase();
  let resourceType = "staff";
  let resourceName = "Staff Member";
  if (/tire|roadside|vehicle/.test(lower)) { resourceType = "technician"; resourceName = "Mobile Technician"; }
  else if (/barber/.test(lower)) { resourceType = "barber"; resourceName = "Barber"; }
  else if (/salon|stylist|hair/.test(lower)) { resourceName = "Stylist"; }
  else if (/realtor|real estate|property/.test(lower)) { resourceType = "agent"; resourceName = "Real Estate Agent"; }
  else if (/dentist|dental/.test(lower)) { resourceName = "Dental Staff"; }
  else if (/restaurant|table|reservation/.test(lower)) { resourceType = "table"; resourceName = "Table"; }

  const patterns: Array<[RegExp, string, number]> = [
    [/emergency[^\n.]*tire|roadside[^\n.]*service/i, "Emergency Roadside Tire Service", 90],
    [/flat tire|puncture repair/i, "Flat Tire Repair", 60],
    [/spare tire/i, "Spare Tire Change", 45],
    [/tire installation|install(?:ation)?[^\n.]*tire/i, "Tire Installation", 90],
    [/rotation|balanc/i, "Tire Rotation and Balancing", 60],
    [/haircut and beard|haircut.*beard/i, "Haircut and Beard", 45],
    [/haircut/i, "Haircut", 30],
    [/beard trim/i, "Beard Trim", 20],
    [/buyer consultation/i, "Buyer Consultation", 30],
    [/listing consultation/i, "Listing Consultation", 60],
    [/property showing/i, "Property Showing", 45],
    [/appointment|booking|consultation/i, "General Appointment", 30],
  ];
  const seen = new Set<string>();
  const services: SuggestedService[] = [];
  for (const [pattern, name, duration] of patterns) {
    if (pattern.test(text) && !seen.has(name)) {
      seen.add(name);
      services.push({ name, description: `Detected from ${companyName}'s AI instructions.`, durationMinutes: duration, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
    }
  }
  if (!services.length) services.push({ name: "General Appointment", description: "General booking detected from the AI instructions.", durationMinutes: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });

  const availability: SuggestedAvailability[] = [];
  const hoursMatch = text.match(/(?:monday|mon)[^\n]*?(?:to|-|through)\s*(?:saturday|sat)[^\n]*?(\d{1,2})(?::(\d{2}))?\s*(am|pm)[^\n]*?(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (hoursMatch) {
    const startTime = to24(hoursMatch[1], hoursMatch[2], hoursMatch[3]);
    const endTime = to24(hoursMatch[4], hoursMatch[5], hoursMatch[6]);
    for (let day = 1; day <= 6; day++) availability.push({ resourceName, dayOfWeek: day, startTime, endTime });
  } else if (/24\s*\/\s*7|24 hours|24\/7/.test(lower)) {
    for (let day = 0; day <= 6; day++) availability.push({ resourceName, dayOfWeek: day, startTime: "00:00", endTime: "23:59" });
  }

  const warnings = ["The server analyzer was unavailable, so these suggestions were created in your browser. Review services, durations, and hours before applying."];
  if (!availability.length) warnings.push("No clear working hours were detected. Add working hours manually.");

  return {
    companyId,
    companyName,
    resources: [{ name: resourceName, resourceType, description: `Default bookable resource for ${companyName}.`, allowRandomAssignment: true }],
    services,
    availability,
    settings: {
      enabled: true,
      timezone: "America/Toronto",
      slotIntervalMinutes: 30,
      minimumNoticeMinutes: /emergency|24\s*\/\s*7|24 hours/.test(lower) ? 0 : 60,
      maximumAdvanceDays: 90,
      allowResourceSelection: true,
      allowRandomAssignment: true,
      requireApproval: false,
    },
    warnings,
  };
}

export default function BookingAiImportPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const companyId = useMemo(() => {
    const value = new URLSearchParams(window.location.search).get("companyId");
    return value ? Number(value) : 0;
  }, []);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [applying, setApplying] = useState(false);

  async function analyze() {
    if (!companyId) return;
    setExtracting(true);
    try {
      try {
        const result = await api("/api/ai-voice/extract-booking-setup", { method: "POST", body: JSON.stringify({ companyId }) });
        setDraft(result);
        toast({ title: "AI suggestions ready", description: "Review the suggestions before applying them." });
        return;
      } catch (serverError) {
        console.warn("Server booking analysis failed; using browser fallback", serverError);
      }

      const [config, companies] = await Promise.all([
        api("/api/ai-voice/config"),
        api("/api/companies"),
      ]);
      const company = Array.isArray(companies) ? companies.find((row: any) => Number(row.id) === companyId) : null;
      const promptText = String(config?.systemPrompt || "").trim();
      if (!promptText) throw new Error("The AI system prompt is empty");
      const fallbackDraft = browserFallback(promptText, company?.name || `Company ${companyId}`, companyId);
      setDraft(fallbackDraft);
      toast({ title: "Suggestions ready", description: "The built-in browser analyzer was used. Review everything before applying." });
    } catch (error: any) {
      toast({ title: "Could not analyze AI settings", description: error?.message || "Could not load the saved AI instructions", variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  }

  async function applyDraft() {
    if (!draft || !companyId) return;
    setApplying(true);
    try {
      const existingResources: any[] = await api(`/api/booking/resources?companyId=${companyId}`);
      const existingServices: any[] = await api(`/api/booking/services?companyId=${companyId}`);
      const existingAvailability: any[] = await api(`/api/booking/availability?companyId=${companyId}`);

      const resourcesByName = new Map(existingResources.map(row => [String(row.name).trim().toLowerCase(), row]));
      for (const suggestion of draft.resources) {
        const key = suggestion.name.trim().toLowerCase();
        const existing: any = resourcesByName.get(key);
        if (existing) {
          const updated = await api(`/api/booking/resources/${existing.id}`, { method: "PATCH", body: JSON.stringify({ ...suggestion, active: true }) });
          resourcesByName.set(key, updated);
        } else {
          const created = await api("/api/booking/resources", { method: "POST", body: JSON.stringify({ companyId, ...suggestion }) });
          resourcesByName.set(key, created);
        }
      }

      const servicesByName = new Map(existingServices.map(row => [String(row.name).trim().toLowerCase(), row]));
      for (const suggestion of draft.services) {
        const key = suggestion.name.trim().toLowerCase();
        const existing: any = servicesByName.get(key);
        if (existing) {
          const updated = await api(`/api/booking/services/${existing.id}`, { method: "PATCH", body: JSON.stringify({ ...suggestion, active: true }) });
          servicesByName.set(key, updated);
        } else {
          const created = await api("/api/booking/services", { method: "POST", body: JSON.stringify({ companyId, ...suggestion }) });
          servicesByName.set(key, created);
        }
      }

      const availabilityKeys = new Set(existingAvailability.map(row => `${row.resourceId}|${row.dayOfWeek}|${row.startTime}|${row.endTime}`));
      for (const suggestion of draft.availability) {
        const resource: any = resourcesByName.get(suggestion.resourceName.trim().toLowerCase());
        if (!resource) continue;
        const key = `${resource.id}|${suggestion.dayOfWeek}|${suggestion.startTime}|${suggestion.endTime}`;
        if (availabilityKeys.has(key)) continue;
        await api("/api/booking/availability", { method: "POST", body: JSON.stringify({ companyId, resourceId: resource.id, dayOfWeek: suggestion.dayOfWeek, startTime: suggestion.startTime, endTime: suggestion.endTime }) });
        availabilityKeys.add(key);
      }

      await api("/api/booking/settings", { method: "PUT", body: JSON.stringify({ companyId, ...draft.settings }) });
      toast({ title: "Booking setup updated", description: "Suggestions were merged with the existing manual setup." });
      navigate(`/bookings/setup?companyId=${companyId}`);
    } catch (error: any) {
      toast({ title: "Could not apply suggestions", description: error.message, variant: "destructive" });
    } finally {
      setApplying(false);
    }
  }

  if (!companyId) return <div className="p-8 text-muted-foreground">Choose a company before importing its booking setup.</div>;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <button onClick={() => navigate(`/bookings/setup?companyId=${companyId}`)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-2"><ArrowLeft className="h-3.5 w-3.5" /> Back to manual booking setup</button>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><WandSparkles className="h-6 w-6 text-primary" />Import Booking Setup from AI Instructions</h1>
          <p className="text-sm text-muted-foreground mt-1">The AI reads the saved business prompt, suggests services, resources, hours and booking rules, then waits for your approval.</p>
        </div>
        <Button onClick={analyze} disabled={extracting} className="gap-2">{extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{draft ? "Analyze Again" : "Analyze AI Settings"}</Button>
      </div>

      {!draft ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center"><Sparkles className="h-10 w-10 text-primary/60 mx-auto mb-3" /><h2 className="font-semibold">Nothing will be changed automatically</h2><p className="text-sm text-muted-foreground mt-1 max-w-xl mx-auto">Analyze the AI instructions first. You can review every suggestion and continue using the manual Booking Setup page at any time.</p></div>
      ) : (
        <>
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 flex items-center justify-between gap-4"><div><div className="font-semibold">Suggestions for {draft.companyName}</div><div className="text-sm text-muted-foreground">{draft.resources.length} resources · {draft.services.length} services · {draft.availability.length} working-hour rows</div></div><Button onClick={applyDraft} disabled={applying} className="gap-2">{applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Apply and Merge</Button></div>
          {draft.warnings.length > 0 && <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4"><div className="flex items-center gap-2 font-semibold text-amber-300"><AlertTriangle className="h-4 w-4" />Review these estimates</div><ul className="mt-2 space-y-1 text-sm text-muted-foreground list-disc pl-5">{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></section>}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold mb-3">Resources</h2><div className="space-y-2">{draft.resources.map((resource, index) => <div key={index} className="rounded border border-border/70 p-3"><div className="font-medium text-sm">{resource.name}</div><div className="text-xs text-primary mt-0.5">{resource.resourceType}</div>{resource.description && <div className="text-xs text-muted-foreground mt-1">{resource.description}</div>}</div>)}</div></section>
            <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold mb-3">Services</h2><div className="space-y-2">{draft.services.map((service, index) => <div key={index} className="rounded border border-border/70 p-3"><div className="flex justify-between gap-3"><div className="font-medium text-sm">{service.name}</div><div className="text-xs text-primary whitespace-nowrap">{service.durationMinutes} min</div></div>{service.description && <div className="text-xs text-muted-foreground mt-1">{service.description}</div>}</div>)}</div></section>
            <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold mb-3">Working Hours</h2><div className="space-y-2">{draft.availability.length === 0 ? <p className="text-sm text-muted-foreground">No hours were confidently detected. Add them manually.</p> : draft.availability.map((row, index) => <div key={index} className="flex items-center justify-between rounded border border-border/70 px-3 py-2 text-sm"><span>{row.resourceName}</span><span className="text-muted-foreground">{DAYS[row.dayOfWeek]} · {row.startTime}–{row.endTime}</span></div>)}</div></section>
            <section className="rounded-lg border border-border bg-card p-5"><h2 className="font-semibold mb-3">Booking Rules</h2><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">Timezone</dt><dd>{draft.settings.timezone}</dd></div><div><dt className="text-muted-foreground">Slot interval</dt><dd>{draft.settings.slotIntervalMinutes} min</dd></div><div><dt className="text-muted-foreground">Minimum notice</dt><dd>{draft.settings.minimumNoticeMinutes} min</dd></div><div><dt className="text-muted-foreground">Advance window</dt><dd>{draft.settings.maximumAdvanceDays} days</dd></div><div><dt className="text-muted-foreground">Preferred resource</dt><dd>{draft.settings.allowResourceSelection ? "Allowed" : "Not allowed"}</dd></div><div><dt className="text-muted-foreground">Random assignment</dt><dd>{draft.settings.allowRandomAssignment ? "Allowed" : "Not allowed"}</dd></div></dl></section>
          </div>
        </>
      )}
    </div>
  );
}
