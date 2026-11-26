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
  return <div className="relative rounded-[2rem] border border-[#e0ecfc] bg-white p-6 shadow-[0_28px_70px_rgba(4,42,111,.12)] sm:p-9">
    <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-extrabold uppercase tracking-wider text-blue-700"><span className="h-2 w-2 rounded-full bg-blue-500"/> Early access inquiry</div><h3 className="text-2xl font-black leading-tight tracking-tight text-[#0c2147] sm:text-3xl">Want to see CallingAgent for your business?</h3>
    <p className="mt-3 text-sm leading-7 text-slate-600">Leave your name and email to request AI early access. We’ll contact you when setup options are confirmed. No payment or commitment today.</p>
    {done?<p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">Your request has been recorded. No payment was taken.</p>:
    <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">Your name <input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-[#f8fbff] px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>
      <label className="text-xs font-semibold text-slate-700">Email <input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-[#f8fbff] px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>
      <label className="text-xs font-semibold text-slate-700">Business name (optional) <input maxLength={120} autoComplete="organization" value={company} onChange={e=>setCompany(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-[#f8fbff] px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>
      <label className="text-xs font-semibold text-slate-700">Phone (optional) <input type="tel" maxLength={40} autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-slate-200 bg-[#f8fbff] px-4 py-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"/></label>
      <label className="hidden" aria-hidden="true">Website <input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label>
      {error&&<p role="alert" className="text-sm text-red-700 lg:col-span-2">{error}</p>}
      <button type="submit" disabled={busy} className="inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#088fff] to-[#0752db] px-6 py-4 text-base font-extrabold text-white shadow-[0_12px_26px_rgba(13,93,215,.2)] transition hover:brightness-110 disabled:opacity-50 lg:col-span-2">{busy?"Sending…":"Request early access — no payment"}</button>
      <p className="text-xs text-slate-500 lg:col-span-2">We will contact you about this inquiry. No payment is taken. AI availability, included usage and final pricing will be confirmed before purchase.</p>
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

/**
 * Editorial, photography-first AI marketing experience.
 * Photographs depict real work environments, not a rendered product UI,
 * fabricated company staff, or a claim that a specific individual uses AI.
 * Photo credits: Kampus Production and Antoni Shkraba (Pexels free license).
 */
function AiLanding(){
  const [menuOpen,setMenuOpen]=useState(false);
  const [demoCase,setDemoCase]=useState(0);
  useEffect(()=>{
    const root=document.querySelector("[data-ca-landing]");
    if(!root || !("IntersectionObserver" in window))return;
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const nodes=Array.from(root.querySelectorAll("[data-ca-reveal]"));
    const observer=new IntersectionObserver(entries=>{
      for(const entry of entries)entry.target.classList.toggle("ca-in-view",entry.isIntersecting);
    },{threshold:0.12});
    const sync=()=>{
      observer.disconnect();
      nodes.forEach(node=>{
        node.classList.toggle("ca-reveal-ready",!media.matches);
        if(!media.matches)observer.observe(node);
        else node.classList.remove("ca-in-view");
      });
    };
    sync();media.addEventListener("change",sync);
    return()=>{observer.disconnect();media.removeEventListener("change",sync);nodes.forEach(node=>node.classList.remove("ca-reveal-ready","ca-in-view"));};
  },[]);
  const benefits=[
    {number:"01",title:"Be there when customers call",description:"Explore an AI answering experience designed for moments when your team is busy, closed, or already on another call."},
    {number:"02",title:"Turn conversations into opportunities",description:"Capture new inquiries, callers' details and the next step they are looking for, instead of relying on memory."},
    {number:"03",title:"Give your team time to do great work",description:"Spend less time on repeat questions and phone interruptions, with requests organized for follow-up."}
  ];
  return <div data-ca-landing className="min-h-screen bg-white font-sans text-[#14213d]">
    <style>{`
      .ca-hero-features{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}\n      [data-ca-landing] #ai-inquiry button[type=submit]{background:#155eef;color:white}\n      @media(max-width:640px){[data-ca-landing] h1{font-size:clamp(2.1rem,9vw,3rem)}[data-ca-landing] .ca-hero-features svg{width:18px;height:18px}[data-ca-landing] #ai-inquiry form{display:grid;grid-template-columns:minmax(0,1fr)}[data-ca-landing] #ai-inquiry input{min-height:48px;width:100%}}\n      @keyframes ca-wave-pulse {0%,100%{transform:scaleY(.65)}50%{transform:scaleY(1.1)}}\n      .ca-wave{animation:ca-wave-pulse 1.25s ease-in-out infinite;box-shadow:0 0 12px #38bdf8}\n      @media(prefers-reduced-motion:reduce){.ca-wave{animation:none}}\n
      @media(max-width:767px){
        .ca-home-hero>header{position:relative;inset:auto;background:white}
        .ca-home-hero{display:flex;flex-direction:column}
        .ca-home-content{order:1;min-height:0;animation:none}
        .ca-home-content .ca-entrance{animation:none}
        .ca-home-art{position:relative;inset:auto;order:2;width:100%;height:clamp(180px,52vw,320px)}
        .ca-home-art img{object-position:right center;object-fit:cover}
        .ca-home-art>div{background:linear-gradient(to bottom,#fafdff 0%,transparent 28%)}
        .ca-home-status{display:none}
        .ca-home-hero>div:last-child{order:3}
        .ca-home-content h1{font-size:clamp(2rem,7.6vw,3rem);line-height:1.1;margin-top:14px}
        .ca-home-content h1+p{margin-top:14px;line-height:1.55}
        .ca-home-actions{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin-top:20px}
        .ca-home-actions>a{width:100%;min-height:48px}
        .ca-home-content>div>span:first-child{font-size:10px;letter-spacing:.06em}
      }
      @media(min-width:768px){.ca-home-content{padding-top:8rem}}
      @keyframes ca-entrance {from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
      @keyframes ca-levitate {0%,100%{translate:0 0}50%{translate:0 -13px}}
      @keyframes ca-levitate-opposite {0%,100%{translate:0 0}50%{translate:0 12px}}
      @keyframes ca-orbit-soft {0%,100%{transform:rotate(-10deg) scale(1)}50%{transform:rotate(8deg) scale(1.035)}}
      .ca-hero-stage{perspective:1400px;transform-style:preserve-3d}
      .ca-hero-tilt{transform-style:preserve-3d;transition:transform 420ms cubic-bezier(.2,.7,.2,1)}
      .ca-entrance{animation:ca-entrance 950ms cubic-bezier(.2,.8,.2,1) both}
      .ca-photo-card{animation:ca-entrance 1150ms cubic-bezier(.2,.8,.2,1) both}
      .ca-float-a{animation:ca-levitate 6s ease-in-out infinite}
      .ca-float-b{animation:ca-levitate-opposite 7s ease-in-out infinite}
      .ca-orbit{animation:ca-orbit-soft 15s ease-in-out infinite}
      .ca-orbit-delayed{animation:ca-orbit-soft 20s ease-in-out infinite reverse}
      .ca-reveal-ready{opacity:0;transform:translateY(22px);transition:opacity .65s ease,transform .65s cubic-bezier(.2,.75,.2,1)}
      .ca-reveal-ready.ca-in-view,.ca-reveal-ready:focus-within{opacity:1;transform:translateY(0)}
      @media(prefers-reduced-motion:reduce){.ca-reveal-ready{opacity:1;transform:none;transition:none}}
      .ca-motion-card{transition:transform .45s cubic-bezier(.2,.75,.2,1),box-shadow .45s ease}
      @media (hover:hover) and (pointer:fine){.ca-motion-card:hover{transform:translateY(-9px) rotateX(2deg);box-shadow:0 28px 65px rgba(31,28,73,.12)}}
      @media (prefers-reduced-motion:reduce){.ca-entrance,.ca-photo-card,.ca-float-a,.ca-float-b,.ca-orbit,.ca-orbit-delayed{animation:none!important}.ca-hero-tilt,.ca-motion-card{transform:none!important;transition:none!important}}
    `}</style>
    <main>
      <section className="ca-home-hero relative isolate overflow-hidden bg-gradient-to-br from-white via-[#fafdff] to-[#eaf5ff]">
        <header className="absolute inset-x-0 top-0 z-40">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-4 sm:px-8 lg:py-6">
            <a href="/website" aria-label="CallingAgent home" className="block w-[196px] shrink-0 rounded-md bg-black px-2 py-1.5 sm:w-[226px]"><img src="/callingagent-logo-tight.webp" alt="CallingAgent" className="block h-auto w-full" loading="eager"/></a>
            <button type="button" aria-label={menuOpen?"Close navigation":"Open navigation"} aria-expanded={menuOpen} aria-controls="ca-hero-menu" onClick={()=>setMenuOpen(v=>!v)} className="flex h-11 w-11 items-center justify-center rounded-full border border-blue-100 bg-white/90 text-[#102549] shadow-sm backdrop-blur-md transition hover:bg-blue-50">{menuOpen?<X className="h-6 w-6"/>:<Menu className="h-6 w-6"/>}</button>
          </div>
          {menuOpen&&<nav id="ca-hero-menu" aria-label="Website navigation" className="absolute right-5 top-[76px] flex w-[min(310px,calc(100vw-40px))] flex-col gap-1 rounded-2xl border border-blue-100 bg-white p-3 text-sm font-semibold text-[#12284b] shadow-2xl sm:right-8 lg:top-[88px]">
            <a href="#benefits" onClick={()=>setMenuOpen(false)} className="rounded-xl px-4 py-3 hover:bg-blue-50">Features</a>
            <a href="#realtor-demo" onClick={()=>setMenuOpen(false)} className="rounded-xl px-4 py-3 hover:bg-blue-50">Watch demo</a>
            <a href="#how-ai-works" onClick={()=>setMenuOpen(false)} className="rounded-xl px-4 py-3 hover:bg-blue-50">How it works</a>
            <a href="/business-phone" className="rounded-xl px-4 py-3 hover:bg-blue-50">Business Phone</a>
            <a href="#ai-inquiry" onClick={()=>setMenuOpen(false)} className="rounded-xl px-4 py-3 hover:bg-blue-50">Pricing / Early access</a>
            <a href="#ai-faq" onClick={()=>setMenuOpen(false)} className="rounded-xl px-4 py-3 hover:bg-blue-50">Questions & answers</a>
            <a href="/login" className="rounded-xl px-4 py-3 hover:bg-blue-50">Sign in</a>
          </nav>}
        </header>

        {/* Unified hero: responsive artwork is a background, not a second photo card. */}
        <div className="ca-home-art pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
          <img src="/callingagent-clean-hero.webp" alt="" className="absolute inset-0 h-full w-full object-cover object-[72%_center] md:object-[78%_center]" loading="eager" fetchPriority="high" decoding="async"/>
          <div className="absolute inset-0 bg-gradient-to-b from-white via-white/95 via-[53%] to-white/0 md:bg-gradient-to-r md:from-white md:via-white/95 md:via-[40%] md:to-white/0"/>
        </div>
        <div className="ca-home-content relative z-10 mx-auto flex max-w-7xl flex-col px-5 pb-6 pt-6 sm:px-8 md:min-h-[670px] md:justify-center md:pb-24 md:pt-32 lg:min-h-[735px]">
          <div className="ca-entrance max-w-xl lg:max-w-[53%]">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#e7f1ff]/95 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[.12em] text-[#1253a9]"><span className="h-2 w-2 rounded-full bg-blue-500"/> AI phone answering for businesses</span>
            <h1 className="mt-5 text-[clamp(2.45rem,5.2vw,5.7rem)] font-black leading-[1.06] tracking-[-.055em] text-[#091d43]">Your AI receptionist that never misses <span className="text-[#0876ed]">a call.</span></h1>
            <p className="mt-5 max-w-lg text-base leading-7 text-slate-600 sm:text-lg">Designed to help answer customers, collect inquiries and appointment requests, and give your team more time to focus on business.</p>
            <div className="ca-home-actions mt-6 flex flex-wrap gap-3"><a href="#ai-inquiry" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#0a9efe] to-[#0757e5] px-6 py-3.5 text-sm font-extrabold text-white shadow-[0_12px_28px_rgba(22,104,226,.18)] hover:brightness-110">Request early access <ArrowRight className="h-5 w-5"/></a><a href="#realtor-demo" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#aac0df] bg-white px-5 py-3.5 text-sm font-bold text-[#102549] hover:bg-blue-50">Watch demo</a></div>
            <div className="mt-6 grid max-w-lg grid-cols-3 gap-3 border-t border-blue-100 pt-4">{[[PhoneCall,"Answer calls"],[Clock3,"Appointments"],[Sparkles,"Capture leads"]].map(([Icon,title])=><div key={String(title)} className="flex flex-col gap-2 text-blue-600"><Icon className="h-6 w-6"/><span className="text-[11px] font-bold leading-4 text-[#14284d]">{title}</span></div>)}</div>
            <p className="mt-4 max-w-lg text-xs leading-5 text-slate-500">Early-access inquiries only. Standalone AI planned from $99 CAD/month, plus taxes and usage credits. No payment is taken yet.</p>
          </div>
          <div className="ca-home-status mt-auto flex justify-end pb-1 md:absolute md:bottom-14 md:right-9">
            <div className="flex max-w-[210px] items-center gap-2.5 rounded-2xl border border-blue-100 bg-white/90 px-3 py-2.5 shadow-lg shadow-blue-900/10 backdrop-blur-md"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#e9f3ff] text-blue-600"><Check className="h-5 w-5"/></span><div><p className="text-xs font-extrabold text-[#102549]">Request organized</p><p className="text-[10px] text-slate-500">Illustrative AI workflow</p></div></div>
          </div>
        </div>
        <div className="border-t border-[#e2eefb] bg-white/90"><div className="mx-auto grid max-w-7xl grid-cols-2 gap-5 px-5 py-7 sm:grid-cols-4 sm:px-8">{[[Clock3,"Save time","Fewer interruptions"],[Sparkles,"New opportunities","Capture inquiries"],[ShieldCheck,"Professional welcome","Consistent experience"],[PhoneCall,"Business phone","Explore call handling"]].map(([Icon,title,subtitle])=><div key={String(title)} className="flex items-start gap-2.5"><Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#0876ed]"/><div><p className="text-xs font-extrabold text-[#102549] sm:text-sm">{title}</p><p className="mt-1 text-[11px] leading-4 text-slate-500">{subtitle}</p></div></div>)}</div></div>
      </section>
      <div className="border-y border-blue-100 bg-[#eaf4ff] px-5 py-4 text-center text-sm font-semibold text-[#123963] sm:px-8">
        <p>Explore the AI receptionist concept below. <strong>Early access is open; paid AI activation is not yet available.</strong></p>
      </div>
      <section id="realtor-demo" className="scroll-mt-20 bg-[#071b3b] py-14 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <p className="text-xs font-black uppercase tracking-[.2em] text-sky-300">Watch the receptionist experience</p>
              <h2 className="mt-3 text-[clamp(2.2rem,4vw,4.2rem)] font-black leading-tight tracking-tight">From incoming call to <span className="text-sky-300">qualified real estate lead.</span></h2>
              <p className="mt-4 text-base leading-7 text-blue-100">See a sample buyer inquiry, a showing request, appointment confirmation by text and email, and the information organized for an agent.</p>
            </div>
            <a href="#ai-inquiry" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-[#1687ff] px-6 py-3 text-sm font-extrabold text-white hover:bg-blue-500">Request early access <ArrowRight className="h-4 w-4"/></a>
          </div>
          <div className="mt-8 overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#102c58] shadow-[0_30px_90px_rgba(0,0,0,.22)]">
            <video controls playsInline preload="none" poster="/callingagent-approved-appointments.webp" className="block aspect-video w-full bg-[#08172e] object-contain" aria-label="Illustrative CallingAgent realtor lead conversion demo: call, showing request, confirmation, agent follow-up">
              <source src="/callingagent-realtor-lead-demo.mp4" type="video/mp4"/>
              Your browser does not support video playback.
            </video>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">{["Buyer calls","Showing requested","Text + email confirmed","Lead sent to agent"].map((item,i)=><div key={item} className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-4 py-3"><span className="text-xl font-black text-sky-300">{String(i+1).padStart(2,"0")}</span><span className="text-sm font-semibold">{item}</span></div>)}</div>
          <p className="mt-4 text-xs leading-6 text-blue-200">Illustrative demonstration of a planned workflow. Availability of booking, text and email integrations must be confirmed during setup. This video does not show a live customer account.</p>
        </div>
      </section>
      <section id="benefits" className="scroll-mt-20 bg-white py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div data-ca-reveal className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">Make every call count</p><h2 className="mt-3 text-[clamp(2.2rem,4.3vw,4.4rem)] font-black leading-[1.08] tracking-[-.05em] text-[#09204a]">Missed calls shouldn't mean <span className="text-blue-600">missed opportunities.</span></h2><p className="mt-4 text-base leading-7 text-slate-600">See how a caller's request could become a clear next action.</p></div>
          <div data-ca-reveal className="mt-8 overflow-hidden rounded-[1.8rem] bg-[#0a234d] shadow-[0_28px_70px_rgba(4,38,88,.15)]"><img src="/callingagent-approved-call-summary.webp" width="1400" height="788" alt="Approved CallingAgent concept: incoming call on a phone becomes a structured follow-up summary on a laptop" className="block h-auto w-full" loading="lazy" decoding="async"/><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-500">Illustrative preview</span><a href="/callingagent-approved-call-summary.webp" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 font-extrabold text-blue-700 hover:bg-blue-50" aria-label="Open full size Call summary image">View full-size image <ArrowRight className="ml-1 h-3.5 w-3.5"/></a></div></div>
          <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><h3 className="text-2xl font-black text-[#0b244b]">A better way to handle inquiries.</h3><p className="mt-1 text-sm text-slate-600">From first hello to a request your team can review.</p></div><a href="#ai-inquiry" className="inline-flex min-h-12 items-center justify-center gap-2 self-start rounded-full bg-[#0869ed] px-6 py-3 text-sm font-extrabold text-white hover:bg-blue-800">Get early access <ArrowRight className="h-4 w-4"/></a></div>
        </div>
      </section>
      <section className="bg-[#eef6ff] py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><div data-ca-reveal className="mb-8 max-w-2xl"><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">A clearer picture</p><h2 className="mt-3 text-3xl font-black tracking-tight text-[#09204a] sm:text-5xl">Your call inbox, <span className="text-blue-600">organized.</span></h2><p className="mt-3 text-base text-slate-600">New leads. Callback requests. Appointment interest.</p></div>
          <div data-ca-reveal className="overflow-hidden rounded-[1.8rem] bg-white shadow-[0_24px_65px_rgba(10,55,125,.12)]"><img src="/callingagent-approved-inbox.webp" width="1400" height="788" alt="Approved concept image showing an organized CallingAgent inbox with caller requests and follow-up actions" className="block h-auto w-full" loading="lazy" decoding="async"/><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-500">Illustrative preview</span><a href="/callingagent-approved-inbox.webp" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 font-extrabold text-blue-700 hover:bg-blue-50" aria-label="Open full size Inquiry inbox image">View full-size image <ArrowRight className="ml-1 h-3.5 w-3.5"/></a></div></div>
          <p className="mt-4 text-xs text-slate-500">Illustrative dashboard design. Sample metrics and contacts are fictional; this is not a live account screenshot.</p>
        </div>
      </section>
      <section id="how-ai-works" className="scroll-mt-20 bg-[#09214a] py-14 text-white sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><div data-ca-reveal className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[.2em] text-sky-300">How it could work</p><h2 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">One call. <span className="text-sky-300">Three simple steps.</span></h2><p className="mt-3 text-base text-blue-100">Answer. Understand. Organize.</p></div>
          <div data-ca-reveal className="mt-8 overflow-hidden rounded-[1.7rem] border border-white/15 bg-[#081a38]"><img src="/callingagent-approved-workflow.webp" width="1400" height="717" alt="Approved CallingAgent concept dashboard visualizing caller request, AI response, and organized result" className="block h-auto w-full" loading="lazy" decoding="async"/><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-500">Illustrative preview</span><a href="/callingagent-approved-workflow.webp" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 font-extrabold text-blue-700 hover:bg-blue-50" aria-label="Open full size Call workflow image">View full-size image <ArrowRight className="ml-1 h-3.5 w-3.5"/></a></div></div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">{[["01","Welcome the caller"],["02","Understand the request"],["03","Prepare the next step"]].map(([n,title])=><div key={n} className="flex items-center gap-3 rounded-xl border border-white/15 bg-white/5 px-5 py-4"><span className="text-xl font-black text-sky-300">{n}</span><span className="text-sm font-semibold text-white">{title}</span></div>)}</div>
          <p className="mt-4 text-xs text-blue-200">Concept illustration; activation, capabilities, and integrations will be confirmed before purchase.</p>
        </div>
      </section>
      <section className="bg-white py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><div data-ca-reveal className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">Everything in view</p><h2 className="mt-3 text-3xl font-black tracking-tight text-[#09204a] sm:text-5xl">Keep your team <span className="text-blue-600">in the loop.</span></h2><p className="mt-3 text-base text-slate-600">One place to review leads, calls, and follow-ups.</p></div>
          <div data-ca-reveal className="mt-8 overflow-hidden rounded-[1.8rem] shadow-[0_25px_65px_rgba(12,57,115,.12)]"><img src="/callingagent-approved-dashboard.webp" width="1400" height="788" alt="Approved CallingAgent concept of a dashboard and phone showing calls, new inquiries, appointments, and follow-up tasks" className="block h-auto w-full" loading="lazy" decoding="async"/><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-500">Illustrative preview</span><a href="/callingagent-approved-dashboard.webp" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 font-extrabold text-blue-700 hover:bg-blue-50" aria-label="Open full size Team dashboard image">View full-size image <ArrowRight className="ml-1 h-3.5 w-3.5"/></a></div></div>
        </div>
      </section>
      <section className="bg-[#eef6ff] py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><div data-ca-reveal className="max-w-3xl"><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">Turn interest into action</p><h2 className="mt-3 text-3xl font-black tracking-tight text-[#09204a] sm:text-5xl">Make room for <span className="text-blue-600">more appointments.</span></h2><p className="mt-3 text-base text-slate-600">Explore an organized booking-request experience.</p></div>
          <div data-ca-reveal className="mt-8 overflow-hidden rounded-[1.8rem] shadow-[0_25px_65px_rgba(12,57,115,.12)]"><img src="/callingagent-approved-appointments.webp" width="1400" height="788" alt="Approved CallingAgent concept showing an appointment request and sample calendar on laptop and phone" className="block h-auto w-full" loading="lazy" decoding="async"/><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-500">Illustrative preview</span><a href="/callingagent-approved-appointments.webp" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 font-extrabold text-blue-700 hover:bg-blue-50" aria-label="Open full size Appointment request image">View full-size image <ArrowRight className="ml-1 h-3.5 w-3.5"/></a></div></div>
          <p className="mt-4 text-xs text-slate-500">Sample appointments and calendar are illustrations; direct booking functionality is not guaranteed.</p>
        </div>
      </section>
      <section className="bg-[#071a38] py-14 sm:py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-8"><div data-ca-reveal className="mb-7 max-w-2xl"><p className="text-xs font-black uppercase tracking-[.2em] text-sky-300">Designed for the way you work</p><h2 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-5xl">Made for <span className="text-sky-300">your business.</span></h2></div>
          <div data-ca-reveal className="overflow-hidden rounded-[1.7rem] border border-white/10"><img src="/callingagent-approved-industries.webp" width="1400" height="788" alt="Approved image showing potential AI receptionist use cases in real estate, clinics, home services, and professional offices" className="block h-auto w-full" loading="lazy" decoding="async"/><div className="mt-3 flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-slate-500">Illustrative preview</span><a href="/callingagent-approved-industries.webp" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-200 bg-white px-4 py-2 font-extrabold text-blue-700 hover:bg-blue-50" aria-label="Open full size Business examples image">View full-size image <ArrowRight className="ml-1 h-3.5 w-3.5"/></a></div></div>
          <p className="mt-4 text-xs text-blue-200">Illustrative business examples. Industry-specific capabilities will be confirmed during setup.</p>
        </div>
      </section>
      <section className="bg-white py-12 sm:py-16">
        <div data-ca-reveal className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-5 sm:px-8 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">Also available</p><h2 className="mt-2 text-2xl font-black text-[#09204a] sm:text-3xl">Need a complete business phone system?</h2><p className="mt-2 text-sm text-slate-600">Explore CallingAgent's existing VoIP phone options.</p></div><a href="/business-phone" className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-6 py-3 text-sm font-extrabold text-blue-700 hover:bg-blue-100">Explore Business Phone <ArrowRight className="h-4 w-4"/></a></div>
      </section>
      <section id="ai-faq" className="bg-[#f7faff] py-14 sm:py-20">
        <div className="mx-auto max-w-5xl px-5 sm:px-8">
          <div data-ca-reveal className="max-w-2xl"><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">Before you join</p><h2 className="mt-3 text-3xl font-black tracking-tight text-[#09204a] sm:text-5xl">Questions? <span className="text-blue-600">Clear answers.</span></h2></div>
          <div className="mt-7 divide-y divide-blue-100 overflow-hidden rounded-[1.5rem] border border-blue-100 bg-white">
            {[
              ["Can I buy the AI receptionist today?","Not yet. This form is an early-access inquiry. We will contact you when AI plans and activation options are ready."],
              ["Is the $99 monthly price final?","$99 CAD/month is a planned starting price, not a checkout offer. Usage credits, taxes, included allowances and final terms will be confirmed before purchase."],
              ["Will I be charged if I join the list?","No. Requesting early access does not take payment or create a paid subscription."],
              ["Do you offer a regular business phone system?","Yes. Visit Business Phone to explore VoIP options. Availability and activation terms are shown separately from the planned standalone AI package."]
            ].map(([q,a])=><details key={q} className="group px-5 py-5 open:bg-[#f8fbff] sm:px-8"><summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-extrabold text-[#102549] sm:text-lg">{q}<ChevronDown className="h-5 w-5 shrink-0 text-blue-600 transition-transform group-open:rotate-180"/></summary><p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{a}</p></details>)}
          </div>
        </div>
      </section>
      <section id="ai-inquiry" className="scroll-mt-20 bg-gradient-to-br from-[#e6f3ff] to-white py-14 sm:py-20">
        <div className="mx-auto grid max-w-7xl items-start gap-8 px-5 sm:px-8 lg:grid-cols-[.84fr_1.16fr] lg:gap-16">
          <div data-ca-reveal className="lg:pt-7"><p className="text-xs font-black uppercase tracking-[.2em] text-blue-600">Get on the list</p><h2 className="mt-4 text-[clamp(2.4rem,4vw,4.2rem)] font-black leading-[1.1] tracking-[-.05em] text-[#09204a]">Be ready for <span className="text-blue-600">your next opportunity.</span></h2><p className="mt-4 text-base leading-7 text-slate-600">Request early access and we'll contact you when AI setup options are available.</p>
            <div className="mt-8 rounded-[1.5rem] border border-blue-100 bg-white p-6 shadow-sm"><div className="flex items-baseline gap-2"><span className="text-6xl font-black text-blue-600">$99</span><span className="font-bold text-[#09204a]">CAD / month</span></div><p className="mt-2 text-sm font-semibold text-slate-600">Planned starting price · usage credits and taxes separate</p><div className="mt-5 grid gap-3 border-t border-blue-100 pt-5">{["No payment today","Early-access inquiry only","Final terms confirmed before purchase"].map(item=><p key={item} className="flex items-center gap-3 text-sm font-bold text-[#102549]"><Check className="h-5 w-5 shrink-0 text-emerald-600"/>{item}</p>)}</div></div>
          </div><div data-ca-reveal><AiSalesInquiry/></div>
        </div>
      </section>
    </main>
    <div className="border-t border-slate-200 bg-white px-5 py-6 text-center text-xs text-slate-500"><p>© {new Date().getFullYear()} CallingAgent · <a href="/business-phone" className="text-sky-700 underline">Business Phone</a> · <a href="/login" className="text-sky-700 underline">Account sign in</a></p><p className="mt-2">Visual concepts illustrate planned AI functionality. Features and paid activation are subject to availability. · Website design 2026-11-26-R</p></div>
  </div>;
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
  if(!isPhone)return <AiLanding />;
  return <div className="min-h-screen bg-[#f7faff] text-[#0a1830]">
    <div className="border-b border-blue-100 bg-[#eef4ff]">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-2 text-[11px] font-semibold text-blue-900 sm:px-8">
        <span>CALLINGAGENT · PUBLIC WEBSITE</span>
        <a href="/login" className="text-indigo-700 underline-offset-4 hover:underline">Existing customer? Open account area →</a>
      </div>
    </div>
    <header className="sticky top-0 z-30 border-b border-blue-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <a href="/website" className="flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight sm:text-xl"><span className="rounded-xl bg-blue-600 p-2 text-white"><PhoneCall className="h-5 w-5"/></span>CALLING<span className="text-blue-600">AGENT</span></a>
        <nav className="hidden items-center gap-4 text-sm font-semibold text-slate-600 lg:flex xl:gap-7" aria-label="Public services"><a href="/website" aria-current={!isPhone?"page":undefined} className={!isPhone?"rounded-lg bg-violet-50 px-3 py-2 text-violet-800":"hover:text-violet-700"}>AI Receptionist</a><a href="/business-phone" aria-current={isPhone?"page":undefined} className={isPhone?"rounded-lg bg-blue-50 px-3 py-2 text-blue-800":"hover:text-blue-700"}>Business Phone</a><a href="#how-it-works" className="hover:text-blue-600">How it works</a><a href={isPhone?"#pricing":"#ai-inquiry"} className="hover:text-blue-600">{isPhone?"Phone Plans":"AI Early Access"}</a><a href="#faq" className="hover:text-blue-600">FAQ</a></nav>
        <div className="hidden items-center gap-3 lg:flex"><a href="/login" className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-bold hover:bg-slate-50">Sign in</a><a href={isPhone?"/business-phone#pricing":"/website#ai-inquiry"} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-800">{isPhone?<PhoneCall className="h-4 w-4"/>:<Bot className="h-4 w-4"/>}{isPhone?"View phone plans":"AI early access"}</a></div>
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
