import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck } from "lucide-react";

const allowedPlans = new Set(["payg","starter","business","plus","pro"]);

export default function CompanySignup() {
  const planParam=new URLSearchParams(window.location.search).get("plan")||"";
  const plan=allowedPlans.has(planParam)?planParam:"starter";
  const loginUrl="/login?next="+encodeURIComponent("/start?plan="+plan);
  const [enabled,setEnabled]=useState<boolean|null>(null);
  const [step,setStep]=useState<"details"|"verify"|"complete">("details");
  const [companyName,setCompanyName]=useState("");
  const [contactName,setContactName]=useState("");
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [code,setCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    let current=true;
    fetch("/api/signup/config",{cache:"no-store"})
      .then(r=>r.json()).then(d=>{if(current)setEnabled(d.enabled===true)})
      .catch(()=>{if(current)setEnabled(false)});
    return ()=>{current=false};
  },[]);
  async function sendRequest(event:React.FormEvent){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try {
      const response=await fetch("/api/signup/request",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({companyName,contactName,email,password})
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"Could not start verification");
      setPassword("");setStep("verify");
    }catch(e:any){setError(e?.message||"Could not start verification")}
    finally{setBusy(false)}
  }
  async function verify(event:React.FormEvent){
    event.preventDefault();
    if(busy)return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/signup/verify",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({email,code})
      });
      const data=await response.json();
      if(!response.ok)throw Error(data.error||"Verification failed");
      setCode("");setStep("complete");
    }catch(e:any){setError(e?.message||"Verification failed")}
    finally{setBusy(false)}
  }
  return <div className="min-h-[calc(100dvh-140px)] bg-[#f3f6fc] px-4 py-12 text-slate-900">
    <main className="mx-auto max-w-lg rounded-2xl border border-blue-100 bg-white p-6 shadow-sm sm:p-9">
      <a href="/website#pricing" className="text-sm font-medium text-blue-700">← Public website · CallingAgent packages</a>
      <div className="mt-6 flex items-center gap-3"><ShieldCheck className="h-7 w-7 text-blue-600"/><h1 className="text-2xl font-extrabold">Create your business account</h1></div>
      {enabled===null?<p className="mt-5 text-sm text-slate-600">Checking registration availability…</p>:
      !enabled?<div className="mt-6 space-y-3"><p className="text-sm text-slate-700">Online registration is not available during final launch checks. You can request access from the package page.</p><a href={"/start?plan="+plan} className="block rounded-xl bg-blue-600 p-3 text-center font-semibold text-white">Request early access</a></div>:
      step==="complete"?<div className="mt-7 space-y-4"><CheckCircle2 className="h-10 w-10 text-emerald-600"/><p className="font-bold">Your email is verified and your business account was created.</p><p className="text-sm text-slate-600">Sign in to continue to the package you selected. Package access is not activated until billing is verified.</p><a href={loginUrl} className="block rounded-xl bg-blue-600 px-4 py-3 text-center font-bold text-white">Sign in to continue</a></div>:
      <form onSubmit={step==="details"?sendRequest:verify} className="mt-7 space-y-4">
        {step==="details"?<>
          <label className="block text-sm font-semibold">Business name<input required minLength={2} maxLength={120} autoComplete="organization" value={companyName} onChange={e=>setCompanyName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal"/></label>
          <label className="block text-sm font-semibold">Your name<input required minLength={2} maxLength={120} autoComplete="name" value={contactName} onChange={e=>setContactName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal"/></label>
          <label className="block text-sm font-semibold">Work email<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal"/></label>
          <label className="block text-sm font-semibold">Password<input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 font-normal"/><span className="mt-1 block text-xs font-normal text-slate-500">Use at least 12 characters.</span></label>
        </>:<><p className="text-sm text-slate-600">Enter the eight-digit code sent to <strong>{email}</strong>. It expires in 15 minutes.</p><label className="block text-sm font-semibold">Verification code<input required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} autoComplete="one-time-code" value={code} onChange={e=>setCode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-3 text-lg tracking-widest"/></label></>}
        {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50">{busy?"Processing…":step==="details"?"Email verification code":"Verify and create account"}</button>
        <p className="text-xs text-slate-600">No payment will be charged or phone number purchased by registering.</p>
      </form>}
      <a href={loginUrl} className="mt-7 inline-block text-sm font-semibold text-blue-700 underline">Already have an account? Sign in</a>
    </main>
  </div>;
}
