import { useEffect, useState } from "react";
import { Plus, Save, Trash2, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";
import AiMarginSimulator from "@/components/ai-margin-simulator";

type Plan={id:number;slug:string;name:string;priceCents:number;monthlyMinutes:number;includedNumbers:number;features:string[];description:string;isPublished:boolean;isEnabled:boolean;checkoutEnabled:boolean;sortOrder:number};
type BillingReadiness={stripePriceVerificationIssues?:string[];telnyxCallCostWebhookEnabled:boolean|null;telnyxVoiceWebhookCorrect:boolean|null;telnyxConfigurationWarning:string|null;liveStripePricesMapped:boolean;secretKeyConfigured:boolean;liveKeyFormatValid:boolean;liveMerchantVerified:boolean;merchantVerificationWarning:string|null;webhookSecretConfigured:boolean;entitlementEnforcementCertified:boolean;globalCheckoutApproved:boolean;checkoutEnabled:boolean;carrierUsageVerified:boolean;automaticProvisioningCertified:boolean;productionSnapshot:{existingCompanies:number;subscriptionsRecorded:number;activePhoneLines:number;activeTwilioLines:number;activeUnattributedLines:number;currentMonthCallRecords:number;currentMonthCallsMissingDuration:number;callDurationCoverage?:{total:number;measured:number;missing:number;missingWithTwilioSid:number;missingWithoutTwilioSid:number;missingTerminal:number;missingNonterminal:number};telnyxCarrierEvidence?:{costLegs:number;measuredLegs:number;missingLegDurations:number;unattributedLegs:number;attributedMeasuredLegs:number}};plans:{slug:string;checkoutEnabled:boolean}[]};
type LaunchInterest={id:number;plan_slug:string;contact_name:string;email:string;phone:string|null;company_name:string|null;created_at:string;sales_status:"new"|"contacted"|"qualified"|"closed_won"|"closed_lost";sales_notes:string;sales_updated_at:string|null};
type FulfillmentItem={company_id:number;company_name:string;plan_slug:string;fulfillment_status:string;created_at:string;subscription_status:string|null;last_payment_status:string|null;active_numbers:number;included_numbers:number|null};
type LaunchAudit={merchantVerified:boolean;liveStripePricesVerified:boolean;checkoutEnabled:boolean;plans:{slug:string;amountMatchesStripeMapping:boolean;stripePriceVerified:boolean;monthlyMinutes:number;includedNumbers:number;checkoutApproved:boolean}[];metrics:{subscriptions:number;checkout_intents:number;telnyx_cost_legs:number;monthly_calls:number;missing_call_durations:number};issues:string[];verdict:string;chargeAttempted:boolean;phoneProvisioningAttempted:boolean};
const featureNames:Record<string,string>={numbers:"Phone numbers",forwarding:"Call forwarding",voicemail:"Voicemail",email_alerts:"Email alerts",call_logs:"Call logs",extensions:"Extensions",ai_receptionist:"AI receptionist",sms:"SMS",appointments:"Appointments"};
const empty:Plan={id:0,slug:"",name:"",priceCents:0,monthlyMinutes:0,includedNumbers:1,features:["numbers"],description:"",isPublished:false,isEnabled:false,checkoutEnabled:false,sortOrder:10};
export default function PlanManagement(){
 const [plans,setPlans]=useState<Plan[]>([]);
 const [editing,setEditing]=useState<Plan|null>(null);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [busy,setBusy]=useState(false);
 const [readiness,setReadiness]=useState<BillingReadiness|null>(null);
 const [readinessError,setReadinessError]=useState("");
 const [readinessLoading,setReadinessLoading]=useState(false);
 const [readinessCheckedAt,setReadinessCheckedAt]=useState("");
 const [readinessMessage,setReadinessMessage]=useState("");
 const [durationRepairBusy,setDurationRepairBusy]=useState(false);
 const [durationRepairReport,setDurationRepairReport]=useState("");

 const [launchAudit,setLaunchAudit]=useState<LaunchAudit|null>(null);
 const [launchAuditError,setLaunchAuditError]=useState("");
 const [launchAuditBusy,setLaunchAuditBusy]=useState(false);
 const [fulfillmentQueue,setFulfillmentQueue]=useState<FulfillmentItem[]|null>(null);
 const [queueBusy,setQueueBusy]=useState(false);
 const [queueError,setQueueError]=useState("");
 const [interestRequests,setInterestRequests]=useState<LaunchInterest[]|null>(null);
 const [interestBusy,setInterestBusy]=useState(false);
 const [interestError,setInterestError]=useState("");
 const [interestSaving,setInterestSaving]=useState<number|null>(null);
 const [leadNoteDrafts,setLeadNoteDrafts]=useState<Record<number,string>>({});
 async function saveLeadStatus(item:LaunchInterest,status:LaunchInterest["sales_status"]){
   setInterestSaving(item.id);setInterestError("");
   try{
     const response=await fetch("/api/admin/launch-interest/"+item.id,{
       method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({status,notes:leadNoteDrafts[item.id]??item.sales_notes??""})
     });
     const data=await response.json();
     if(!response.ok||!data.lead)throw Error(data.error||"Unable to save follow-up");
     setInterestRequests(prev=>prev?.map(x=>x.id===item.id?data.lead:x)??null);
   }catch(e:any){setInterestError(e?.message||"Could not save lead");}
   finally{setInterestSaving(null);}
 }

 async function loadInterestRequests(){
   setInterestBusy(true);setInterestError("");
   try {
     const response=await fetch("/api/admin/launch-interest",{credentials:"include",cache:"no-store"});
     const data=await response.json();
     if(!response.ok||!Array.isArray(data.requests))throw Error(data.error||"Inquiries unavailable");
     setInterestRequests(data.requests);
   }catch(e:any){setInterestError(e?.message||"Could not load inquiries");}
   finally{setInterestBusy(false);}
 }
 async function loadFulfillmentQueue(){
  setQueueBusy(true);setQueueError("");
  try{
    const response=await fetch("/api/billing/fulfillment-queue",{credentials:"include",cache:"no-store"});
    const body=await response.json();
    if(!response.ok||!Array.isArray(body.items))throw Error(body.error||"Fulfillment queue unavailable");
    setFulfillmentQueue(body.items);
  }catch(e:any){setQueueError(e?.message||"Could not load queue");}
  finally{setQueueBusy(false);}
 }
 async function runLaunchAudit(){
  setLaunchAuditBusy(true);setLaunchAuditError("");
  try {
    const response=await fetch("/api/billing/launch-audit",{credentials:"include",cache:"no-store"});
    const body=await response.json();
    if(!response.ok||!Array.isArray(body.issues))throw Error(body.error||"Launch audit failed");
    setLaunchAudit(body);
  }catch(e:any){setLaunchAuditError(e?.message||"Launch audit unavailable");}
  finally{setLaunchAuditBusy(false);}
 }
 async function loadReadiness(){
  setReadinessLoading(true);setReadinessMessage("");
  try{
   const r=await fetch("/api/billing/readiness",{credentials:"include",cache:"no-store",headers:{"Accept":"application/json"}});
   if(!r.ok){
     let detail="";
     try{const body=await r.json();detail=String(body.error||"");}catch{}
     throw Error(detail||("Readiness check failed (HTTP "+r.status+")"));
   }
   const data=await r.json();
   if(typeof data.checkoutEnabled!=="boolean" || !Array.isArray(data.plans))throw Error("Unexpected billing readiness response");
   setReadiness(data);setReadinessError("");
   setReadinessCheckedAt(new Date().toLocaleTimeString());
   setReadinessMessage(data.checkoutEnabled
     ? "Check completed. Checkout prerequisites are enabled."
     : "Check completed. The configuration is unchanged; checkout remains disabled until pending requirements are completed.");
  }catch(e:any){
   setReadinessError(e?.message||"Readiness check failed. Please retry.");
   setReadinessMessage("");
  }finally{setReadinessLoading(false)}
 }
 async function repairTwilioDurations(){
   setDurationRepairBusy(true);setDurationRepairReport("");
   try{
     const r=await fetch("/api/billing/reconcile-twilio-durations",{
       method:"POST",credentials:"include",headers:{"Accept":"application/json","Content-Type":"application/json"},body:"{}"
     });
     const data=await r.json();
     if(!r.ok)throw Error(data.error||"Reconciliation failed");
     setDurationRepairReport(`Checked ${data.fetched} terminal Twilio call records, restored ${data.repaired} measured durations, unavailable ${data.unavailable}, lookup errors ${data.errors}. ${data.moreCandidatesPossible?"Another batch may remain.":""} No billing or phone operations were changed.`);
     await loadReadiness();
   }catch(e:any){setDurationRepairReport(e?.message||"Reconciliation unavailable");}
   finally{setDurationRepairBusy(false)}
 }
 async function load(){try{const r=await fetch("/api/admin/plans",{credentials:"include"});const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to fetch plans");setPlans(j);}catch(e:any){setError(e.message)}}
 useEffect(()=>{void load();void loadReadiness();void loadInterestRequests()},[]);
 async function save(plan:Plan){
  setBusy(true);setError("");setNotice("");
  try {
   const r=await fetch(plan.id?"/api/admin/plans/"+plan.id:"/api/admin/plans",{method:plan.id?"PATCH":"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(plan)});
   const j=await r.json();if(!r.ok)throw Error(j.error||"Unable to save plan");
   setEditing(null);setNotice("Plan saved. Public catalog will reflect enabled, published plans.");await load();
  }catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 async function remove(plan:Plan){
  if(!window.confirm("Permanently delete "+plan.name+"? Disable the plan instead if it has customers."))return;
  setBusy(true);setError("");
  try{const r=await fetch("/api/admin/plans/"+plan.id,{method:"DELETE",credentials:"include"});const j=await r.json();if(!r.ok)throw Error(j.error||"Could not delete");setEditing(null);await load();}
  catch(e:any){setError(e.message)}finally{setBusy(false)}
 }
 return <div className="space-y-6">
   <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-3xl font-bold">Package Manager</h1><p className="mt-1 text-sm text-muted-foreground">Create, edit, publish, disable, or remove CallingAgent packages.</p></div><button onClick={()=>setEditing({...empty})} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4"/>New plan</button></div>
   <AiMarginSimulator />
   <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
     <div className="flex items-center gap-2 font-bold"><AlertTriangle className="h-5 w-5 shrink-0"/>Live billing readiness</div>
     <p className="mt-2">Publishing a package does not activate customer checkout. Carrier usage and automatic provisioning must be independently certified before live payments are allowed.</p>
     {readiness && <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {([["Stripe prices mapped",readiness.liveStripePricesMapped],["Live API key & merchant verified",readiness.secretKeyConfigured&&readiness.liveKeyFormatValid&&readiness.liveMerchantVerified],["Stripe webhook signing secret",readiness.webhookSecretConfigured],["Entitlement enforcement certified",readiness.entitlementEnforcementCertified],["Global checkout approved",readiness.globalCheckoutApproved],["Customer checkout operational",readiness.checkoutEnabled]] as [string,boolean][]).map(([label,ok])=><div key={label} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 p-2"><span>{label}</span><span className={ok?"font-bold text-emerald-700":"font-bold text-amber-800"}>{ok?"Ready":"Pending"}</span></div>)}
     </div>}
     {readiness&&<div className="mt-3 rounded-lg border border-amber-200 bg-white/80 p-3">
      <p className="font-semibold">Production inventory (read-only)</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <span>Companies: <strong>{readiness.productionSnapshot?.existingCompanies??"—"}</strong></span>
        <span>Active lines: <strong>{readiness.productionSnapshot?.activePhoneLines??"—"}</strong></span>
        <span>Stripe subscriptions: <strong>{readiness.productionSnapshot?.subscriptionsRecorded??"—"}</strong></span>
      </div>
      <p className="mt-2 text-xs">Carrier usage metering: <strong>{readiness.carrierUsageVerified?"Verified":"Not certified"}</strong>. Automatic provisioning: <strong>{readiness.automaticProvisioningCertified?"Verified":"Not certified"}</strong>. These checks do not change existing phone service.</p>
      <p className="mt-2 text-xs">Carrier coverage: <strong>{readiness.productionSnapshot?.activeTwilioLines ?? "—"} Twilio</strong> and <strong>{readiness.productionSnapshot?.activeUnattributedLines ?? "—"} not linked to Twilio</strong>. Current UTC month: <strong>{readiness.productionSnapshot?.currentMonthCallsMissingDuration ?? "—"}/{readiness.productionSnapshot?.currentMonthCallRecords ?? "—"}</strong> call records missing measured duration.</p>
      <p className="mt-2 text-xs">Telnyx call-cost events: <strong>{readiness.telnyxCallCostWebhookEnabled===true?"Enabled":readiness.telnyxCallCostWebhookEnabled===false?"Disabled":"Not verified"}</strong>. Telnyx voice webhook URL: <strong>{readiness.telnyxVoiceWebhookCorrect===true?"Matches CallingAgent":readiness.telnyxVoiceWebhookCorrect===false?"Review configuration":"Not verified"}</strong>.</p>
      {readiness.telnyxConfigurationWarning&&<p className="mt-1 text-xs text-amber-900">{readiness.telnyxConfigurationWarning}</p>}
      <div className="mt-4 rounded-xl border border-orange-200 bg-white p-3 text-slate-900">
        <h3 className="text-base font-black">Carrier usage evidence · current UTC month</h3>
        <p className="mt-1 text-xs text-slate-600">Read-only diagnostics. A missing call-log duration is not a zero-minute call. Provider event records and internal call logs are separate sources and their counts should not be added together.</p>
        {readiness.productionSnapshot?.callDurationCoverage&&<div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="font-semibold">Internal call-log coverage</p>
            <p className="mt-2 text-xs">Measured: <strong>{readiness.productionSnapshot.callDurationCoverage.measured}</strong> of <strong>{readiness.productionSnapshot.callDurationCoverage.total}</strong></p>
            <p className="mt-1 text-xs">Missing with Twilio Call SID: <strong>{readiness.productionSnapshot.callDurationCoverage.missingWithTwilioSid}</strong></p>
            <p className="mt-1 text-xs">Missing without Twilio Call SID: <strong>{readiness.productionSnapshot.callDurationCoverage.missingWithoutTwilioSid}</strong></p>
            <p className="mt-1 text-xs">Terminal status, duration missing: <strong>{readiness.productionSnapshot.callDurationCoverage.missingTerminal}</strong></p>
            <p className="mt-1 text-xs">Other or unknown status, duration missing: <strong>{readiness.productionSnapshot.callDurationCoverage.missingNonterminal}</strong></p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="font-semibold">Telnyx signed call-cost event coverage</p>
            <p className="mt-2 text-xs">Carrier cost-leg events: <strong>{readiness.productionSnapshot.telnyxCarrierEvidence?.costLegs??"—"}</strong></p>
            <p className="mt-1 text-xs">Events with billed duration: <strong>{readiness.productionSnapshot.telnyxCarrierEvidence?.measuredLegs??"—"}</strong></p>
            <p className="mt-1 text-xs">Events missing billed duration: <strong>{readiness.productionSnapshot.telnyxCarrierEvidence?.missingLegDurations??"—"}</strong></p>
            <p className="mt-1 text-xs">Events without company attribution: <strong>{readiness.productionSnapshot.telnyxCarrierEvidence?.unattributedLegs??"—"}</strong></p>
            <p className="mt-1 text-xs">Attributed events with duration: <strong>{readiness.productionSnapshot.telnyxCarrierEvidence?.attributedMeasuredLegs??"—"}</strong></p>
          </div>
        </div>}
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-sm font-bold text-blue-950">Repair known Twilio durations</p>
          <p className="mt-1 text-xs leading-5 text-blue-950">Look up up to 15 recent terminal calls using Twilio and copy exact carrier-reported parent-call seconds into missing internal records. Does not alter active lines, forwarding, billing, AI minute balances, or Telnyx records. Repeat only when necessary.</p>
          <button type="button" disabled={durationRepairBusy} onClick={()=>void repairTwilioDurations()} className="mt-3 min-h-11 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{durationRepairBusy?"Checking Twilio…":"Reconcile up to 15 Twilio calls"}</button>
          {durationRepairReport&&<p role="status" className="mt-2 text-xs font-semibold text-blue-950">{durationRepairReport}</p>}
        </div>
        <p className="mt-3 text-xs font-semibold text-amber-900">Next checks: verify terminal Twilio callbacks and their matching call SIDs; reconcile Telnyx cost legs to companies; validate historical carrier CDRs and forwarding legs before enabling minute caps, customer charges or subscriptions.</p>
      </div>

      {readiness.telnyxCallCostWebhookEnabled===false&&<p className="mt-2 text-xs">Enable “Call Cost Webhook Event” under the existing Voice API application in <a href="https://portal.telnyx.com/" target="_blank" rel="noreferrer" className="underline">Telnyx Mission Control</a>. Do not change its voice webhook URL or routing.</p>}
     </div>}
     {readiness?.merchantVerificationWarning&&<p className="mt-3 text-xs text-red-700" role="status">{readiness.merchantVerificationWarning}</p>}
     {readiness?.stripePriceVerificationIssues?.length? <p role="alert" className="mt-2 text-xs text-red-700">Stripe price verification: {readiness.stripePriceVerificationIssues.join("; ")}</p> : null}
     {readinessError&&<p role="alert" className="mt-3 text-red-700">{readinessError}</p>}
     <button type="button" disabled={readinessLoading} aria-busy={readinessLoading} onClick={()=>void loadReadiness()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-2 font-semibold disabled:cursor-wait disabled:opacity-60"><RefreshCw className={readinessLoading?"h-4 w-4 animate-spin":"h-4 w-4"}/>{readinessLoading?"Checking readiness…":"Recheck readiness"}</button>
     <p className="mt-2 text-xs text-amber-950" role="status" aria-live="polite">{readinessLoading?"Contacting the billing server…":readinessMessage}{readinessCheckedAt&&!readinessLoading?" Last checked: "+readinessCheckedAt+" (your local time).":""}</p>
     <div className="mt-4 border-t border-amber-200 pt-3">
      <button type="button" disabled={launchAuditBusy} onClick={()=>void runLaunchAudit()} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-60">{launchAuditBusy?"Auditing live billing…":"Run full launch audit (no charges)"}</button>
      {launchAuditError&&<p className="mt-2 text-xs text-red-700" role="alert">{launchAuditError}</p>}
      <button type="button" disabled={queueBusy} onClick={()=>void loadFulfillmentQueue()} className="ml-2 mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-60">{queueBusy?"Checking fulfillment…":"Review paid-customer provisioning queue"}</button>
      {queueError&&<p role="alert" className="mt-2 text-xs text-red-700">{queueError}</p>}
      <button type="button" disabled={interestBusy} onClick={()=>void loadInterestRequests()} className="ml-2 mt-2 rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-semibold disabled:opacity-60">{interestBusy?"Loading inquiries…":"View package inquiries"}</button>
      {interestError&&<p role="alert" className="mt-2 text-xs text-red-700">{interestError}</p>}
      {interestRequests&&<div className="mt-2 rounded-lg border border-blue-200 bg-white p-3">
        <p className="text-sm font-semibold">CallingAgent sales inbox · {interestRequests.length} recent inquiries</p>
        <p className="mt-1 text-xs text-slate-600">Follow up manually while checkout is under certification. “Closed won” tracks a conversation, not a Stripe payment.</p>
        {interestRequests.length===0?<p className="mt-2 text-xs">No inquiries yet. Share <a className="text-blue-700 underline" href="https://callingagent.ca/#pricing" target="_blank" rel="noreferrer">Business Phone plans</a> and <a className="text-blue-700 underline" href="https://callingagent.ca/#ai-inquiry" target="_blank" rel="noreferrer">AI Receptionist early access</a>.</p>:
        <div className="mt-3 max-h-[560px] space-y-3 overflow-auto">
          {interestRequests.map(item=><div key={item.id} className="rounded-lg border border-slate-200 p-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><strong className="text-sm">{item.contact_name}</strong> · {item.plan_slug}<p className="mt-1 text-slate-600">{item.company_name||"Business not specified"} · {new Date(item.created_at).toLocaleString()}</p></div>
              <label className="text-xs font-semibold">Follow-up
                <select aria-label={"Follow-up status for "+item.contact_name} disabled={interestSaving===item.id} value={item.sales_status} onChange={e=>void saveLeadStatus(item,e.target.value as LaunchInterest["sales_status"])} className="ml-2 rounded border bg-white p-2 text-slate-900">
                  <option value="new">New</option><option value="contacted">Contacted</option><option value="qualified">Qualified</option><option value="closed_won">Closed — won</option><option value="closed_lost">Closed — lost</option>
                </select>
              </label>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2"><a className="font-semibold text-blue-700 underline" href={"mailto:"+item.email}>{item.email}</a>{item.phone&&<a className="font-semibold text-blue-700 underline" href={"tel:"+item.phone}>{item.phone}</a>}</div>
            <label className="mt-3 block font-semibold">Follow-up notes
              <textarea maxLength={1500} rows={2} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" value={leadNoteDrafts[item.id]??item.sales_notes??""} onChange={e=>setLeadNoteDrafts(prev=>({...prev,[item.id]:e.target.value}))}/>
            </label>
            <button type="button" disabled={interestSaving===item.id} onClick={()=>void saveLeadStatus(item,item.sales_status)} className="mt-2 rounded bg-blue-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{interestSaving===item.id?"Saving…":"Save notes"}</button>
          </div>)}
        </div>}
      </div>}
      {fulfillmentQueue&&<div className="mt-2 rounded-lg bg-white/90 p-3">
       <p className="text-sm font-semibold">Verified paid subscriptions awaiting operator review ({fulfillmentQueue.length})</p>
       <p className="mt-1 text-xs">Read-only queue. This page does not purchase numbers or suspend service.</p>
       {fulfillmentQueue.length===0?<p className="mt-2 text-xs">No paid subscriptions require provisioning review.</p>:
       <div className="mt-2 space-y-2">{fulfillmentQueue.map(item=><div key={item.company_id+":"+item.created_at} className="rounded border p-2 text-xs"><strong>{item.company_name}</strong> · {item.plan_slug} · {item.fulfillment_status}<p>Stripe: {item.subscription_status||"Unknown"} · Payment: {item.last_payment_status||"Unknown"} · Active numbers: {item.active_numbers}/{item.included_numbers??"—"}</p></div>)}</div>}
      </div>}
      {launchAudit&&<div className="mt-3 rounded-lg bg-white/90 p-3 text-sm">
       <p className="font-semibold">Live Stripe checkout: {launchAudit.checkoutEnabled?"Enabled":"Disabled"} · Merchant: {launchAudit.merchantVerified?"Verified":"Not verified"}</p>
       <p className="mt-1 text-xs">This audit cannot charge a card or purchase a phone number.</p>
       <div className="mt-2 grid gap-1 sm:grid-cols-2">{launchAudit.plans.map(plan=><p key={plan.slug} className="text-xs">{plan.slug}: {plan.amountMatchesStripeMapping&&plan.stripePriceVerified?"Stripe price verified":"Price needs attention"} · {plan.includedNumbers} numbers · {plan.monthlyMinutes} minutes</p>)}</div>
       <p className="mt-3 font-semibold">Launch blockers ({launchAudit.issues.length})</p>
       <ul className="mt-1 list-inside list-disc space-y-1 text-xs">{launchAudit.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul>
      </div>}
     </div>
   </div>
   {error&&<div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</div>}
   {notice&&<div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
   <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{plans.map(p=><div key={p.id} className="space-y-3 rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-start justify-between gap-2"><div><h2 className="text-lg font-bold">{p.name}</h2><p className="text-xs text-muted-foreground">{p.slug}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${p.isEnabled&&p.isPublished?"bg-emerald-50 text-emerald-700":"bg-slate-100 text-slate-600"}`}>{p.isEnabled&&p.isPublished?"Visible":"Hidden"}</span></div><div className="text-2xl font-bold">CA${(p.priceCents/100).toFixed(2)}<span className="text-xs font-normal text-muted-foreground"> / month</span></div><div className="text-sm">{p.monthlyMinutes.toLocaleString()} minutes · {p.includedNumbers} numbers</div><div className="flex flex-wrap gap-1">{p.features.map(f=><span key={f} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{featureNames[f]||f}</span>)}</div><div className="flex gap-2"><button onClick={()=>setEditing({...p})} className="rounded-lg border px-4 py-2 text-sm font-semibold">Edit & restrictions</button><button title="Delete plan" aria-label={"Delete "+p.name} onClick={()=>remove(p)} className="rounded-lg border p-2 text-red-600"><Trash2 className="h-4 w-4"/></button></div></div>)}</div>
   {editing&&<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-3" onClick={()=>!busy&&setEditing(null)}><div onClick={e=>e.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-background p-5 shadow-2xl sm:p-7"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">{editing.id?"Edit package":"Create package"}</h2><button className="text-sm" onClick={()=>setEditing(null)}>Close ✕</button></div><div className="mt-5 grid gap-4 sm:grid-cols-2">{([{k:"name",label:"Name",type:"text"},{k:"slug",label:"Unique plan ID",type:"text"},{k:"priceCents",label:"Monthly price in cents (CAD)",type:"number"},{k:"monthlyMinutes",label:"Monthly billable minutes",type:"number"},{k:"includedNumbers",label:"Included phone numbers",type:"number"},{k:"sortOrder",label:"Display order",type:"number"}] as const).map(f=><label key={f.k} className="flex flex-col gap-1 text-sm font-semibold">{f.label}<input type={f.type} value={editing[f.k]} onChange={e=>setEditing({...editing,[f.k]:f.type==="number"?Number(e.target.value):e.target.value})} className="rounded-lg border bg-background p-2.5 font-normal"/></label>)}</div><label className="mt-4 flex flex-col gap-1 text-sm font-semibold">Short description<textarea value={editing.description} onChange={e=>setEditing({...editing,description:e.target.value})} className="rounded-lg border bg-background p-3 font-normal"/></label><h3 className="mt-5 font-bold">Feature permissions</h3><div className="mt-3 grid gap-3 sm:grid-cols-2">{Object.entries(featureNames).map(([id,label])=><label key={id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.features.includes(id)} onChange={e=>setEditing({...editing,features:e.target.checked?[...editing.features,id]:editing.features.filter(f=>f!==id)})}/>{label}</label>)}</div><h3 className="mt-5 font-bold">Availability controls</h3><div className="mt-3 space-y-2"><label className="flex gap-2 text-sm"><input type="checkbox" checked={editing.isEnabled} onChange={e=>setEditing({...editing,isEnabled:e.target.checked})}/>Enable plan</label><label className="flex gap-2 text-sm"><input type="checkbox" checked={editing.isPublished} onChange={e=>setEditing({...editing,isPublished:e.target.checked})}/>Show on public pricing page</label><div className="rounded-lg bg-slate-100 p-3 text-xs text-slate-700">Checkout cannot be enabled until payment, subscriptions and hard-cap enforcement pass launch testing.</div></div><button disabled={busy} onClick={()=>save(editing)} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"><Save className="h-4 w-4"/>Save package</button></div></div>}
 </div>
}
