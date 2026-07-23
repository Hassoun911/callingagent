import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Bot, ChevronDown, ChevronUp, Lightbulb, X } from "lucide-react";

interface GuideContent {
  title: string;
  intro: string;
  steps: string[];
}

function guideFor(location: string, companyId: number | null): GuideContent {
  if (!companyId) {
    return {
      title: "Start by choosing a company",
      intro: "Company-specific pages stay hidden until you select the company you want to manage.",
      steps: [
        "Open All Companies.",
        "Select the company you want to work on.",
        "Use Setup Overview to see what is complete and what still needs attention.",
      ],
    };
  }

  if (location === "/company-setup") {
    return {
      title: "Complete the setup checklist",
      intro: "Open every item marked Needs attention or Not configured before relying on live customer calls.",
      steps: [
        "Click a checklist card to expand it.",
        "Read What is missing and How to fix it.",
        "Use the action button to open the exact setup page.",
        "Return here and press Refresh after saving changes.",
      ],
    };
  }

  if (location === "/settings") {
    return {
      title: "Configure the AI agent",
      intro: "This page controls what the agent says and how it handles callers.",
      steps: [
        "Add the Initial Greeting callers hear first.",
        "Confirm the speaking style matches the business.",
        "Enter services, prices, hours, emergency rules, booking rules, and escalation instructions.",
        "Save changes, then place a test call.",
      ],
    };
  }

  if (location === "/bookings/setup") {
    return {
      title: "Configure booking and availability",
      intro: "The AI can only confirm appointments that match the services, resources, and hours entered here.",
      steps: [
        "Add each bookable staff member, technician, chair, room, table, or vehicle.",
        "Add services with duration and buffers.",
        "Enter working hours, breaks, and time off.",
        "Assign which resources can perform each service.",
        "Save company booking rules.",
      ],
    };
  }

  if (location === "/bookings/import") {
    return {
      title: "Review imported booking suggestions",
      intro: "Nothing changes until you approve the draft.",
      steps: [
        "Analyze AI Settings.",
        "Review detected resources, services, hours, and booking rules.",
        "Remove or correct anything inaccurate.",
        "Apply and Merge, then verify the Booking & Availability page.",
      ],
    };
  }

  if (location === "/bookings") {
    return {
      title: "Manage appointments",
      intro: "Use this page for confirmed, pending, cancelled, and rescheduled bookings.",
      steps: [
        "Check today’s appointments and pending approvals.",
        "Confirm the assigned resource, service, time, location, and quoted price.",
        "Update or cancel the booking when the customer requests a change.",
      ],
    };
  }

  if (location === "/calls") {
    return {
      title: "Review call activity",
      intro: "Use call logs to confirm the AI handled the caller correctly.",
      steps: [
        "Open recent calls and listen to recordings when needed.",
        "Review the summary, priority, action required, and booking result.",
        "Follow up on emergencies, missed calls, and unresolved requests.",
      ],
    };
  }

  if (location === "/messages") {
    return {
      title: "Manage customer messages",
      intro: "Review inbound SMS and confirmation messages for this company.",
      steps: [
        "Open unread conversations first.",
        "Confirm appointment and price details are correct.",
        "Escalate messages the AI could not resolve.",
      ],
    };
  }

  if (location === "/leads") {
    return {
      title: "Work the lead queue",
      intro: "Prioritize callers who requested action or showed buying intent.",
      steps: [
        "Start with high-priority and emergency leads.",
        "Review the call summary and requested action.",
        "Assign an owner and record the follow-up result.",
      ],
    };
  }

  if (location.startsWith("/numbers/")) {
    return {
      title: "Verify the phone line",
      intro: "The number must point to the correct company and live webhook URLs.",
      steps: [
        "Confirm the phone number belongs to the correct company.",
        "Check answer mode, forwarding, voicemail, and status callbacks.",
        "Place a test call and confirm the call appears in Call Logs.",
      ],
    };
  }

  if (location === "/campaigns") {
    return {
      title: "Configure the campaign safely",
      intro: "Confirm the company, phone line, audience, script, schedule, and limits before starting.",
      steps: [
        "Choose the correct phone line.",
        "Upload or select the contact list.",
        "Review the campaign script and opt-out handling.",
        "Run a small test before launching the full campaign.",
      ],
    };
  }

  if (location.startsWith("/companies/")) {
    return {
      title: "Complete the company profile",
      intro: "This page controls company details, phone assignment, extensions, and portal users.",
      steps: [
        "Confirm business name, industry, and contact details.",
        "Link the correct phone number.",
        "Create at least one Company Admin account.",
        "Open Setup Overview to continue the remaining setup.",
      ],
    };
  }

  return {
    title: "What to do next",
    intro: "Use Setup Overview for the selected company whenever you are unsure what remains.",
    steps: [
      "Open Setup Overview.",
      "Complete items marked Needs attention or Not configured.",
      "Run a test call after setup changes.",
    ],
  };
}

