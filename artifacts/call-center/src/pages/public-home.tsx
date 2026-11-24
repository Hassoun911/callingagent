import SiteFooter from "@/components/site-footer";
import { useEffect, useState } from "react";
import { ArrowRight, Check, ChevronDown, PhoneCall, ShieldCheck, Bot, MessageSquare, CreditCard, Menu, X, Building2, Clock3, Sparkles } from "lucide-react";

type DisplayPlan = { id:string; name:string; price:number; minutes:number; numbers:number; tagline:string; features:string[]; popular:boolean; checkoutEnabled:boolean };
const featureLabels:Record<string,string> = {numbers:"Canadian phone numbers",forwarding:"Call forwarding",voicemail:"Company voicemail",email_alerts:"Email notifications",call_logs:"Call history",extensions:"Team extensions",ai_receptionist:"AI receptionist",sms:"SMS messaging",appointments:"Appointment scheduling"};
function usePublicPlans() {
 const [plans,setPlans]=useState<DisplayPlan[]>([]);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState("");
 useEffect(()=>{
  let cancelled=false;
  fetch("/api/public-plans").then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error||"Plans are unavailable");if(!cancelled)setPlans(data.map((p:any)=>({id:p.slug,name:p.name,price:p.priceCents/100,minutes:p.monthlyMinutes,numbers:p.includedNumbers,tagline:p.description,features:[...p.features.map((f:string)=>featureLabels[f]||f),...(p.slug==="pro"?["AI receptionist access at launch (credits metered separately)"]:[])],popular:p.slug==="business",checkoutEnabled:p.checkoutEnabled===true})));}).catch(e=>{if(!cancelled)setError(e.message)}).finally(()=>{if(!cancelled)setLoading(false)});
  return ()=>{cancelled=true};
 },[]);
 return {plans,loading,error};
}

function ButtonLink({href,children,solid=false}:{href:string;children:React.ReactNode;solid?:boolean}) {
  return <a href={href} className={solid ? "inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 transition-colors" : "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 hover:bg-blue-50 transition-colors"}>{children}</a>;
}

