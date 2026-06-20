import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/layout";
import { useAuth } from "@workspace/replit-auth-web";

// Pages
import Dashboard from "@/pages/dashboard";
import Numbers from "@/pages/numbers";
import NumberDetail from "@/pages/number-detail";
import Calls from "@/pages/calls";
import Contacts from "@/pages/contacts";
import Companies from "@/pages/companies";
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

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/numbers" component={Numbers} />
        <Route path="/numbers/:id" component={NumberDetail} />
        <Route path="/calls" component={Calls} />
        <Route path="/contacts" component={Contacts} />
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

function LoginScreen() {
  const { login } = useAuth();
  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
      <div className="w-full max-w-sm px-8">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold tracking-[3px] uppercase text-emerald-500 mb-2">Operations Platform</p>
          <h1 className="text-3xl font-bold text-slate-50 tracking-tight">Vanguard.OPS</h1>
          <p className="mt-2 text-sm text-slate-500">Call Center Management</p>
        </div>
        <div className="border border-slate-800 rounded-lg bg-slate-900/60 p-8">
          <p className="text-sm text-slate-400 mb-6 text-center leading-relaxed">
            Secure access to your call center dashboard, campaigns, and CRM.
          </p>
          <button
            onClick={login}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-semibold py-2.5 rounded-md transition-colors text-sm"
          >
            Log in
          </button>
        </div>
        <p className="mt-6 text-center text-xs text-slate-600">Vanguard.OPS &copy; {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center">
        <div className="text-slate-600 text-sm tracking-widest uppercase">Loading...</div>
      </div>
    );
  }
  if (!isAuthenticated) return <LoginScreen />;
  return <>{children}</>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
        </AuthGate>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
