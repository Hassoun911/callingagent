import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import CompanyPortal from "@/pages/company-portal";

// Pages
import Dashboard from "@/pages/dashboard";
import Numbers from "@/pages/numbers";
import NumberDetail from "@/pages/number-detail";
import Calls from "@/pages/calls";
import Contacts from "@/pages/contacts";
import Companies from "@/pages/companies";
import CompanyDetail from "@/pages/company-detail";
import Settings from "@/pages/settings";
import Billing from "@/pages/billing";
import Messages from "@/pages/messages";
import Campaigns from "@/pages/campaigns";
import CampaignDetail from "@/pages/campaign-detail";
import NotFound from "@/pages/not-found";
import Bookings from "@/pages/bookings";
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
        @keyframes ca-icon-pop {
          0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
          65%  { transform: scale(1.1)  rotate(4deg);  opacity: 1; }
          100% { transform: scale(1)    rotate(0deg);  opacity: 1; }
        }
        @keyframes ca-text-slide {
          0%   { transform: translateX(-100%); opacity: 0; }
          25%  { opacity: 1; }
          100% { transform: translateX(0);     opacity: 1; }
        }
        .ca-icon { animation: ca-icon-pop 0.55s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both; }
        .ca-clip  { overflow: hidden; }
        .ca-text  { animation: ca-text-slide 0.65s cubic-bezier(0.16, 1, 0.3, 1) 0.5s both; white-space: nowrap; }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {/* Phone icon — the "C" */}
        <div className="ca-icon" style={{ width: 72, height: 72, flexShrink: 0 }}>
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: "100%", height: "100%" }}>
            {/* Signal arcs */}
            <path d="M19.5 3.5 C21.8 5.8 23 9 23 12.5" stroke="#12aae8" strokeWidth="1.8" strokeLinecap="round"/>
            <path d="M16.5 6 C18 8 18.8 10.1 18.8 12.5" stroke="#12aae8" strokeWidth="1.5" strokeLinecap="round"/>
            {/* Phone handset — lucide Phone path, fills 24×24 */}
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 5 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.9 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" fill="#12aae8"/>
          </svg>
        </div>
        {/* ALLINGAGENT slides out from inside the icon */}
        <div className="ca-clip">
          <div className="ca-text" style={{ display: "flex", alignItems: "baseline", gap: 0 }}>
            <span style={{ color: "#fff", fontWeight: 900, fontSize: "2.4rem", letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "system-ui, -apple-system, sans-serif" }}>ALLING</span>
            <span style={{ color: "#12aae8", fontWeight: 900, fontSize: "2.4rem", letterSpacing: "-0.02em", lineHeight: 1, fontFamily: "system-ui, -apple-system, sans-serif" }}>AGENT</span>
          </div>
        </div>
      </div>
    </>
  );
}

function LoginScreen({ onSuccess, portalCompanyId }: { onSuccess: () => void; portalCompanyId?: number }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
      <div className="w-full max-w-sm px-8">
        <div className="mb-10 text-center">
          {isPortal ? (
            <>
              <p className="text-xs font-bold tracking-[3px] uppercase text-emerald-500 mb-2">Company Portal</p>
              <h1 className="text-3xl font-bold text-slate-50 tracking-tight">{companyName ?? "Company Portal"}</h1>
              <p className="mt-2 text-sm text-slate-500">Sign in to access your company portal</p>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-4">
                <AnimatedLogo />
              </div>
              <p className="text-sm text-slate-500">Call Center Management</p>
            </>
          )}
        </div>
        <form onSubmit={handleSubmit} className="border border-slate-800 rounded-lg bg-slate-900/60 p-8 space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Username</label>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              placeholder="Enter username"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-md px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-600 transition-colors"
              placeholder="Enter password"
              required
            />
          </div>
          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-md transition-colors text-sm mt-2"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-slate-600">CallingAgent &copy; {new Date().getFullYear()}</p>
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
        <Route path="/settings" component={Settings} />
        <Route path="/billing" component={Billing} />
        <Route path="/messages" component={Messages} />
        <Route path="/campaigns" component={Campaigns} />
        <Route path="/campaigns/:id" component={CampaignDetail} />
        <Route path="/bookings" component={Bookings} />
        <Route path="/leads" component={Leads} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function PortalRedirect({ user }: { user: AuthUser }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/portal");
  }, [navigate]);
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
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-slate-600 text-sm tracking-widest uppercase">Loading...</div>
      </div>
    );
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
      {isSuperAdmin
        ? children
        : <PortalRedirect user={user} />
      }
    </AuthContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthGate>
            <AdminRouter />
          </AuthGate>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