function readStoredBoolean(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

export function ContextualGuide() {
  const [location] = useLocation();
  const [open, setOpen] = useState(() => readStoredBoolean("callingagent-guide-open", true));
  const [hidden, setHidden] = useState(() => readStoredBoolean("callingagent-guide-hidden", false));
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);

  const companyId = useMemo(() => {
    const queryId = Number(new URLSearchParams(window.location.search).get("companyId") || 0);
    const companyMatch = location.match(/^\/companies\/(\d+)/);
    return queryId || (companyMatch ? Number(companyMatch[1]) : null);
  }, [location]);

  const guide = guideFor(location, companyId);

  useEffect(() => {
    const updateViewport = () => setIsMobile(window.innerWidth < 640);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("callingagent-guide-open", String(open)); } catch {}
  }, [open]);

  useEffect(() => {
    try { window.localStorage.setItem("callingagent-guide-hidden", String(hidden)); } catch {}
  }, [hidden]);

  useEffect(() => {
    if (isMobile) setOpen(false);
  }, [location, isMobile]);

  if (hidden) {
    return (
      <button
        onClick={() => { setHidden(false); setOpen(true); }}
        className="fixed z-40 flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-xl hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 sm:bottom-5 sm:right-5"
        aria-label="Open CallingAgent Guide"
      >
        <Bot className="h-4 w-4" />
        <span className="hidden min-[380px]:inline">What should I do?</span>
        <span className="min-[380px]:hidden">Help</span>
      </button>
    );
  }

  return (
    <aside
      className="fixed z-40 overflow-hidden border border-primary/30 bg-card shadow-2xl left-0 right-0 bottom-0 rounded-t-2xl max-h-[82dvh] sm:left-auto sm:right-5 sm:bottom-5 sm:w-[360px] sm:max-w-[calc(100vw-2rem)] sm:rounded-xl sm:max-h-[calc(100vh-2.5rem)]"
      aria-label="CallingAgent contextual guide"
    >
      <div className="flex items-center gap-2.5 border-b border-primary/20 bg-primary/10 px-3 py-3 sm:gap-3 sm:px-4">
        <div className="h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0"><Bot className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-primary">CallingAgent Guide</div>
          <div className="text-sm font-semibold truncate">{guide.title}</div>
        </div>
        <button
          onClick={() => setOpen(current => !current)}
          className="h-10 w-10 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
          aria-label={open ? "Collapse guide" : "Expand guide"}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        <button
          onClick={() => setHidden(true)}
          className="h-10 w-10 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-primary"
          title="Hide guide"
          aria-label="Hide guide"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <div className="overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 sm:max-h-[60vh]">
          <p className="text-sm text-muted-foreground leading-relaxed">{guide.intro}</p>
          <ol className="space-y-2.5">
            {guide.steps.map((step, index) => (
              <li key={index} className="flex items-start gap-2 text-sm sm:text-xs leading-relaxed">
                <span className="h-6 w-6 sm:h-5 sm:w-5 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 text-[11px] sm:text-[10px] font-bold">{index + 1}</span>
                <span className="pt-0.5 text-foreground/90">{step}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-start gap-2 rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
            <Lightbulb className="h-4 w-4 text-amber-300 flex-shrink-0" />
            <span>The guide changes automatically based on the page and selected company.</span>
          </div>
        </div>
      )}
    </aside>
  );
}
