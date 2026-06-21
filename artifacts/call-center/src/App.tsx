import { useState, useEffect, useCallback, createContext, useContext } from "react";
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

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
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

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
      <div className="w-full max-w-sm px-8">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold tracking-[3px] uppercase text-emerald-500 mb-2">Operations Platform</p>
          <h1 className="text-3xl font-bold text-slate-50 tracking-tight">Vanguard.OPS</h1>
          <p className="mt-2 text-sm text-slate-500">Call Center Management</p>
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
        <p className="mt-6 text-center text-xs text-slate-600">Vanguard.OPS &copy; {new Date().getFullYear()}</p>
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
    return <LoginScreen onSuccess={refetch} />;
  }

  return (
    <AuthContext.Provider value={{ user, logout, refetch }}>
      {user.role === "super_admin"
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