function AiSalesInquiry() {
  const [name,setName]=useState("");
  const [email,setEmail]=useState("");
  const [company,setCompany]=useState("");
  const [phone,setPhone]=useState("");
  const [website,setWebsite]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [done,setDone]=useState(false);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(busy || done)return;
    setBusy(true);setError("");
    try{
      const result=await fetch("/api/launch-interest",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({plan:"ai-standalone",name,email,company,phone,website}),
      });
      const data=await result.json();
      if(!result.ok)throw Error(data.error||"Unable to submit your inquiry.");
      setDone(true);
    }catch(e:any){setError(e?.message||"Please try again later.");}
    finally{setBusy(false);}
  }
  return <div id="ai-inquiry" className="mt-6 rounded-2xl border border-indigo-200 bg-white p-5 shadow-sm">
    <h3 className="text-lg font-bold text-indigo-950">Request AI Receptionist early access</h3>
    <p className="mt-2 text-sm text-slate-600">Planned from $99 CAD/month. Share your details and we can contact you when your setup and usage options are ready. This is an inquiry, not an order or payment.</p>
    {done?<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Your request has been recorded. No payment was taken.</p>:
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">Your name <input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
      <label className="text-xs font-semibold text-slate-700">Email <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
      <label className="text-xs font-semibold text-slate-700">Business name (optional) <input maxLength={120} autoComplete="organization" value={company} onChange={e=>setCompany(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
      <label className="text-xs font-semibold text-slate-700">Phone (optional) <input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label>
      <label className="hidden" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label>
      {error&&<p role="alert" className="text-sm text-red-700 sm:col-span-2">{error}</p>}
      <button type="submit" disabled={busy} className="rounded-xl bg-indigo-700 px-5 py-3 text-sm font-bold text-white hover:bg-indigo-800 disabled:opacity-50 sm:col-span-2">{busy?"Sending…":"Request AI early access — no payment"}</button>
      <p className="text-xs text-slate-500 sm:col-span-2">By sending this request, you agree to be contacted about your CallingAgent inquiry. AI usage costs, included credits and availability will be confirmed before purchase.</p>
    </form>}
  </div>;
}

function HeroProductIllustration(){
  return <svg role="img" aria-label="Illustration of CallingAgent's business phone and AI receptionist: a mobile call, a computer dashboard, an AI headset assistant, and a desk phone" viewBox="0 0 1100 560" className="h-auto w-full overflow-visible" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="caLaptop" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#172858"/><stop offset="1" stopColor="#3b2a97"/></linearGradient>
      <linearGradient id="caDesk" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#475569"/><stop offset=".7" stopColor="#0f172a"/></linearGradient>
      <linearGradient id="caRobot" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fff"/><stop offset=".7" stopColor="#e2dcff"/><stop offset="1" stopColor="#a9a6ee"/></linearGradient>
      <linearGradient id="caBotFace" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#161d43"/><stop offset="1" stopColor="#342371"/></linearGradient>
      <linearGradient id="caScreen" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#101c43"/><stop offset="1" stopColor="#0b1633"/></linearGradient>
      <linearGradient id="caPurple" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#408dff"/><stop offset="1" stopColor="#6939db"/></linearGradient>
      <filter id="caShadow" x="-35%" y="-35%" width="170%" height="190%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#1b2067" floodOpacity=".18"/></filter>
      <filter id="caGlow"><feGaussianBlur stdDeviation="15"/></filter>
    </defs>
    <ellipse cx="555" cy="518" rx="475" ry="21" fill="#c3cdfa" opacity=".28"/>
    <path d="M425 230C470 70 615 30 760 120S1020 370 950 485H290C190 390 268 280 425 230Z" fill="#eae4ff"/>
    <path d="M535 180C655 80 824 110 940 235" fill="none" stroke="#d6caff" strokeWidth="25" strokeLinecap="round" opacity=".65"/>
    <g filter="url(#caShadow)">
      <rect x="245" y="188" width="490" height="293" rx="20" fill="#25284b"/>
      <rect x="258" y="202" width="465" height="263" rx="11" fill="url(#caLaptop)"/>
      <rect x="258" y="202" width="97" height="263" rx="10" fill="#151d47"/>
      <circle cx="284" cy="228" r="10" fill="#6e64ef"/>
      <path d="M276 228l5-5 8 9 5-3" fill="none" stroke="white" strokeWidth="2"/>
      <text x="300" y="232" fill="white" fontWeight="bold" fontSize="13">CallingAgent</text>
      {["Dashboard","Calls","Messages","Contacts","AI Receptionist"].map((label,i)=><g key={label}>
        {i===0&&<rect x="270" y={250+i*31} width="77" height="24" rx="6" fill="#4a4caa"/>}
        <circle cx="282" cy={263+i*31} r="3" fill={i===0?"#fff":"#929bc6"}/>
        <text x="293" y={267+i*31} fill={i===0?"#fff":"#bec7e9"} fontSize="9">{label}</text>
      </g>)}
      <text x="385" y="244" fill="white" fontSize="22" fontWeight="bold">AI Receptionist</text>
      <rect x="380" y="263" width="305" height="38" rx="12" fill="#fff" opacity=".10"/>
      <path d="M394 283h10m10-6v12m10-19v26m10-22v17m10-26v31m10-22v17m10-27v33m10-21v19m10-14v10m10-19v29m10-25v21m10-14v8m10-24v28" stroke="#bba8ff" strokeWidth="4" strokeLinecap="round"/>
      {["Answer incoming calls","Take customer messages","Capture new leads","Record appointment requests"].map((label,i)=><g key={label}>
        <rect x="381" y={313+i*34} width="305" height="28" rx="11" fill="#f6f7ff"/>
        <circle cx="399" cy={327+i*34} r="9" fill="#347de9"/>
        <path d={`M395 ${327+i*34}l3 3 5-6`} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        <text x="418" y={331+i*34} fontSize="12" fill="#1a2450">{label}</text>
      </g>)}
      <path d="M235 480H747L789 510Q786 520 770 523H222Q199 521 204 512Z" fill="#c1c6dd" stroke="#a6aecb" strokeWidth="2"/>
      <path d="M274 486H707L724 500H256Z" fill="#e8e9f3"/>
    </g>
    <g filter="url(#caShadow)" transform="translate(115 254) rotate(-7 75 130)">
      <rect x="0" y="0" width="150" height="259" rx="26" fill="#252b47"/>
      <rect x="8" y="9" width="134" height="240" rx="20" fill="url(#caScreen)"/>
      <rect x="48" y="13" width="58" height="12" rx="7" fill="#060d24"/>
      <text x="75" y="57" textAnchor="middle" fontSize="14" fontWeight="bold" fill="white">Business Call</text>
      <circle cx="75" cy="110" r="28" fill="#2563eb" opacity=".65"/>
      <path d="M61 100Q65 119 84 121L90 113 79 107 75 113Q69 110 68 105L74 99 65 93Z" fill="white"/>
      <text x="75" y="159" fill="#cad5ef" textAnchor="middle" fontSize="12">Incoming call...</text>
      <circle cx="46" cy="208" r="20" fill="#f04452"/><circle cx="105" cy="208" r="20" fill="#18b985"/>
      <path d="M35 208Q46 201 57 208M94 208Q105 200 116 208" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round"/>
    </g>
    <g filter="url(#caShadow)">
      <path d="M550 443Q548 362 640 348Q733 351 738 444L755 495H531Z" fill="url(#caRobot)" stroke="#c8b9fc" strokeWidth="4"/>
      <rect x="579" y="399" width="128" height="77" rx="35" fill="#f6f4ff"/>
      <circle cx="642" cy="435" r="26" fill="url(#caPurple)"/><path d="M626 428Q631 444 649 446L654 438 645 433 641 439Q637 435 636 430L641 424 633 420Z" fill="white"/>
      <path d="M562 266C562 196 597 171 647 171S732 196 732 266" fill="none" stroke="#7461d6" strokeWidth="22" strokeLinecap="round"/>
      <rect x="555" y="260" width="27" height="69" rx="13" fill="#5b46c7"/><rect x="714" y="260" width="27" height="69" rx="13" fill="#5b46c7"/>
      <rect x="567" y="202" width="158" height="145" rx="63" fill="url(#caRobot)" stroke="#9d8fee" strokeWidth="4"/>
      <rect x="584" y="226" width="125" height="90" rx="40" fill="url(#caBotFace)"/>
      <path d="M608 267q15-18 29 0m19 0q14-18 28 0" fill="none" stroke="#88d6ff" strokeWidth="7" strokeLinecap="round"/>
      <path d="M632 290q17 12 31 0" fill="none" stroke="#b9a2ff" strokeWidth="5" strokeLinecap="round"/>
      <path d="M728 312q20 22 0 30l-27-1" fill="none" stroke="#6755d2" strokeWidth="8" strokeLinecap="round"/>
      <circle cx="700" cy="340" r="7" fill="#77acff"/>
    </g>
    <g filter="url(#caShadow)" transform="translate(812 316)">
      <path d="M0 143L55 40H221L272 145Q276 167 258 169H18Q-4 165 0 143Z" fill="url(#caDesk)"/>
      <path d="M27 126H245L263 152H10Z" fill="#27324b"/>
      <rect x="106" y="60" width="104" height="54" rx="8" fill="#111b38"/>
      <rect x="116" y="68" width="83" height="38" rx="5" fill="#4266a7"/>
      <path d="M143 86q14-16 26 0" fill="none" stroke="white" strokeWidth="6"/>
      {Array.from({length:12},(_,i)=><rect key={i} x={58+(i%4)*35} y={130+Math.floor(i/4)*11} width="21" height="7" rx="3" fill="#8291b5" />)}
      <path d="M18 43Q27 8 57 4L85 27Q99 62 74 83L41 104Q21 105 11 87Z" fill="#293650" stroke="#101c34" strokeWidth="5"/>
    </g>
    <g fill="#85b95b" opacity=".9"><path d="M111 430Q52 328 80 309Q123 316 111 430Z"/><path d="M120 433Q122 319 159 318Q189 354 120 433Z"/><path d="M116 429Q60 367 36 384Q41 421 116 429Z"/></g>
    <path d="M77 415H154L144 503H90Z" fill="#e4e6f0"/>
  </svg>;
}

export default function PublicHome({mode="ai"}:{mode?:"ai"|"phone"}={}) {
  const isPhone=mode==="phone";
  const {plans,loading,error}=usePublicPlans();
  const [mobile,setMobile]=useState(false);
  const [faq,setFaq]=useState(-1);
  const questions=[
    ["Do I need both products?","No. AI Receptionist and Business Phone have separate options. Phone plans do not automatically activate AI; an AI package and usage credits will be confirmed before purchase."],
    ["Is AI Receptionist available to purchase?","AI early-access inquiries are open. The planned standalone starting price is $99 CAD/month. Paid checkout and automatic AI activation are not available yet."],
    ["Does AI respond to text messages?","Businesses can use manual SMS. AI-written automatic text replies are planned, not yet live."],
    ["Can I still use a traditional business phone?","Yes. Our dedicated Business Phone page offers Canadian numbers, forwarding, voicemail and five published packages. Payments and automatic activation are still undergoing launch checks."],
  ];
  return <div className="min-h-screen bg-[#f7faff] text-[#0a1830]">
    <div className="border-b border-blue-100 bg-[#eef4ff]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-2 text-[11px] font-semibold text-blue-900 sm:px-8">
        <span>CALLINGAGENT · PUBLIC WEBSITE</span>
        <a href="/login" className="text-indigo-700 underline-offset-4 hover:underline">Existing customer? Open account area →</a>
      </div>
    </div>
    <header className="sticky top-0 z-30 border-b border-blue-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <a href="/website" className="flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight sm:text-xl"><span className="rounded-xl bg-blue-600 p-2 text-white"><PhoneCall className="h-5 w-5"/></span>Calling<span className="text-blue-600">Agent</span></a>
        <nav className="hidden items-center gap-4 text-sm font-semibold text-slate-600 lg:flex xl:gap-7" aria-label="Public services"><a href="/website" aria-current={!isPhone?"page":undefined} className={!isPhone?"rounded-lg bg-violet-50 px-3 py-2 text-violet-800":"hover:text-violet-700"}>AI Receptionist</a><a href="/business-phone" aria-current={isPhone?"page":undefined} className={isPhone?"rounded-lg bg-blue-50 px-3 py-2 text-blue-800":"hover:text-blue-700"}>Business Phone</a><a href="#how-it-works" className="hover:text-blue-600">How it works</a><a href={isPhone?"#pricing":"#ai-inquiry"} className="hover:text-blue-600">{isPhone?"Phone Plans":"AI Early Access"}</a><a href="#faq" className="hover:text-blue-600">FAQ</a></nav>
        <div className="hidden items-center gap-3 lg:flex"><a href="/login" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold hover:bg-slate-50">Sign in</a><a href={isPhone?"/business-phone#pricing":"/website#ai-inquiry"} className="inline-flex items-center gap-2 rounded-xl bg-indigo-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-800">{isPhone?<PhoneCall className="h-4 w-4"/>:<Bot className="h-4 w-4"/>}{isPhone?"View phone plans":"AI early access"}</a></div>
        <button aria-label="Toggle menu" onClick={()=>setMobile(!mobile)} className="p-2 lg:hidden">{mobile?<X/>:<Menu/>}</button>
      </div>
      {mobile&&<nav className="flex flex-col gap-4 border-t border-blue-100 bg-white px-6 py-5 text-sm font-semibold lg:hidden" aria-label="Mobile public services"><a href="/website" onClick={()=>setMobile(false)} aria-current={!isPhone?"page":undefined}>AI Receptionist</a><a href="/business-phone" onClick={()=>setMobile(false)} aria-current={isPhone?"page":undefined}>Business Phone</a><a href="#how-it-works" onClick={()=>setMobile(false)}>How it works</a><a href={isPhone?"#pricing":"#ai-inquiry"} onClick={()=>setMobile(false)}>{isPhone?"Phone Plans":"AI early access"}</a><a href="#faq" onClick={()=>setMobile(false)}>FAQ</a><a href="/login">Account sign in</a></nav>}
    </header>
    <main>
      <section className="relative overflow-hidden bg-white">
        <div className="pointer-events-none absolute -left-32 top-16 h-72 w-72 rounded-full bg-blue-100/50 blur-3xl"/>
        <div className="pointer-events-none absolute -right-24 top-48 h-80 w-80 rounded-full bg-violet-100/70 blur-3xl"/>
        <div className="relative mx-auto max-w-7xl px-5 pb-10 pt-12 text-center sm:px-8 sm:pt-16 lg:pt-20">
          {isPhone?<>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-blue-700">CallingAgent Business Phone</p>
            <h1 className="mx-auto mt-4 max-w-5xl text-4xl font-extrabold leading-[1.09] tracking-tight text-[#10152f] sm:text-5xl lg:text-7xl">A professional business number. <span className="block text-blue-600">Without the complicated setup.</span></h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-xl">Keep your work and personal calls separate. Get a Canadian business number, forward calls to your mobile, route callers to your team, and receive voicemail notifications in one place.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3"><a href="#pricing" className="rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white hover:bg-blue-700">Compare phone plans</a><a href="/website" className="rounded-xl border border-violet-200 px-6 py-3.5 text-sm font-bold text-violet-700 hover:bg-violet-50">Explore AI Receptionist</a></div>
            <p className="mt-3 text-xs text-slate-500">Phone plans start at $9 CAD/month. Online purchasing and automatic activation are still being verified.</p>
          </>:<>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-violet-700">Meet your future AI front desk</p>
            <h1 className="mx-auto mt-4 max-w-5xl text-4xl font-extrabold leading-[1.09] tracking-tight text-[#10152f] sm:text-5xl lg:text-7xl">Every call is an opportunity. <span className="block bg-gradient-to-r from-blue-600 to-violet-700 bg-clip-text text-transparent">Give your business an AI receptionist.</span></h1>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-slate-600 sm:text-xl">Be more responsive without constantly answering the phone. Explore AI-powered call answering, customer inquiries, lead capture and follow-up, so your team can focus on the work that grows your business.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3"><a href="#ai-inquiry" className="inline-flex items-center gap-2 rounded-xl bg-violet-700 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-200 hover:bg-violet-800"><Bot className="h-4 w-4"/>Request AI early access <ArrowRight className="h-4 w-4"/></a><a href="/business-phone" className="rounded-xl border border-blue-200 bg-white px-6 py-3.5 text-sm font-bold text-blue-700 hover:bg-blue-50">Looking for Business Phone?</a></div>
            <p className="mt-3 text-xs text-slate-600">Standalone AI Receptionist planned from $99 CAD/month, plus applicable taxes and metered usage. No payment is taken for an inquiry.</p>
          </>}
          <div className="mx-auto mt-6 max-w-5xl"><HeroProductIllustration /></div>
          <div className="mx-auto mt-3 grid max-w-5xl grid-cols-2 gap-4 border-t border-slate-200 py-5 text-left sm:grid-cols-4">
            {(isPhone?[[PhoneCall,"Canadian numbers","Separate business calling"],[Building2,"Team forwarding","Send calls to the right person"],[MessageSquare,"Voicemail","Capture messages"],[Clock3,"Stay organized","Review call history"]]:[[Bot,"AI call answering","Explore always-on reception"],[Building2,"Lead capture","Record customer inquiries"],[Clock3,"Appointment requests","Don't lose an opportunity"],[MessageSquare,"Follow-up","Keep your team responsive"]]).map(([Icon,title,subtitle])=><div className="flex items-center gap-3" key={String(title)}><span className="rounded-xl bg-violet-50 p-2.5 text-violet-700"><Icon className="h-5 w-5"/></span><div><p className="text-sm font-bold text-slate-900">{title}</p><p className="text-xs text-slate-500">{subtitle}</p></div></div>)}
          </div>
          <p className="text-xs text-slate-500">{isPhone?"Business Phone purchases and automated activation are not yet available. Request access from any package.":"AI service is available for early-access inquiries only. Automated activation, AI-written SMS replies, credit allowances and final usage rates are not yet available."}</p>
        </div>
      </section>
      {!isPhone&&<section id="solutions" className="scroll-mt-20 bg-white py-16">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <p className="text-center text-xs font-bold uppercase tracking-[0.2em] text-violet-700">Less time on routine calls. More time for customers.</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center text-3xl font-extrabold tracking-tight sm:text-4xl">What could an AI receptionist do for your business?</h2>
          <div className="mt-9 grid gap-5 md:grid-cols-3">
            {[[PhoneCall,"Be easier to reach","Let callers reach an AI answering experience when your team is busy or unavailable."],[Building2,"Capture the next opportunity","Collect customer details and requests so a promising inquiry doesn't disappear."],[Clock3,"Give your team time back","Reduce interruptions from repeat questions and follow-up tasks, and focus on serving customers."]].map(([Icon,title,detail])=><article key={String(title)} className="rounded-3xl border border-violet-100 bg-[#faf9ff] p-7 shadow-sm"><span className="inline-flex rounded-xl bg-violet-100 p-3 text-violet-700"><Icon className="h-7 w-7"/></span><h3 className="mt-5 text-xl font-extrabold">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-600">{detail}</p></article>)}
          </div>
        </div>
      </section>}
      {!isPhone&&<section id="services" className="border-y border-violet-100 bg-[#faf9ff] py-12">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><p className="text-center text-sm font-semibold text-violet-800">Explore inbound AI answering · Outbound campaign assistance · Lead capture · Appointment requests · Human follow-up</p></div>
      </section>}
      <section id="how-it-works" className="scroll-mt-20 bg-[#f7faff] py-20"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">How it works</p><h2 className="mt-3 text-3xl font-extrabold sm:text-4xl">{isPhone?"A simpler way to manage business calls":"From incoming calls to better business opportunities"}</h2><p className="mt-3 text-slate-600">{isPhone?"Choose your number, direct calls to your team and manage messages in one place.":"Explore an AI receptionist designed to support your customers and your team."}</p></div><div className="mt-10 grid gap-5 md:grid-cols-3">{(isPhone?[["1","Choose your package","Compare Canadian number allowances and published monthly voice minutes."],["2","Direct your calls","Configure forwarding, press 1 to accept, and voicemail preferences."],["3","Stay in control","Review messages, call logs and your business communication settings."]]:[["1","Welcome callers","Explore AI answering for common questions and customer inquiries."],["2","Capture what matters","Record contact details, lead information and appointment requests for review."],["3","Keep moving","Give your team organized information for timely human follow-up."]]).map(([n,t,d])=><div key={n} className="rounded-2xl border border-blue-100 bg-white p-7 shadow-sm"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">{n}</span><h3 className="mt-5 text-lg font-bold">{t}</h3><p className="mt-3 text-sm leading-relaxed text-slate-600">{d}</p></div>)}</div></div></section>
      {isPhone&&<>
      <section id="pricing" className="scroll-mt-20 bg-white py-20"><div className="mx-auto max-w-7xl px-5 sm:px-8"><div className="text-center"><p className="text-xs font-bold uppercase tracking-[0.2em] text-blue-600">Business phone pricing</p><h2 className="mt-3 font-serif text-3xl font-bold sm:text-4xl">Your business number, your way.</h2><p className="mt-3 text-slate-600">Five Canadian-dollar phone-system plans for forwarding, voicemail and business call management. AI receptionist service is priced separately and is not included.</p></div><div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-5">{loading&&<p className="col-span-full text-center text-slate-500">Loading packages…</p>}{error&&<p className="col-span-full text-center text-red-700">Packages are temporarily unavailable. Please try again later.</p>}{!loading&&!error&&plans.length===0&&<p className="col-span-full text-center text-slate-600">No packages are currently offered.</p>}{plans.map(p=><div key={p.id} className={`relative flex flex-col rounded-2xl border p-5 shadow-sm ${p.popular?"border-blue-500 bg-blue-50":"border-slate-200 bg-white"}`}>{p.popular&&<span className="absolute -top-3 left-4 rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">Most popular</span>}<h3 className="text-lg font-bold">{p.name}</h3><p className="mt-2 min-h-14 text-xs leading-relaxed text-slate-500">{p.tagline}</p><div className="mt-4"><span className="text-4xl font-black">${p.price}</span><span className="ml-1 text-sm text-slate-500">CAD/mo</span></div><p className="mt-4 border-y border-slate-200 py-3 text-sm font-bold">{p.minutes?p.minutes.toLocaleString()+" monthly voice min":"Prepaid voice minutes"}</p><ul className="mt-5 flex-1 space-y-3">{p.features.map(f=><li key={f} className="flex gap-2 text-xs leading-relaxed text-slate-700"><Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600"/>{f}</li>)}</ul><a href={`/start?plan=${p.id}`} className={`mt-7 flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold ${p.popular?"bg-blue-600 text-white hover:bg-blue-700":"border border-slate-200 bg-slate-50 text-slate-900 hover:bg-slate-100"}`}>{p.checkoutEnabled?"Choose plan":"Request access"} <ArrowRight className="h-4 w-4"/></a></div>)}</div><p className="mt-6 text-center text-xs text-slate-500">Business Phone plans are published for planning while online purchasing is being verified. Pro is planned to include AI access after launch, but not unlimited AI use. AI credits, SMS and taxes are separate; included AI credits and top-up rates will be confirmed before activation. Phone voice minutes are distinct from AI credits.</p></div></section>
      </>}
      {!isPhone&&<>
      <section id="ai" className="scroll-mt-20 border-t border-blue-100 bg-[#eff6ff] py-20"><div className="mx-auto grid max-w-7xl gap-8 px-5 sm:px-8 lg:grid-cols-2 lg:items-center"><div><p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-700">A different solution from the phone plans</p><h2 className="mt-3 font-serif text-3xl font-bold sm:text-4xl">AI receptionist for your business</h2><p className="mt-4 max-w-xl leading-relaxed text-slate-700">AI can assist with inbound call answering, outbound calling campaigns, lead details, common questions and appointment requests. Businesses can already send and receive texts manually. AI-generated automatic SMS replies are being developed and are not available for customers yet.</p><p className="mt-4 text-sm font-semibold text-indigo-800">Pro ($119 CAD/month) is planned to include AI Receptionist access plus its Business Phone benefits. Standalone AI starts at $99 CAD/month. Business and Business Plus will have an optional paid AI add-on. Usage credits and activation are separate; public AI checkout is not available yet.</p><AiSalesInquiry /></div><div className="rounded-3xl border border-indigo-100 bg-white p-7 shadow-sm"><h3 className="text-xl font-bold">What AI can help with</h3><ul className="mt-5 space-y-4 text-sm text-slate-700">{["Answer incoming business calls with AI","Make outbound AI-assisted calls through campaigns","Capture leads and appointment requests","Send and receive text messages (manual today)","AI-generated automatic SMS replies (coming soon)"].map(x=><li key={x} className="flex gap-3"><Check className="h-5 w-5 flex-none text-indigo-600"/>{x}</li>)}</ul><p className="mt-6 text-xs text-slate-500">AI activation, included starter-credit amount and top-up rates are being validated. AI usage is not unlimited, and no AI minutes are automatically granted with the currently published phone plans.</p></div></div></section>
      </>}
      <section id="faq" className="scroll-mt-20 bg-[#f7faff] py-20"><div className="mx-auto max-w-3xl px-5 sm:px-8"><h2 className="text-center font-serif text-3xl font-bold">Frequently asked questions</h2><div className="mt-8 space-y-3">{questions.map(([q,a],i)=><div key={q} className="rounded-xl border border-blue-100 bg-white shadow-sm"><button className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left text-sm font-bold" onClick={()=>setFaq(faq===i?-1:i)}>{q}<ChevronDown className={`h-4 w-4 flex-none transition-transform ${faq===i?"rotate-180":""}`}/></button>{faq===i&&<p className="px-5 pb-5 text-sm leading-relaxed text-slate-600">{a}</p>}</div>)}</div></div></section>
    </main>
    <SiteFooter />
  </div>;
}

export function PublicStart({ canCheckout = false }:{ canCheckout?:boolean } = {}) {
  const {plans,loading,error}=usePublicPlans();
  const [startingCheckout,setStartingCheckout]=useState(false);
  const [checkoutError,setCheckoutError]=useState("");
  const [signupAvailable,setSignupAvailable]=useState(false);
  useEffect(()=>{
    let mounted=true;
    fetch("/api/signup/config",{cache:"no-store"}).then(r=>r.ok?r.json():{enabled:false})
      .then(v=>{if(mounted)setSignupAvailable(v.enabled===true)})
      .catch(()=>{});
    return ()=>{mounted=false};
  },[]);
  const [interestName,setInterestName]=useState("");
  const [interestEmail,setInterestEmail]=useState("");
  const [interestPhone,setInterestPhone]=useState("");
  const [interestCompany,setInterestCompany]=useState("");
  const [interestWebsite,setInterestWebsite]=useState("");
  const [interestBusy,setInterestBusy]=useState(false);
  const [interestMessage,setInterestMessage]=useState("");
  const [interestError,setInterestError]=useState("");
  async function requestLaunchAccess(planSlug:string){
    if(interestBusy)return;
    setInterestBusy(true);setInterestError("");setInterestMessage("");
    try{
      const response=await fetch("/api/launch-interest",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({plan:planSlug,name:interestName,email:interestEmail,phone:interestPhone,company:interestCompany,website:interestWebsite})
      });
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||"Request could not be submitted");
      setInterestMessage("Request received. We will contact you about availability. No charge has been made.");
    }catch(err:any){setInterestError(err.message||"Could not save your request");}
    finally{setInterestBusy(false);}
  }

  async function startCheckout(planId:string) {
    if(startingCheckout) return;
    setStartingCheckout(true); setCheckoutError("");
    try {
      const res=await fetch("/api/billing/checkout",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({plan:planId})});
      const data=await res.json();
      if(!res.ok||typeof data.url!=="string")throw Error(data.error||"Checkout unavailable");
      const destination=new URL(data.url);
      if(destination.protocol!=="https:"||!destination.hostname.endsWith(".stripe.com"))throw Error("Unexpected checkout destination");
      window.location.assign(destination.href);
    }catch(error:any){setCheckoutError(String(error?.message||"Checkout unavailable"));setStartingCheckout(false);}
  }
  const plan = plans.find(x=>x.id===new URLSearchParams(window.location.search).get("plan"));
  if (loading) return <div className="min-h-screen p-12">Loading your selected plan…</div>;
  if (error || !plan) return <div className="min-h-screen p-12 text-slate-900"><h1 className="text-2xl font-bold">Package unavailable</h1><p className="mt-2">This package is currently unavailable. No purchase has been made.</p><a href="/business-phone#pricing" className="mt-4 inline-block text-blue-700 underline">Return to pricing</a></div>;
  return <div className="min-h-screen bg-[#f7faff] text-slate-900"><main className="mx-auto max-w-xl px-5 py-12"><a href="/business-phone#pricing" className="text-sm text-blue-600">← Back to packages</a><div className="mt-10 rounded-3xl border border-blue-100 bg-white p-7 sm:p-10"><div className="inline-flex items-center gap-2 text-blue-600"><CreditCard className="h-5 w-5"/> Package selection</div><h1 className="mt-4 text-3xl font-extrabold">{plan.name}</h1><p className="mt-2 text-slate-600">{plan.tagline}</p><div className="mt-6 rounded-xl bg-blue-50 p-5"><p className="text-3xl font-bold">${plan.price} CAD <span className="text-sm font-normal text-slate-600">per month</span></p><p className="mt-2 text-sm text-slate-600">{plan.numbers} number{plan.numbers>1?"s":""} · {plan.minutes?plan.minutes.toLocaleString()+" monthly voice minutes":"pay-as-you-go minutes"}</p></div>{plan.checkoutEnabled ? <div className="mt-6"><p className="text-sm text-slate-600">Only your company's administrator can purchase this package.</p>{canCheckout
      ? <button type="button" disabled={startingCheckout} onClick={()=>startCheckout(plan.id)} className="mt-3 w-full rounded-xl bg-blue-600 px-5 py-3 font-bold text-white disabled:opacity-50">{startingCheckout?"Opening secure checkout…":"Continue to secure checkout"}</button>
      : <div className="mt-3 space-y-3">
        <a href={"/login?next="+encodeURIComponent("/start?plan="+plan.id)} className="block w-full rounded-xl bg-blue-600 px-5 py-3 text-center font-bold text-white">Sign in to continue</a>
        {signupAvailable&&<a href={"/signup?plan="+plan.id} className="block text-center text-sm font-semibold text-blue-700 underline">New business? Create your account</a>}
      </div>}
      {checkoutError&&<p className="mt-3 text-sm text-red-700" role="alert">{checkoutError}</p>}</div> : <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
    <h2 className="text-lg font-bold text-blue-950">Request early access to {plan.name}</h2>
    <p className="mt-2 text-sm text-slate-700">We're accepting business inquiries while carrier usage limits and automatic setup receive final checks. This is not an order. No payment will be taken.</p>
    {interestMessage?<p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{interestMessage}</p>:
    <form onSubmit={event=>{event.preventDefault();void requestLaunchAccess(plan.id)}} className="mt-4 space-y-3">
      <label className="block text-xs font-bold text-slate-700">Your name <input required minLength={2} maxLength={100} autoComplete="name" value={interestName} onChange={e=>setInterestName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/></label>
      <label className="block text-xs font-bold text-slate-700">Email <input type="email" required maxLength={254} autoComplete="email" value={interestEmail} onChange={e=>setInterestEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/></label>
      <label className="block text-xs font-bold text-slate-700">Business name (optional) <input maxLength={120} autoComplete="organization" value={interestCompany} onChange={e=>setInterestCompany(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/></label>
      <label className="block text-xs font-bold text-slate-700">Phone (optional) <input type="tel" maxLength={40} autoComplete="tel" value={interestPhone} onChange={e=>setInterestPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/></label>
      <label className="hidden" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={interestWebsite} onChange={e=>setInterestWebsite(e.target.value)}/></label>
      {interestError&&<p role="alert" className="text-sm font-medium text-red-700">{interestError}</p>}
      <button type="submit" disabled={interestBusy} className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60">{interestBusy?"Sending request…":"Request access — no payment"}</button>
      <p className="text-xs text-slate-600">By submitting, you agree to be contacted about your CallingAgent inquiry. No subscription is created.</p>
    </form>}
  </div>}<div className="mt-6 flex flex-wrap gap-3"><ButtonLink href="/login">Already have an account? Sign in</ButtonLink>{signupAvailable&&<ButtonLink href={"/signup?plan="+plan.id}>Create business account</ButtonLink>}<ButtonLink href="/business-phone#pricing" solid>Compare packages</ButtonLink></div></div></main><SiteFooter /></div>;
}
