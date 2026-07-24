import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { ContextualGuide } from "@/components/contextual-guide";
import CompanyPortal from "@/pages/company-portal";

import Dashboard from "@/pages/dashboard";
import Numbers from "@/pages/numbers";
import NumberDetail from "@/pages/number-detail";
import Calls from "@/pages/calls";
import Contacts from "@/pages/contacts";
import Companies from "@/pages/companies";
import CompanyDetail from "@/pages/company-detail";
import CompanySetupOverview from "@/pages/company-setup-overview";
import Settings from "@/pages/settings";
import Billing from "@/pages/billing";
import Messages from "@/pages/messages";
import Campaigns from "@/pages/campaigns";
import CampaignDetail from "@/pages/campaign-detail";
import NotFound from "@/pages/not-found";
import Bookings from "@/pages/bookings";
import BookingSetupEntry from "@/pages/booking-setup-entry";
import BookingAiImport from "@/pages/booking-ai-import";
import Leads from "@/pages/leads";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export interface AuthUser {
  id: string;
  firstName: string | null;
  email: string | null;
  role: "super_admin" | "company_admin" | "company_user";
  companyId: number | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  logout: () => Promise<void>;
  refetch: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  logout: async () => {},
  refetch: async () => {},
});

export function useAuthContext() {
  return useContext(AuthContext);
}

function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/user", { credentials: "include" });
      const data = await res.json();
      setUser(data.user ?? null);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    setUser(null);
  }, []);

  return { user, isLoading, isAuthenticated: !!user, logout, refetch: checkAuth };
}

function AnimatedLogo() {
  return (
    <>
      <style>{`
        @keyframes ca-reveal {
          0%   { clip-path: inset(0 calc(100% - 62px) 0 0); }
          100% { clip-path: inset(0 0% 0 0); }
        }
        @keyframes ca-fade-in {
          0%   { opacity: 0; transform: scale(0.92); }
          100% { opacity: 1; transform: scale(1); }
        }
        .ca-logo {
          display: block;
          width: min(300px, 78vw);
          max-width: 100%;
          height: auto;
          animation: ca-fade-in 0.25s ease-out 0s both,
                     ca-reveal 0.75s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both;
        }
        @media (prefers-reduced-motion: reduce) {
          .ca-logo { animation: none; }
        }
      `}</style>
      <img src="/logo.png" alt="CallingAgent" className="ca-logo" />
    </>
  );
}

function LoginScreen({ onSuccess, portalCompanyId }: { onSuccess: () => void; portalCompanyId?: number }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    if (!portalCompanyId) return;
    fetch(`/api/companies/${portalCompanyId}/public-info`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d?.name && setCompanyName(d.name))
      .catch(() => {});
  }, [portalCompanyId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const body: Record<string, unknown> = { username, password };
      if (portalCompanyId) body.companyId = portalCompanyId;
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed.");
      } else {
        onSuccess();
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const isPortal = !!portalCompanyId;

  return (
    <div className="min-h-[100dvh] bg-[#0a0f1a] px-4 py-[max(1rem,env(safe-area-inset-top))] sm:px-6 flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center sm:mb-10">
          {isPortal ? (
            <>
              <p className="mb-2 text-xs font-bold uppercase tracking-[3px] text-emerald-500">Company Portal</p>
              <h1 className="break-words text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">{companyName ?? "Company Portal"}</h1>
              <p className="mt-2 text-sm text-slate-500">Sign in to access your company portal</p>
            </>
          ) : (
            <>
              <div className="mb-4 flex justify-center"><AnimatedLogo /></div>
              <p className="text-sm text-slate-500">Call Center Management</p>
            </>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-2xl sm:p-8">
          <div>
            <label htmlFor="login-username" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Username</label>
            <input id="login-username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={e => setUsername(e.target.value)} className="min-h-12 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-base text-slate-100 placeholder-slate-600 transition-colors focus:border-emerald-600 focus:outline-none sm:min-h-10 sm:text-sm" placeholder="Enter username" required autoFocus />
          </div>
          <div>
            <label htmlFor="login-password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500">Password</label>
            <div className="relative">
              <input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="min-h-12 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 pr-12 text-base text-slate-100 placeholder-slate-600 transition-colors focus:border-emerald-600 focus:outline-none sm:min-h-10 sm:text-sm" placeholder="Enter password" required />
              <button type="button" onClick={() => setShowPassword(current => !current)} className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-700/60 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500" aria-label={showPassword ? "Hide password" : "Show password"} title={showPassword ? "Hide password" : "Show password"}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {error && <p role="alert" aria-live="polite" className="rounded border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
          <button type="submit" disabled={loading} className="mt-2 min-h-12 w-full rounded-md bg-emerald-600 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 sm:min-h-10">
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-5 pb-[max(0rem,env(safe-area-inset-bottom))] text-center text-xs text-slate-600 sm:mt-6">CallingAgent &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

function AdminRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/numbers" component={Numbers} />
        <Route path="/numbers/:id" component={NumberDetail} />
        <Route path="/calls" component={Calls} />
        <Route path="/contacts" component={Contacts} />
        <Route path="/companies/:id" component={CompanyDetail} />
        <Route path="/companies" component={Companies} />
        <Route path="/company-setup" component={CompanySetupOverview} />
        <Route path="/settings" component={Settings} />
        <Route path="/billing" component={Billing} />
        <Route path="/messages" component={Messages} />
        <Route path="/campaigns" component={Campaigns} />
        <Route path="/campaigns/:id" component={CampaignDetail} />
        <Route path="/bookings/import" component={BookingAiImport} />
        <Route path="/bookings/setup" component={BookingSetupEntry} />
        <Route path="/bookings" component={Bookings} />
        <Route path="/leads" component={Leads} />
        <Route component={NotFound} />
      </Switch>
      <ContextualGuide />
    </Layout>
  );
}

function PortalRedirect({ user }: { user: AuthUser }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate("/portal"); }, [navigate]);
  return (
    <Switch>
      <Route path="/portal" component={() => <CompanyPortal user={user} />} />
      <Route component={() => <CompanyPortal user={user} />} />
    </Switch>
  );
}

function AuthGate({ children }: { children?: React.ReactNode }) {
  const { isLoading, isAuthenticated, user, logout, refetch } = useAuth();

  if (isLoading) {
    return <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center"><div className="text-slate-600 text-sm tracking-widest uppercase">Loading...</div></div>;
  }

  if (!isAuthenticated || !user) {
    const params = new URLSearchParams(window.location.search);
    const companyParam = params.get("company");
    const portalCompanyId = companyParam ? parseInt(companyParam, 10) : undefined;
    return <LoginScreen onSuccess={refetch} portalCompanyId={portalCompanyId || undefined} />;
  }

  const isSuperAdmin = !user.role || user.role === "super_admin";

  return (
    <AuthContext.Provider value={{ user, logout, refetch }}>
      {isSuperAdmin ? children : <PortalRedirect user={user} />}
    </AuthContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate><AdminRouter /></AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
