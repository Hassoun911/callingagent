import { useQuery } from "@tanstack/react-query";
import { Bot, PhoneCall, ShieldCheck } from "lucide-react";

export type ServiceRecord={
  companyId:number;companyName:string;
  businessPhone:{state:"paid"|"existing_service"|"subscription_review"|"not_assigned";paid:boolean;existingService:boolean;activeNumbers:number;assignedNumbers:number;plan:string|null};
  aiReceptionist:{state:"existing_configuration"|"not_purchased";paid:boolean;existingConfiguration:boolean;configuredNumbers:number;purchaseVerification:string};
};
export type ServiceResponse={readOnly:true;companies:ServiceRecord[]};

export function useCompanyServiceStatus(companyId?:number){
  return useQuery<ServiceResponse>({
    queryKey:["billing-service-status",companyId??"all"],
    queryFn:async()=>{
      const url="/api/billing/service-status"+(companyId?"?companyId="+encodeURIComponent(companyId):"");
      const r=await fetch(url,{credentials:"include",cache:"no-store"});
      if(!r.ok)throw Error("Unable to verify company service status");
      return r.json();
    },
    staleTime:30_000,retry:false
  });
}

export function BusinessPhoneStatus({company}:{company:ServiceRecord}){
  const status=company.businessPhone;
  return <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
    <div className="flex items-center gap-2 font-bold"><PhoneCall className="h-5 w-5 text-blue-500"/> Business Phone / VoIP</div>
    <p className="mt-2 text-sm font-semibold">
      {status.paid?"Paid plan · "+String(status.plan).replace(/-/g," "):
       status.existingService?"Existing phone service · preserved":
       status.state==="subscription_review"?"Subscription requires review":"No phone service assigned"}
    </p>
    <p className="mt-1 text-xs text-muted-foreground">{status.activeNumbers} active phone line{status.activeNumbers===1?"":"s"} · Routing and voicemail unchanged</p>
    {status.existingService&&!status.paid&&<p className="mt-2 text-xs text-muted-foreground">Existing service is not automatically changed to a new paid package.</p>}
  </div>;
}

export function AiReceptionistStatus({company}:{company:ServiceRecord}){
  const status=company.aiReceptionist;
  return <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
    <div className="flex items-center gap-2 font-bold"><Bot className="h-5 w-5 text-violet-500"/> AI Receptionist</div>
    <p className="mt-2 text-sm font-semibold">
      {status.existingConfiguration?"AI voice configured on existing line"+(status.configuredNumbers===1?"":"s"):"No separate AI plan purchased"}
    </p>
    <p className="mt-1 text-xs text-muted-foreground">{status.configuredNumbers} existing AI-answering line{status.configuredNumbers===1?"":"s"} · Separate paid AI package not verified</p>
    <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4 shrink-0"/>Existing AI voice settings remain unchanged. No new AI credits or billing are applied.</p>
  </div>;
}

/** Informational only: this panel never unlocks, revokes or changes either product. */
export default function DualServiceStatus({companyId}:{companyId:number}){
  const {data,isPending,isError}=useCompanyServiceStatus(companyId);
  const company=data?.companies.find(c=>c.companyId===companyId);
  return <section className="space-y-3">
    <div><h2 className="text-lg font-bold">Your CallingAgent services</h2><p className="text-xs text-muted-foreground">Business Phone and AI Receptionist are managed separately. Existing calling settings are preserved.</p></div>
    {isPending?<p className="text-sm text-muted-foreground">Checking company services…</p>:
    isError||!company?<p role="alert" className="text-sm text-amber-600">Service status cannot be verified. Existing phone and AI settings have not been changed.</p>:
    <div className="grid gap-3 sm:grid-cols-2"><BusinessPhoneStatus company={company}/><AiReceptionistStatus company={company}/></div>}
  </section>;
}
