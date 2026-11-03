import { useEffect, useState } from "react";
import { CreditCard, RefreshCw, ExternalLink, AlertTriangle } from "lucide-react";

type BillingStatus = {
  subscription: null | {
    plan: string; status: string; currentPeriodEnd: string|null;
    updatedAt: string; lastPaymentStatus: string|null; lastPaymentAt: string|null;
  };
  planLimits?: { includedMonthlyMinutes:number; includedNumbers:number; features:string[] } | null;
  checkoutEnabled:boolean;
};
type EntitlementReport = {
  billingType:"stripe"|"legacy_unassigned";
  numbers:{assigned:number;active:number;included:number|null;withinAllowance:boolean|null};
  internalLogEstimate?:{callRecords:number;callsWithMissingDuration:number;roundedCallMinutes:number};
  carrierUsageVerified:boolean; automaticProvisioningCertified:boolean;
};

export default function CompanySubscriptionBilling({ isAdmin }:{isAdmin:boolean}) {
  const [status,setStatus]=useState<BillingStatus|null>(null);
  const [audit,setAudit]=useState<EntitlementReport|null>(null);
  const [loading,setLoading]=useState(true);
  const [opening,setOpening]=useState(false);
  const [error,setError]=useState("");
  async function refresh(){
    setLoading(true);setError("");
    try{
      const [statusResponse,auditResponse]=await Promise.all([
        fetch("/api/billing/status",{credentials:"include",cache:"no-store"}),
        fetch("/api/billing/entitlements",{credentials:"include",cache:"no-store"})
      ]);
      if(!statusResponse.ok||!auditResponse.ok)throw Error("Your subscription details could not be loaded.");
      setStatus(await statusResponse.json());
      setAudit(await auditResponse.json());
    }catch(e:any){setError(e.message||"Billing temporarily unavailable");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh()},[]);
  async function openPortal(){
    if(!isAdmin||opening)return;
    setOpening(true);setError("");
    try{
      const response=await fetch("/api/billing/portal",{method:"POST",credentials:"include"});
      const body=await response.json();
      if(!response.ok||typeof body.url!=="string")throw Error(body.error||"Customer portal unavailable");
      const destination=new URL(body.url);
      if(destination.protocol!=="https:"||!destination.hostname.endsWith(".stripe.com"))throw Error("Unexpected billing destination");
      window.location.assign(destination.href);
    }catch(e:any){setError(e.message||"Could not open billing portal");setOpening(false);}
  }
  const subscription=status?.subscription;
  const limits=status?.planLimits;
  return <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><CreditCard className="h-6 w-6"/>Subscription & billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review your company's billing status, invoices, and plan allowances.</p></div>
      <button type="button" onClick={()=>void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"><RefreshCw className={loading?"h-4 w-4 animate-spin":"h-4 w-4"}/>{loading?"Checking…":"Refresh"}</button>
    </header>
    {error&&<div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
    {!loading&&status&&audit&&<div className="grid gap-4 sm:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subscription</p>
        {subscription?<><h2 className="mt-3 text-2xl font-bold capitalize">{subscription.plan.replace(/-/g," ")}</h2>
          <p className="mt-1 text-sm">Stripe status: <strong className="capitalize">{subscription.status}</strong></p>
          {subscription.currentPeriodEnd&&<p className="mt-1 text-sm text-muted-foreground">Current period ends {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>}
          {subscription.lastPaymentStatus&&<p className="mt-1 text-sm">Last payment: {subscription.lastPaymentStatus}</p>}
          {isAdmin&&<button type="button" disabled={opening} onClick={()=>void openPortal()} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{opening?"Opening Stripe…":"Manage invoices & payment method"}<ExternalLink className="h-4 w-4"/></button>}
        </>:<><h2 className="mt-3 text-xl font-bold">No Stripe subscription assigned</h2>
          <p className="mt-2 text-sm text-muted-foreground">Existing company phone service remains unchanged. A paid package is not automatically assigned.</p></>}
      </section>
      <section className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone line allowances</p>
        <p className="mt-3 text-2xl font-bold">{audit.numbers.assigned} assigned <span className="text-base font-normal text-muted-foreground">/ {audit.numbers.included??"legacy"} allowed</span></p>
        <p className="mt-2 text-sm text-muted-foreground">{audit.numbers.active} active lines</p>
        {limits&&<p className="mt-2 text-sm">Included monthly minutes: <strong>{limits.includedMonthlyMinutes.toLocaleString()}</strong></p>}
        <p className="mt-3 text-xs text-muted-foreground">Package limits are not the same as verified remaining billable minutes.</p>
      </section>
    </div>}
    {audit&&<section className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
      <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4"/>Carrier usage is not certified</div>
      <p className="mt-1">The current internal log estimate may exclude forwarded carrier legs or calls without recorded duration. It is not an invoice or an enforceable remaining-minute balance.</p>
      {audit.internalLogEstimate&&<p className="mt-2 text-xs">This UTC month: {audit.internalLogEstimate.callRecords} call records, {audit.internalLogEstimate.callsWithMissingDuration} with missing duration.</p>}
    </section>}
  </div>;
}
