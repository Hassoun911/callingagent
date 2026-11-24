import type {ReactNode} from "react";
import {ArrowLeft, Bot, LockKeyhole, PhoneCall} from "lucide-react";

/**
 * Consistent secondary-page identity for guest-facing signup, plan selection
 * and sign-in. Marketing navigation stays on the public website, while
 * account and setup actions live in their own visually distinct shell.
 * This only wraps UI: authorization and billing gates remain server-owned.
 */
export default function PublicAccountShell({children,section="Account & setup"}:{
  children:ReactNode;section?:string
}){
  return <div className="min-h-screen bg-[#f3f6fc]">
    <div className="border-b border-slate-200 bg-[#101c3d] text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] font-semibold sm:px-8">
        <span className="inline-flex items-center gap-2 tracking-wide"><LockKeyhole className="h-3.5 w-3.5 text-violet-300"/> CALLINGAGENT ACCOUNT AREA</span>
        <a href="/website" className="inline-flex items-center gap-1.5 text-blue-100 underline-offset-4 hover:text-white hover:underline"><ArrowLeft className="h-3.5 w-3.5"/> Back to public website</a>
      </div>
    </div>
    <header className="border-b border-slate-200 bg-white shadow-sm">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-8">
        <a href="/website" className="inline-flex shrink-0 items-center gap-2 text-base font-extrabold tracking-tight text-[#101c3d] sm:text-xl" aria-label="CallingAgent public website">
          <span className="rounded-lg bg-blue-600 p-2 text-white"><PhoneCall className="h-4 w-4"/></span>Calling<span className="-ml-2 text-blue-600">Agent</span>
        </a>
        <span className="hidden text-sm font-semibold text-slate-600 sm:block">{section}</span>
        <nav className="flex items-center gap-2 text-xs font-semibold sm:text-sm" aria-label="Account and website navigation">
          <a href="/website#pricing" className="hidden rounded-lg px-3 py-2 text-slate-700 hover:bg-slate-100 md:inline-flex">Phone plans</a>
          <a href="/website#ai" className="hidden items-center gap-1 rounded-lg px-3 py-2 text-violet-700 hover:bg-violet-50 md:inline-flex"><Bot className="h-4 w-4"/> AI Receptionist</a>
          <a href="/login" className="rounded-lg border border-slate-200 px-3 py-2 text-slate-800 hover:bg-slate-50">Sign in</a>
        </nav>
      </div>
    </header>
    <div className="border-b border-blue-100 bg-blue-50/75 px-4 py-2 text-center text-xs font-medium text-slate-700">
      {section} · Business Phone and AI Receptionist services are selected from the public website.
    </div>
    {children}
  </div>;
}
