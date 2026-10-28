import { PhoneCall, ArrowUpRight, Mail, ShieldCheck, Headphones, ArrowRight } from "lucide-react";

type FooterProps = { compact?: boolean };
export default function SiteFooter({ compact = false }: FooterProps) {
  if (compact) return (
    <footer className="mt-8 border-t border-slate-200/80 pt-5 pb-3 text-xs text-muted-foreground" aria-label="Dashboard footer">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} CallingAgent. Business communications made simple.</span>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href="/" className="hover:text-primary">Website</a>
          <a href="/#pricing" className="hover:text-primary">Plans</a>
          <a href="/#faq" className="hover:text-primary">Help & FAQ</a>
        </div>
      </div>
    </footer>
  );
  return (
    <footer className="relative overflow-hidden border-t border-blue-100 bg-gradient-to-br from-white via-[#f6faff] to-[#eef7fc] text-[#10243b]" aria-label="CallingAgent footer">
      <div className="mx-auto max-w-7xl px-5 pt-14 pb-7 sm:px-8">
        <div className="grid gap-10 border-b border-slate-200/80 pb-12 md:grid-cols-[1.5fr_1fr_1fr_1.1fr]">
          <div className="max-w-sm">
            <a href="/" className="inline-flex items-center gap-2 text-xl font-extrabold tracking-tight">
              <span className="rounded-xl bg-blue-600 p-2.5 text-white shadow-sm"><PhoneCall className="h-5 w-5" /></span>
              Calling<span className="text-blue-600">Agent</span>
            </a>
            <p className="mt-5 text-sm leading-7 text-slate-600">
              A better way to manage business calls. Canadian phone numbers, call forwarding, voicemail, and AI options when you need them.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
              <ShieldCheck className="h-4 w-4" /> Clear packages. Control your calling costs.
            </div>
          </div>
          <div>
            <h3 className="text-sm font-bold">Explore</h3>
            <nav className="mt-5 flex flex-col items-start gap-3 text-sm text-slate-600" aria-label="Footer site navigation">
              <a href="/#services" className="transition-colors hover:text-blue-700">Features</a>
              <a href="/#how-it-works" className="transition-colors hover:text-blue-700">How it works</a>
              <a href="/#pricing" className="transition-colors hover:text-blue-700">Packages & pricing</a>
              <a href="/#faq" className="transition-colors hover:text-blue-700">Questions & answers</a>
            </nav>
          </div>
          <div>
            <h3 className="text-sm font-bold">Your CallingAgent</h3>
            <nav className="mt-5 flex flex-col items-start gap-3 text-sm text-slate-600" aria-label="Footer account navigation">
              <a href="/login" className="transition-colors hover:text-blue-700">Account sign in</a>
              <a href="/#pricing" className="transition-colors hover:text-blue-700">Choose a plan</a>
              <a href="/#services" className="transition-colors hover:text-blue-700">Business phone numbers</a>
              <a href="/#services" className="transition-colors hover:text-blue-700">AI receptionist options</a>
            </nav>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-white/85 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold"><Headphones className="h-5 w-5 text-blue-600"/> Need help choosing?</div>
            <p className="mt-3 text-sm leading-6 text-slate-600">Find the right number and monthly minute allowance for your business.</p>
            <a href="/#pricing" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#006a5c] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#005447]">Compare plans <ArrowRight className="h-4 w-4"/></a>
          </div>
        </div>
        <div className="flex flex-col gap-3 pt-6 text-xs leading-relaxed text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} CallingAgent. All rights reserved.</span>
          <span className="max-w-xl sm:text-right">Canadian-dollar prices shown for planning. Online checkout and automated activation are not yet available.</span>
        </div>
      </div>
    </footer>
  );
}
