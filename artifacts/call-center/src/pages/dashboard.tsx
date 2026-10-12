import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useGetDashboardStats, useGetRecentCalls, useListPhoneNumbers } from "@workspace/api-client-react";
import { Activity, ArrowDownLeft, ArrowUpRight, Building2, ChevronRight, Clock, CreditCard, MessageSquare, Phone, Plus, Users, Zap } from "lucide-react";
import { Link } from "wouter";

const BASE = import.meta.env.BASE_URL.replace(/\\/$/, "");
const money = (amount: number, currency: string) => `${currency} ${amount.toFixed(2)}`;
const displayNumber = (value: string) => {
  const digits = value.replace(/\\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? `+1 ${digits.slice(1,4)} ${digits.slice(4,7)} ${digits.slice(7)}` : value;
};
function Panel({ title, href, link, children }: { title: string; href?: string; link?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm min-w-0">
    <div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-sm sm:text-base font-semibold text-foreground">{title}</h2>
      {href && <Link href={href} className="text-xs font-medium text-primary hover:underline whitespace-nowrap">{link || "View all"} →</Link>}</div>
    {children}
  </section>;
}
export default function Dashboard() {
  const { data: stats, isLoading } = useGetDashboardStats();
  const { data: calls = [] } = useGetRecentCalls({ limit: 100 });
  const { data: numbers = [] } = useListPhoneNumbers();
  const { data: costs } = useQuery<any>({
    queryKey: ["main-admin-costs"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/costs`, {credentials:"include"}); if (!r.ok) throw Error("Costs unavailable"); return r.json(); },
    staleTime: 120000, retry: false
  });
  const { data: campaigns = [] } = useQuery<any[]>({
    queryKey: ["main-admin-campaigns"],
    queryFn: async () => { const r = await fetch(`${BASE}/api/campaigns`, {credentials:"include"}); return r.ok ? r.json() : []; },
  });
  const [period, setPeriod] = useState<7 | 30>(7);
  const recent = Array.isArray(calls) ? calls : [];
  const days = Array.from({length:period},(_,i)=> {
    const d = new Date(); d.setDate(d.getDate() - (period - 1 - i)); return d.toLocaleDateString("en-CA", {timeZone:"America/Toronto"});
  });
  const points = days.map(day => {
    const rows = recent.filter((call:any)=>new Date(call.createdAt).toLocaleDateString("en-CA",{timeZone:"America/Toronto"})===day);
    return { day, inbound: rows.filter((call:any)=>call.direction==="inbound").length, outbound:rows.filter((call:any)=>call.direction==="outbound").length };
  });
  const max = Math.max(1,...points.map(p=>p.inbound+p.outbound));
  const kpis = [
    {title:"Calls today", value:stats?.callsToday, sub:`${stats?.totalCalls ?? "—"} all-time`, Icon:Phone, tone:"text-emerald-600 bg-emerald-500/10", href:"/calls"},
    {title:"Active numbers", value:stats?.activeNumbers, sub:`${stats?.totalNumbers ?? "—"} provisioned`, Icon:Activity, tone:"text-blue-600 bg-blue-500/10", href:"/numbers"},
    {title:"CRM contacts", value:stats?.totalContacts, sub:`${stats?.totalCompanies ?? "—"} companies`, Icon:Users, tone:"text-violet-600 bg-violet-500/10", href:"/contacts"},
    {title:"Campaigns", value:campaigns.length, sub:`${campaigns.filter(c=>c.status==="active").length} active`, Icon:Zap, tone:"text-amber-600 bg-amber-500/10", href:"/campaigns"}
  ];
  return <div className="admin-overview w-full min-w-0 space-y-5 pb-12 sm:space-y-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div><h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Admin Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">All companies · live system overview</p></div>
      <div className="flex items-center gap-2">
        <Link href="/numbers" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"><Plus className="h-4 w-4"/> Buy number</Link>
        <Link href="/campaigns" className="inline-flex items-center rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground">Campaigns</Link>
      </div>
    </header>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {kpis.map(({title,value,sub,Icon,tone,href})=><Link key={title} href={href} className="min-w-0 rounded-2xl border border-border bg-card p-3.5 sm:p-5 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between gap-2"><span className="text-xs sm:text-sm font-medium text-muted-foreground">{title}</span><span className={`rounded-lg p-2 ${tone}`}><Icon className="h-4 w-4"/></span></div>
        <div className="mt-2 text-2xl sm:text-3xl font-bold text-foreground">{isLoading ? "…" : value ?? "—"}</div>
        <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
      </Link>)}
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
      <Panel title="Call Activity" href="/calls" link="Call logs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-4 text-xs text-muted-foreground"><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-blue-500"/>Inbound</span><span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-emerald-500"/>Outbound</span></div>
          <div className="flex rounded-lg bg-secondary p-1 text-xs">{([7,30] as const).map(n=><button key={n} onClick={()=>setPeriod(n)} className={`rounded-md px-3 py-1.5 ${period===n?"bg-card text-foreground shadow-sm":"text-muted-foreground"}`}>{n} days</button>)}</div>
        </div>
        <div className="flex h-44 items-end gap-1.5 border-b border-border pt-3 sm:h-52">
          {points.map(p=><div key={p.day} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-0.5" title={`${p.day}: ${p.inbound} inbound, ${p.outbound} outbound`}>
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm" style={{height:`${Math.max(2,(p.inbound+p.outbound)/max*100)}%`}}>
              {p.outbound>0&&<div className="w-full bg-emerald-500/75" style={{flex:p.outbound}}/>}
              {p.inbound>0&&<div className="w-full bg-blue-500/75" style={{flex:p.inbound}}/>}
              {p.inbound+p.outbound===0&&<div className="h-0.5 bg-secondary"/>}
            </div>
          </div>)}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>{days[0]}</span><span>{days[days.length-1]}</span></div>
        <p className="mt-3 text-[11px] text-muted-foreground">Based on the most recent {recent.length} call records. Historical totals may be incomplete.</p>
      </Panel>
      <Panel title="Provider Costs" href="/billing" link="Billing details">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-4"><div><div className="text-sm font-semibold text-foreground">Twilio</div><div className="text-xs text-muted-foreground">Current billing period</div></div>
          <div className="text-right font-semibold text-foreground">{costs?.twilio?.available ? money(Number(costs.twilio.totalCost),costs.twilio.currency||"USD") : "Unavailable"}</div></div>
          <div className="flex items-center justify-between gap-3 border-b border-border pb-4"><div><div className="text-sm font-semibold text-foreground">Telnyx</div><div className="text-xs text-muted-foreground">Billing integration pending</div></div><div className="text-sm text-muted-foreground">Unverified</div></div>
          <div className="flex items-center justify-between gap-3"><span className="font-semibold text-foreground">Combined total</span><span className="font-semibold text-muted-foreground">Pending</span></div>
          <p className="text-xs text-muted-foreground">Only provider-verified charges are displayed; no fabricated costs.</p>
        </div>
      </Panel>
    </div>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
      <Panel title="Recent Calls" href="/calls">
        <div className="space-y-1">{recent.length ? recent.slice(0,5).map((call:any)=><Link key={call.id} href="/calls" className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-secondary/60">
          <span className={`rounded-lg p-2 ${call.direction==="inbound"?"bg-emerald-500/10 text-emerald-600":"bg-blue-500/10 text-blue-600"}`}>{call.direction==="inbound"?<ArrowDownLeft className="h-4 w-4"/>:<ArrowUpRight className="h-4 w-4"/>}</span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{call.campaignContactName || call.callerName || call.contactName || displayNumber(call.direction==="inbound"?call.fromNumber||"":call.toNumber||"")}</p>
          <p className="truncate text-xs text-muted-foreground">{displayNumber(call.direction==="inbound"?call.fromNumber||"":call.toNumber||"")}</p></div>
          <div className="shrink-0 text-right text-xs text-muted-foreground">{new Date(call.createdAt).toLocaleDateString("en-CA",{month:"short",day:"numeric"})}<div>{call.duration ? `${Math.floor(call.duration/60)}:${String(call.duration%60).padStart(2,"0")}`:"—"}</div></div>
        </Link>) : <p className="py-10 text-center text-sm text-muted-foreground">No recent calls</p>}</div>
      </Panel>
      <Panel title="Quick Actions">
        <div className="grid grid-cols-1 gap-2">
          {[
            {href:"/numbers",name:"Search & Buy Numbers",Icon:Phone},
            {href:"/contacts",name:"Manage Contacts",Icon:Users},
            {href:"/campaigns",name:"Manage Campaigns",Icon:Zap},
            {href:"/companies",name:"All Companies",Icon:Building2},
            {href:"/messages",name:"SMS Inbox",Icon:MessageSquare},
            {href:"/billing",name:"Billing & Costs",Icon:CreditCard},
          ].map(({href,name,Icon})=><Link key={href} href={href} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-secondary/60"><Icon className="h-4 w-4 text-primary"/><span className="flex-1 text-sm font-medium text-foreground">{name}</span><ChevronRight className="h-4 w-4 text-muted-foreground"/></Link>)}
        </div>
      </Panel>
    </div>
    <Panel title="Active Numbers" href="/numbers" link="Manage all">
      <div className="w-full overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs sm:text-sm"><thead className="border-b border-border text-muted-foreground"><tr><th className="py-2.5 font-medium">Number</th><th className="py-2.5 font-medium">Company</th><th className="py-2.5 font-medium">Provider</th><th className="py-2.5 font-medium">Status</th></tr></thead>
      <tbody>{numbers.filter((n:any)=>n.isActive).slice(0,8).map((n:any)=><tr key={n.id} className="border-b border-border/60 last:border-0"><td className="py-3 font-medium text-foreground">{displayNumber(n.number)}</td><td className="py-3 text-muted-foreground">{n.companyId ? `Company #${n.companyId}`:"Unassigned"}</td><td className="py-3 text-muted-foreground">{n.twilioSid?"Twilio":"Unverified"}</td><td className="py-3"><span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600">Active</span></td></tr>)}</tbody></table>
      {!numbers.length&&<p className="py-7 text-center text-sm text-muted-foreground">No provisioned numbers</p>}</div>
    </Panel>
  </div>;
}
