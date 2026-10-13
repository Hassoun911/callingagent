import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useListPhoneNumbers,
  useListCompanies,
  useProvisionPhoneNumber,
  getListPhoneNumbersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Plus, Hash, Settings, PhoneForwarded, Bot, Voicemail, Ban, AlertCircle, Bell, BellOff, Trash2, Eye, Download } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWatches, useCreateWatch, useDeleteWatch, useDismissWatch } from "@/hooks/use-watches";

const REGION_OPTIONS: Record<string, { code: string; name: string }[]> = {
  CA: [["AB","Alberta"],["BC","British Columbia"],["MB","Manitoba"],["NB","New Brunswick"],["NL","Newfoundland and Labrador"],["NS","Nova Scotia"],["NT","Northwest Territories"],["NU","Nunavut"],["ON","Ontario"],["PE","Prince Edward Island"],["QC","Quebec"],["SK","Saskatchewan"],["YT","Yukon"]].map(([code,name]) => ({code,name})),
  US: [["AL","Alabama"],["AK","Alaska"],["AZ","Arizona"],["AR","Arkansas"],["CA","California"],["CO","Colorado"],["CT","Connecticut"],["DE","Delaware"],["FL","Florida"],["GA","Georgia"],["HI","Hawaii"],["ID","Idaho"],["IL","Illinois"],["IN","Indiana"],["IA","Iowa"],["KS","Kansas"],["KY","Kentucky"],["LA","Louisiana"],["ME","Maine"],["MD","Maryland"],["MA","Massachusetts"],["MI","Michigan"],["MN","Minnesota"],["MS","Mississippi"],["MO","Missouri"],["MT","Montana"],["NE","Nebraska"],["NV","Nevada"],["NH","New Hampshire"],["NJ","New Jersey"],["NM","New Mexico"],["NY","New York"],["NC","North Carolina"],["ND","North Dakota"],["OH","Ohio"],["OK","Oklahoma"],["OR","Oregon"],["PA","Pennsylvania"],["RI","Rhode Island"],["SC","South Carolina"],["SD","South Dakota"],["TN","Tennessee"],["TX","Texas"],["UT","Utah"],["VT","Vermont"],["VA","Virginia"],["WA","Washington"],["WV","West Virginia"],["WI","Wisconsin"],["WY","Wyoming"],["DC","District of Columbia"]].map(([code,name]) => ({code,name})),
};

export default function Numbers() {
  const { data: numbers, isLoading } = useListPhoneNumbers();
  const { data: companies = [] } = useListCompanies();
  const companyNames = new Map(companies.map(company => [company.id, company.name]));
  const { data: watches, isLoading: watchesLoading } = useWatches();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchOpen, setSearchOpen] = useState(new URLSearchParams(window.location.search).get("provision") === "1");
  const [areaCode, setAreaCode] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("CA");
  const [numberProvider, setNumberProvider] = useState<"telnyx" | "twilio">("telnyx");
  // Preserve the company already selected in the admin navigation.
  const requestedCompanyId = new URLSearchParams(window.location.search).get("companyId") || "";
  const [purchaseCompanyId, setPurchaseCompanyId] = useState(requestedCompanyId);
  useEffect(() => {
    if (requestedCompanyId && companies.some(c => String(c.id) === requestedCompanyId)) {
      setPurchaseCompanyId(requestedCompanyId);
    }
  }, [requestedCompanyId, companies]);
  const [province, setProvince] = useState("ON");
  const [availableNumbers, setAvailableNumbers] = useState<any[]>([]);
  const [selectedResultCity, setSelectedResultCity] = useState<string | null>(null);
  const [selectedFoundAreaCode, setSelectedFoundAreaCode] = useState("all");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<Error | null>(null);
  const [showRegionalAlternatives, setShowRegionalAlternatives] = useState(false);
  const [tollFree, setTollFree] = useState(false);
  const [searched, setSearched] = useState(false);
  const [watchesOpen, setWatchesOpen] = useState(false);
  const [provisionTab, setProvisionTab] = useState<"provision" | "import">("provision");
  const [importNumber, setImportNumber] = useState("");
  const [importFriendlyName, setImportFriendlyName] = useState("");
  const [importing, setImporting] = useState(false);

  // Search coverage reflects actual inventory returned for ANY city or area-code query.
  // Never imply that a locality has inventory unless the provider returned a matching number.
  const searchedLocation = city.trim() || (areaCode ? `Area code ${areaCode}` : "Selected region");
  const cityEntries = Object.entries(
    availableNumbers.reduce((counts: Record<string, number>, n: any) => {
      const place = n.locality?.trim();
      if (place) counts[place] = (counts[place] || 0) + 1;
      return counts;
    }, {} as Record<string, number>)
  ).sort((a, b) => {
    const exactA = a[0].toLowerCase() === city.trim().toLowerCase() ? -1 : 0;
    const exactB = b[0].toLowerCase() === city.trim().toLowerCase() ? -1 : 0;
    return exactA - exactB || b[1] - a[1] || a[0].localeCompare(b[0]);
  });
  const unknownCityCount = availableNumbers.filter(n => !n.locality?.trim()).length;
  const showCoverage = !tollFree && Boolean(city.trim() || areaCode || searched);

  const foundAreaCodes = Object.entries(availableNumbers.reduce((counts: Record<string, number>, n: any) => {
    const digits = String(n.phoneNumber || "").replace(/\D/g, "");
    const code = digits.length === 11 && digits.startsWith("1") ? digits.slice(1, 4) : digits.length === 10 ? digits.slice(0, 3) : "";
    if (code) counts[code] = (counts[code] || 0) + 1;
    return counts;
  }, {} as Record<string, number>)).sort((a, b) => a[0].localeCompare(b[0]));

  const cityCount = (place: string) => availableNumbers.filter(n => n.locality?.trim().toLowerCase() === place.toLowerCase()).length;
  const visibleNumbers = availableNumbers.filter(n => {
    if (selectedResultCity && n.locality?.trim().toLowerCase() !== selectedResultCity.toLowerCase()) return false;
    if (selectedFoundAreaCode !== "all") {
      const digits = String(n.phoneNumber || "").replace(/\D/g, "");
      const code = digits.length === 11 && digits.startsWith("1") ? digits.slice(1, 4) : digits.slice(0, 3);
      if (code !== selectedFoundAreaCode) return false;
    }
    return true;
  });

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleImport = async () => {
    const num = importNumber.trim();
    if (!num) { toast({ title: "Enter a phone number", variant: "destructive" }); return; }
    setImporting(true);
    try {
      const r = await fetch(`${BASE}/api/phone-numbers/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number: num, friendlyName: importFriendlyName.trim() || undefined }),
      });
      const json = await r.json();
      if (!r.ok) {
        const message = r.status === 409
          ? "This number is already provisioned in CallingAgent."
          : json.error ?? "Import failed";
        toast({ title: message, variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
      setSearchOpen(false);
      setImportNumber("");
      setImportFriendlyName("");
      toast({ title: "Number imported", description: `${num} is now active in CallingAgent` });
    } catch (err: any) {
      toast({ title: err.message ?? "Import failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleSearch = async () => {
    if (!tollFree && (city.trim() || areaCode) && !province) {
      toast({ title: "Select a province or state", description: "City and area-code searches require a province/state to avoid incorrect locations.", variant: "destructive" });
      return;
    }
    setSearched(true);
    setSearchLoading(true);
    setSearchError(null);
    setAvailableNumbers([]);
    setSelectedResultCity(null);
    setSelectedFoundAreaCode("all");
    try {
      const params = new URLSearchParams({ country, provider: numberProvider });
      if (!tollFree && city.trim()) params.set("city", city.trim());
      if (!tollFree && province) params.set("province", province);
      if (!tollFree && areaCode) params.set("areaCode", areaCode);
      if (tollFree) params.set("tollFree", "true");
      const response = await fetch(`${BASE}/api/phone-numbers/search?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Number search failed");
      setAvailableNumbers(data);
      setShowRegionalAlternatives(Boolean(city.trim() && data.length && !data.some((n: any) => n.locality?.trim().toLowerCase() === city.trim().toLowerCase())));
    } catch (error: any) {
      setSearchError(error);
    } finally {
      setSearchLoading(false);
    }
  };

  const [orderingTelnyx, setOrderingTelnyx] = useState<string | null>(null);
  const [telnyxOrder, setTelnyxOrder] = useState<{ orderId: string; phoneNumber: string; companyId: number; status: string } | null>(null);
  const [telnyxSetupBusy, setTelnyxSetupBusy] = useState(false);
  const [orderLastChecked, setOrderLastChecked] = useState<string | null>(null);
  const [orderStatusError, setOrderStatusError] = useState(false);
  const [routingConfigured, setRoutingConfigured] = useState(false);
  const [recoveryOrderId, setRecoveryOrderId] = useState("");
  const [recoveryPhone, setRecoveryPhone] = useState("");
  const [recoveringOrder, setRecoveringOrder] = useState(false);
  const [recoverError, setRecoverError] = useState("");
  const registerPurchasedOrder = async (orderId: string, phoneNumber: string, companyId: number) => {
    const response = await fetch(`${BASE}/api/phone-numbers/telnyx-register-order`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, phoneNumber, companyId }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not register purchased number");
    await queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
    return data;
  };
  const recoverPurchasedNumber = async () => {
    const companyId = Number(purchaseCompanyId);
    if (!companyId) { setRecoverError("Select a company first."); return; }
    setRecoveringOrder(true);
    setRecoverError("");
    try {
      await registerPurchasedOrder(recoveryOrderId.trim(), recoveryPhone.trim(), companyId);
      setTelnyxOrder({ orderId: recoveryOrderId.trim(), phoneNumber: recoveryPhone.trim(), companyId, status: "success" });
      setTelnyxSetupResult("Purchased number restored to company inventory. Configure voice and SMS next.");
      toast({ title: "Purchased number found", description: "Added to the company as Setup Required." });
    } catch (error: any) { setRecoverError(error.message); }
    finally { setRecoveringOrder(false); }
  };
  const orderStatus = (telnyxOrder?.status || "pending").toLowerCase();
  const orderPurchased = ["success", "completed", "complete", "purchased"].includes(orderStatus);
  const orderFailed = ["failed", "failure", "canceled", "cancelled", "rejected"].includes(orderStatus);
  const orderBadgeClass = orderFailed
    ? "bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-700"
    : routingConfigured ? "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-700"
    : orderPurchased ? "bg-green-100 text-green-900 border-green-300 dark:bg-green-950 dark:text-green-200 dark:border-green-700"
    : "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-700";
  const orderLabel = orderFailed ? "Order failed" : routingConfigured ? "Routing configured · testing needed" : orderPurchased ? "Purchased · setup required" : orderStatus === "pending" ? "Purchase pending" : "Processing";
  useEffect(() => {
    if (!telnyxOrder?.orderId || orderPurchased || orderFailed || !searchOpen) return;
    const timer = setInterval(() => {
      fetch(`${BASE}/api/phone-numbers/telnyx-orders/${encodeURIComponent(telnyxOrder.orderId)}`, { cache: "no-store" })
        .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Status unavailable"); return data; })
        .then(data => {
          setTelnyxOrder(current => current?.orderId === telnyxOrder.orderId ? { ...current, status: data.status } : current);
          setOrderStatusError(false);
          setOrderLastChecked(new Date().toLocaleTimeString());
          if (["success", "completed", "complete"].includes(String(data.status).toLowerCase())) {
            registerPurchasedOrder(telnyxOrder.orderId, telnyxOrder.phoneNumber, telnyxOrder.companyId).catch(() => setOrderStatusError(true));
          }
        })
        .catch(() => setOrderStatusError(true));
    }, 12000);
    return () => clearInterval(timer);
  }, [telnyxOrder?.orderId, orderPurchased, orderFailed, searchOpen, BASE]);
  const [telnyxSetupResult, setTelnyxSetupResult] = useState("");
  const refreshTelnyxOrder = async () => {
    if (!telnyxOrder?.orderId) return;
    setTelnyxSetupBusy(true);
    try {
      const response = await fetch(`${BASE}/api/phone-numbers/telnyx-orders/${encodeURIComponent(telnyxOrder.orderId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Status unavailable");
      setTelnyxOrder(previous => previous ? { ...previous, status: data.status } : previous);
      setOrderLastChecked(new Date().toLocaleTimeString());
      setOrderStatusError(false);
      setTelnyxSetupResult(`Live order status: ${data.status}. Requirements met: ${data.requirementsMet === null ? "not reported" : String(data.requirementsMet)}.`);
    } catch (error: any) { setOrderStatusError(true); setTelnyxSetupResult(error.message); }
    finally { setTelnyxSetupBusy(false); }
  };
  const configureTelnyxNumber = async () => {
    if (!telnyxOrder) return;
    setTelnyxSetupBusy(true);
    try {
      const response = await fetch(`${BASE}/api/phone-numbers/telnyx-setup`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: telnyxOrder.phoneNumber, companyId: telnyxOrder.companyId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Setup not completed");
      setTelnyxSetupResult(`${Object.entries(data.results || {}).map(([key, value]) => `${key}: ${value}`).join(" · ")}. ${data.warning || ""}`);
      setRoutingConfigured(true);
      queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
    } catch (error: any) { setTelnyxSetupResult(error.message); }
    finally { setTelnyxSetupBusy(false); }
  };
  const purchaseTelnyx = async (number: string) => {
    const company = companies.find(c => String(c.id) === purchaseCompanyId);
    if (!company) { toast({ title: "Choose a company", description: "Select the company that will own this number before buying.", variant: "destructive" }); return; }
    if (!window.confirm(`Submit a BILLABLE Telnyx order for ${number}, assigned to ${company.name}? Provider charges and regulatory requirements may apply. CallingAgent will track activation; the number is NOT ready until verified.`)) return;
    setOrderingTelnyx(number);
    setRoutingConfigured(false);
    setOrderLastChecked(null);
    setOrderStatusError(false);
    try {
      const response = await fetch(`${BASE}/api/phone-numbers/telnyx-order`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: number, companyId: Number(purchaseCompanyId), confirmPurchase: true })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not place Telnyx order");
      if (body.orderId) setTelnyxOrder({ orderId: String(body.orderId), phoneNumber: number, companyId: Number(purchaseCompanyId), status: body.status ?? "pending" });
      setTelnyxSetupResult("Order submitted. Track it below, then configure when Telnyx confirms the number is active.");
      toast({ title: "Telnyx order submitted", description: `Order ${body.orderId ?? "pending"} · ${body.status}. Track setup in this portal.` });
      // Retain the ordered number in results so its status remains visible and repeat purchases are blocked.
    } catch (error: any) {
      toast({ title: "Telnyx order not confirmed", description: error?.message ?? "Check Telnyx Portal before retrying.", variant: "destructive" });
    } finally { setOrderingTelnyx(null); }
  };

  const createWatch = useCreateWatch();
  const deleteWatch = useDeleteWatch();
  const dismissWatch = useDismissWatch();

  const provisionMutation = useProvisionPhoneNumber({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
        toast({ title: "Number provisioned", description: "The new phone number is ready to use." });
        setSearchOpen(false);
        setAreaCode("");
        setCity("");
        setSearched(false);
      },
      onError: (err: any) => {
        toast({ title: "Failed to provision", description: err?.message ?? "Unknown error", variant: "destructive" });
      }
    }
  });

  const handleWatch = () => {
    if (!areaCode && !city) {
      toast({ title: "Nothing to watch", description: "Enter an area code or city first.", variant: "destructive" });
      return;
    }
    const label = city
      ? `${city}${areaCode ? ` (${areaCode})` : ""}, ${country}`
      : `${areaCode}, ${country}`;
    createWatch.mutate({ areaCode: areaCode || undefined, city: city || undefined, country, label }, {
      onSuccess: () => {
        toast({ title: "Watch created", description: `We'll notify you when numbers become available for ${label}.` });
        setSearchOpen(false);
        setAreaCode("");
        setCity("");
        setSearched(false);
      },
      onError: (err: any) => toast({ title: "Failed to create watch", description: err.message, variant: "destructive" }),
    });
  };

  const handleProvisionFromWatch = (phoneNumber: string, friendlyName: string, watchId: number) => {
    provisionMutation.mutate({
      data: { number: phoneNumber, friendlyName, callerIdName: "New Number", answerMode: "forward" }
    });
    dismissWatch.mutate(watchId);
  };

  const getModeBadge = (mode: string) => {
    switch (mode) {
      case 'forward': return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20"><PhoneForwarded className="w-3 h-3 mr-1" />Forward</Badge>;
      case 'ai_voice': return <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20"><Bot className="w-3 h-3 mr-1" />AI Voice</Badge>;
      case 'voicemail': return <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20"><Voicemail className="w-3 h-3 mr-1" />Voicemail</Badge>;
      case 'reject': return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20"><Ban className="w-3 h-3 mr-1" />Reject</Badge>;
      default: return <Badge variant="outline">{mode}</Badge>;
    }
  };

  const availableWatches = watches?.filter(w => w.status === "available") ?? [];
  const watchingWatches = watches?.filter(w => w.status === "watching") ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Phone Numbers</h1>
          <p className="text-muted-foreground mt-1">Manage active lines and routing rules.</p>
          {requestedCompanyId && (
            <Link href={`/companies/${requestedCompanyId}`} className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              ← Return to {companies.find(company => String(company.id) === requestedCompanyId)?.name ?? "company"}
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Watches button */}
          <Button variant="outline" className="gap-2 relative" onClick={() => setWatchesOpen(true)}>
            <Bell className="h-4 w-4" />
            Watches
            {availableWatches.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-primary text-[11px] font-bold text-primary-foreground flex items-center justify-center">
                {availableWatches.length}
              </span>
            )}
          </Button>

          {/* Provision dialog */}
          <Dialog open={searchOpen} onOpenChange={(open) => {
            setSearchOpen(open);
            if (!open) { setAreaCode(""); setCity(""); setSearched(false); setTollFree(false); setCountry("CA"); setProvince("ON"); setNumberProvider("telnyx"); setAvailableNumbers([]); setShowRegionalAlternatives(false); setProvisionTab("provision"); }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" />Provision Number</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-4xl bg-card border-border">
              {requestedCompanyId && <Link href={`/companies/${requestedCompanyId}`} className="pr-8 text-sm font-semibold text-primary hover:underline">← Company details</Link>}
              <DialogHeader>
                <DialogTitle>{provisionTab === "import" ? "Import Existing Number" : "Provision New Number"}</DialogTitle>
                <DialogDescription>
                  {provisionTab === "import"
                    ? "Enter a number already in your Twilio account. We'll configure the webhooks automatically."
                    : "Search by area code or city. Can't find one? Set a watch and we'll alert you when it's available."}
                </DialogDescription>
              </DialogHeader>

              {telnyxOrder && (
                <div className="rounded-xl border-2 border-border bg-card shadow-md overflow-hidden" role="status" aria-live="polite">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/50 px-4 py-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Telnyx transaction · Live order tracking</p>
                      <p className="mt-1 text-xl sm:text-2xl font-extrabold tracking-tight text-foreground">{telnyxOrder.phoneNumber}</p>
                      <p className="text-sm font-semibold text-foreground">{companies.find(c => c.id === telnyxOrder.companyId)?.name || "Assigned company"}</p>
                    </div>
                    <span className={`rounded-full border-2 px-4 py-2 text-sm font-extrabold ${orderBadgeClass}`}>{orderLabel}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-4 pt-4">
                    <div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground font-semibold">Purchase</p><p className="text-base font-extrabold text-foreground">{orderFailed ? "Failed" : orderPurchased ? "Confirmed" : "In progress"}</p></div>
                    <div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground font-semibold">Voice & SMS routing</p><p className="text-base font-extrabold text-foreground">{routingConfigured ? "Assigned" : "Not confirmed"}</p></div>
                    <div className="rounded-lg border border-border bg-background p-3"><p className="text-xs text-muted-foreground font-semibold">Service readiness</p><p className="text-base font-extrabold text-foreground">Not tested</p></div>
                  </div>
                  <div className="space-y-2 px-4 py-3">
                    <p className="text-xs font-medium text-muted-foreground">Order ID: <span className="font-mono break-all">{telnyxOrder.orderId}</span></p>
                    <p className="text-sm font-semibold text-foreground">{orderPurchased ? "Telnyx confirmed the purchase. Continue with routing setup inside CallingAgent." : orderFailed ? "The carrier reported an unsuccessful order. Check the details before attempting another purchase." : "Checking the carrier automatically every 12 seconds while this window is open."}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" variant="outline" disabled={telnyxSetupBusy} onClick={refreshTelnyxOrder}>Refresh now</Button>
                      <Button type="button" size="sm" disabled={telnyxSetupBusy || !orderPurchased || routingConfigured} onClick={configureTelnyxNumber}>{routingConfigured ? "Routing assigned" : "Configure voice & SMS"}</Button>
                      <span className="text-xs font-semibold text-muted-foreground">{orderStatusError ? "Status check failed — retry" : orderLastChecked ? `Updated ${orderLastChecked}` : "Awaiting live refresh"}</span>
                    </div>
                    {telnyxSetupResult && <p className="text-sm font-semibold text-foreground rounded-md bg-secondary/60 p-2">{telnyxSetupResult}</p>}
                    <p className="text-xs text-muted-foreground">Purchased does not mean voice or SMS is verified. Carrier activation and compliance requirements may still apply.</p>
                  </div>
                </div>
              )}
              {telnyxOrder && (
                <section className="rounded-xl border-2 border-blue-300 bg-blue-50 p-4 text-slate-900 dark:border-blue-700 dark:bg-slate-900 dark:text-slate-100" aria-label="Next steps after purchase">
                  <h3 className="text-base font-extrabold">What happens next?</h3>
                  <p className="mt-1 text-sm font-medium">
                    {routingConfigured
                      ? "Your number is purchased and assigned to the company. Voice and SMS profiles are configured, but calls and messages have NOT been tested."
                      : orderPurchased
                        ? "The purchase is recorded. Configure voice and SMS routing before using the number."
                        : "Your order is being processed. Check its status before assuming the number is ready."}
                  </p>
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
                    <li>{orderPurchased ? "Purchase confirmed" : "Wait for Telnyx to confirm the purchase"}.</li>
                    <li>{routingConfigured ? "Voice and SMS profiles assigned" : "Select Configure voice & SMS after purchase confirmation"}.</li>
                    <li>From another phone, test an inbound call and an inbound SMS.</li>
                    <li>Test an outbound call and SMS, and verify the correct company caller ID.</li>
                    <li>Check carrier approval requirements before relying on this line.</li>
                  </ol>
                  <div className="mt-4 rounded-lg border border-blue-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-800">
                    <strong>Can I close this window?</strong> Yes. Closing it does not cancel or undo a confirmed Telnyx purchase or the routing assignments already saved on the server. The search results and the live tracking panel may disappear from this window, but the number remains with the company. Keep the order ID above for reference.
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <Link href={`/companies/${telnyxOrder.companyId}`} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">
                      Return to company details →
                    </Link>
                    <Button type="button" variant="outline" className="min-h-11 bg-white text-slate-900 dark:bg-slate-800 dark:text-white" onClick={() => setSearchOpen(false)}>
                      Close window — purchase stays saved
                    </Button>
                  </div>
                </section>
              )}
              {!telnyxOrder && numberProvider === "telnyx" && (
                <div className="rounded-lg border border-border p-3 space-y-2 bg-secondary/20">
                  <p className="text-sm font-bold text-foreground">Already purchased a Telnyx number? Restore it here</p>
                  <p className="text-xs text-muted-foreground">If the browser was refreshed after purchase, verify your Telnyx order and add the number to its company without paying twice.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input placeholder="Telnyx order ID" aria-label="Existing Telnyx order ID" value={recoveryOrderId} onChange={e => setRecoveryOrderId(e.target.value)} />
                    <Input placeholder="Phone number, e.g. +15198006738" aria-label="Purchased phone number" value={recoveryPhone} onChange={e => setRecoveryPhone(e.target.value)} />
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={recoverPurchasedNumber} disabled={recoveringOrder || !recoveryOrderId.trim() || !recoveryPhone.trim() || !purchaseCompanyId}>{recoveringOrder ? "Verifying purchase…" : "Verify and add to company"}</Button>
                  {recoverError && <p className="text-sm font-semibold text-destructive">{recoverError}</p>}
                </div>
              )}
              {/* Tab switcher */}
              <div className="flex gap-1 bg-secondary/40 rounded-md p-1 w-fit">
                <button
                  onClick={() => setProvisionTab("provision")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${provisionTab === "provision" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <span className="flex items-center gap-1.5"><Plus className="h-3 w-3" />Provision New</span>
                </button>
                <button
                  onClick={() => setProvisionTab("import")}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${provisionTab === "import" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  <span className="flex items-center gap-1.5"><Download className="h-3 w-3" />Import Existing</span>
                </button>
              </div>

              {provisionTab === "import" ? (
                <div className="space-y-4 pt-1">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Phone Number (E.164)</Label>
                    <Input
                      placeholder="+15551234567"
                      value={importNumber}
                      onChange={e => setImportNumber(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleImport()}
                      className="font-mono bg-background text-base"
                    />
                    <p className="text-xs text-muted-foreground">Must be a number already purchased in your Twilio account. E.164 format: +1 followed by 10 digits.</p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Display Name <span className="normal-case">(optional)</span></Label>
                    <Input
                      placeholder="e.g. Main Office Line"
                      value={importFriendlyName}
                      onChange={e => setImportFriendlyName(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                  <div className="rounded-md border border-border bg-secondary/20 px-4 py-3 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">What happens on import:</p>
                    <ul className="space-y-0.5 list-disc list-inside">
                      <li>Number is verified against your Twilio account</li>
                      <li>Voice, status, and SMS webhooks are updated to point at CallingAgent</li>
                      <li>Number appears in your active lines list, ready to configure</li>
                    </ul>
                  </div>
                  <Button className="w-full gap-2" onClick={handleImport} disabled={importing || !importNumber.trim()}>
                    <Download className="h-4 w-4" />
                    {importing ? "Importing…" : "Import Number"}
                  </Button>
                </div>
              ) : (
              <div className="space-y-4 pt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Phone number provider</Label>
                  <Select value={numberProvider} onValueChange={(value) => {
                    setNumberProvider(value as "telnyx" | "twilio");
                    setSearched(false); setAvailableNumbers([]); setSelectedResultCity(null); setSelectedFoundAreaCode("all");
                  }}>
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="telnyx">Telnyx (preferred)</SelectItem>
                      <SelectItem value="twilio">Twilio</SelectItem>
                    </SelectContent>
                  </Select>
                  {numberProvider === "telnyx" && <p className="text-xs text-amber-500">Purchase requires confirmation. Company assignment is required. Track Telnyx voice and SMS activation in this portal; never assume a pending line is active.</p>}
                </div>
                {numberProvider === "telnyx" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Company receiving this number</Label>
                    {requestedCompanyId && companies.some(c => String(c.id) === requestedCompanyId) ? (
                      <div className="rounded-md border border-primary/25 bg-primary/5 px-3 py-2 text-sm font-semibold text-foreground">
                        {companies.find(c => String(c.id) === requestedCompanyId)?.name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">Already selected · Confirmed</span>
                      </div>
                    ) : (
                      <Select value={purchaseCompanyId} onValueChange={setPurchaseCompanyId}>
                        <SelectTrigger className="bg-background"><SelectValue placeholder="Select a company" /></SelectTrigger>
                        <SelectContent>
                          {companies.map(company => <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )}
                {/* Search controls */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">Area Code</Label>
                    <Input
                      placeholder={tollFree ? "Any" : "e.g. 519"}
                      value={areaCode}
                      disabled={tollFree}
                      onChange={(e) => { setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3)); setSearched(false); }}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="font-mono bg-background"
                      maxLength={3}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wider">City</Label>
                    <Input
                      placeholder="e.g. Windsor"
                      value={city}
                      disabled={tollFree}
                      onChange={(e) => { setCity(e.target.value); setSearched(false); }}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Select value={country} onValueChange={(v) => { setCountry(v); setProvince(v === "CA" ? "ON" : ""); setAvailableNumbers([]); setSelectedResultCity(null); setSearched(false); }}>
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">United States</SelectItem>
                        <SelectItem value="CA">Canada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {!tollFree && (
                    <div className="flex-1">
                      <Select value={province} onValueChange={(v) => { setProvince(v); setSearched(false); }}>
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder={country === "CA" ? "Select province" : "Select state"} />
                        </SelectTrigger>
                        <SelectContent>
                          {REGION_OPTIONS[country].map((region) => (
                            <SelectItem key={region.code} value={region.code}>{region.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Toll-free toggle */}
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={tollFree}
                      onClick={() => { setTollFree(!tollFree); setSearched(false); setAvailableNumbers([]); setSelectedResultCity(null); setSelectedFoundAreaCode("all"); setShowRegionalAlternatives(false); setSearchError(null); }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${tollFree ? "bg-primary" : "bg-muted"}`}
                    >
                      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow-lg transition-transform ${tollFree ? "translate-x-4" : "translate-x-0"}`} />
                    </button>
                    <span className="text-muted-foreground text-xs">Toll-free</span>
                  </div>

                  <Button onClick={handleSearch} disabled={searchLoading}>
                    {searchLoading ? "Searching…" : "Search"}
                  </Button>
                </div>

                {tollFree && (
                  <p className="text-xs text-muted-foreground">
                    US and Canada share toll-free numbering. Twilio may label available toll-free numbers as US even when Canada is selected. City, province, and area code do not apply to toll-free searches.
                  </p>
                )}

                {searched && showRegionalAlternatives && !searchLoading && (
                  <p className="text-xs text-amber-600">No exact city match for {city}, {province}. Showing numbers elsewhere in {REGION_OPTIONS[country]?.find(r => r.code === province)?.name ?? province}, with nearby areas listed first where supported.</p>
                )}

                {searched && !searchLoading && !searchError && availableNumbers.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Label htmlFor="found-area-code" className="font-semibold whitespace-nowrap">Found area codes</Label>
                    <select id="found-area-code" aria-label="Filter found phone numbers by area code"
                      className="h-9 rounded-md border border-border bg-background px-3 text-foreground"
                      value={selectedFoundAreaCode} onChange={e => setSelectedFoundAreaCode(e.target.value)}>
                      <option value="all">All area codes ({availableNumbers.length})</option>
                      {foundAreaCodes.map(([code, count]) => (
                        <option key={code} value={code}>{code} ({count})</option>
                      ))}
                    </select>
                    <span className="text-muted-foreground">Showing {visibleNumbers.length} matching number(s)</span>
                  </div>
                )}

                {selectedResultCity && (
                  <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs">
                    <span>Showing {visibleNumbers.length} number(s) in <strong>{selectedResultCity}</strong></span>
                    <button type="button" className="font-semibold underline" onClick={() => setSelectedResultCity(null)}>Show all numbers</button>
                  </div>
                )}
                {/* Search results with a visible coverage sidebar. */}
                <div className={showCoverage ? "grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_230px] gap-3 items-start" : ""}>
                <div className="border border-border rounded-md bg-background/50 overflow-hidden max-h-72 overflow-y-auto">
                  <Table className="text-sm sm:text-base">
                    <TableHeader>
                      <TableRow className="border-border hover:bg-transparent sticky top-0 bg-background">
                        <TableHead>Number</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {searchLoading && [...Array(4)].map((_, i) => (
                        <TableRow key={i} className="border-border">
                          <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-7 w-20 ml-auto" /></TableCell>
                        </TableRow>
                      ))}
                      {!searchLoading && searchError && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-8">
                            <div className="flex flex-col items-center gap-2 text-destructive">
                              <AlertCircle className="h-5 w-5" />
                              <p className="text-sm font-medium">Search failed</p>
                              <p className="text-xs text-muted-foreground">{(searchError as any)?.message ?? "Could not reach Twilio. Check your credentials."}</p>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {!searchLoading && !searchError && searched && (availableNumbers?.length ?? 0) === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-6">
                            <div className="flex flex-col items-center gap-3 text-muted-foreground text-sm">
                              <p className="font-medium">No numbers available right now</p>
                              <p className="text-xs text-center max-w-xs">
                                Twilio has no inventory for {city || areaCode || "this region"} at the moment.
                                Set a watch and we'll check every 5 minutes and notify you the moment one becomes available.
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-2 mt-1 border-primary/40 text-primary hover:bg-primary/10"
                                onClick={handleWatch}
                                disabled={createWatch.isPending}
                              >
                                <Bell className="h-3.5 w-3.5" />
                                {createWatch.isPending ? "Setting watch…" : `Watch ${city || areaCode} (${country})`}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                      {!searchLoading && !searched && (
                        <TableRow>
                          <TableCell colSpan={3} className="py-5 text-center text-sm text-muted-foreground">
                            Enter an area code or city name and press Search
                          </TableCell>
                        </TableRow>
                      )}
                      {!searchLoading && visibleNumbers?.map((n) => (
                        <TableRow key={n.phoneNumber} className="border-border">
                          <TableCell className="font-mono text-base font-bold text-foreground"><div className="flex flex-wrap items-center gap-2"><span>{n.friendlyName}</span>{telnyxOrder?.phoneNumber === n.phoneNumber && <span className={`rounded-md border px-2 py-0.5 text-xs font-extrabold ${orderBadgeClass}`}>{orderLabel}</span>}</div></TableCell>
                          <TableCell className="text-sm sm:text-base font-semibold text-foreground">
                            {n.locality ? (
                              <span className="inline-flex flex-col gap-0.5">
                                <span className="font-semibold text-foreground">{n.locality}</span>
                                <span className="text-xs">{[n.region, n.isoCountry].filter(Boolean).join(", ")}</span>
                              </span>
                            ) : (
                              <span className="inline-flex flex-col gap-0.5">
                                <span className="text-amber-500 font-medium">City not provided</span>
                                <span className="text-xs">{[n.region, n.isoCountry].filter(Boolean).join(", ")} · Verify before purchase</span>
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={provisionMutation.isPending || Boolean(orderingTelnyx) || (numberProvider === "telnyx" && telnyxOrder?.phoneNumber === n.phoneNumber)}
                              onClick={() => numberProvider === "telnyx"
                                ? purchaseTelnyx(n.phoneNumber)
                                : provisionMutation.mutate({
                                    data: { number: n.phoneNumber, friendlyName: n.friendlyName, callerIdName: "New Number", answerMode: "forward" }
                                  })}
                            >
                              {numberProvider === "telnyx" ? (orderingTelnyx === n.phoneNumber ? "Ordering…" : telnyxOrder?.phoneNumber === n.phoneNumber ? (orderPurchased ? "Purchased" : orderFailed ? "Failed — review" : "Pending") : "Buy via Telnyx") : provisionMutation.isPending ? "Provisioning…" : "Provision"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {showCoverage && (
                  <aside className="border border-border rounded-md bg-background/50 p-3 max-h-72 overflow-y-auto">
                    <h3 className="text-sm font-semibold">Search coverage</h3>
                    <p className="text-xs text-muted-foreground mt-1 mb-3">
                      Target: <strong className="text-foreground">{searchedLocation}</strong>
                      {province ? `, ${REGION_OPTIONS[country]?.find(r => r.code === province)?.name ?? province}` : ""}.
                      {searchLoading ? " Looking for numbers…" : " Cities below have actual results; select one to see its phone numbers."}
                    </p>
                    {searched && !searchLoading && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold">{availableNumbers.length} number(s) returned</p>
                        <div className="flex flex-wrap gap-1.5">
                          {cityEntries.map(([place, count]) => (
                            <button type="button" key={place}
                              onClick={() => setSelectedResultCity(selectedResultCity === place ? null : place)}
                              className={`text-xs px-2 py-1 rounded border text-left transition-colors border-primary text-primary bg-primary/10 hover:bg-primary/20 ${selectedResultCity === place ? "ring-2 ring-primary font-bold" : ""}`}>
                              {place} <strong>({count})</strong>
                            </button>
                          ))}
                        </div>
                        {unknownCityCount > 0 && (
                          <p className="text-xs text-amber-500">{unknownCityCount} number(s) have no city supplied by the provider.</p>
                        )}
                        {selectedResultCity && (
                          <button type="button" onClick={() => setSelectedResultCity(null)}
                            className="text-xs underline text-primary">Show all numbers</button>
                        )}
                      </div>
                    )}
                    {!searched && <p className="text-xs text-muted-foreground">Press Search to see actual city matches.</p>}
                  </aside>
                )}
                </div>

                {/* Quick watch button when results exist but user might also want to watch */}
                {!searchLoading && searched && (availableNumbers?.length ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground text-center">
                    Want to be notified of future availability?{" "}
                    <button className="text-primary underline underline-offset-2" onClick={handleWatch} disabled={createWatch.isPending}>
                      Set a watch
                    </button>
                  </p>
                )}
              </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Active availability alerts */}
      {availableWatches.length > 0 && (
        <div className="space-y-2">
          {availableWatches.map(w => (
            <div key={w.id} className="border border-primary/30 bg-primary/5 rounded-md px-4 py-3 flex items-start gap-3">
              <Bell className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Numbers available — <span className="text-primary">{w.label}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {w.foundNumbers.length} number{w.foundNumbers.length !== 1 ? "s" : ""} found. Provision one now or dismiss to keep watching.
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {w.foundNumbers.slice(0, 5).map(n => (
                    <button
                      key={n.phoneNumber}
                      onClick={() => handleProvisionFromWatch(n.phoneNumber, n.friendlyName, w.id)}
                      disabled={provisionMutation.isPending}
                      className="font-mono text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/30 rounded px-2 py-1 transition-colors"
                    >
                      {n.friendlyName}
                      {n.locality ? ` · ${n.locality}` : ""}
                    </button>
                  ))}
                  {w.foundNumbers.length > 5 && (
                    <span className="text-xs text-muted-foreground self-center">+{w.foundNumbers.length - 5} more</span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => dismissWatch.mutate(w.id)}
              >
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Numbers table */}
      <Card className="border-border">
        <Table className="min-w-[900px] text-sm sm:text-base">
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="min-w-[170px]">Phone Number</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>API Provider</TableHead>
              <TableHead>Caller ID</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Routing</TableHead>
              <TableHead className="w-[100px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <TableRow key={i} className="border-border">
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-24 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-8 w-8" /></TableCell>
                </TableRow>
              ))
            ) : numbers?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <Hash className="h-8 w-8 mb-4 opacity-50" />
                    <p>No numbers provisioned yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : numbers?.map((num) => (
              <TableRow key={num.id} className="border-border group cursor-pointer" onClick={() => window.location.href = `/numbers/${num.id}`}>
                <TableCell className="font-mono text-base sm:text-lg font-bold text-foreground">
                  <div className="flex items-center gap-2">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {num.number}
                  </div>
                  {num.friendlyName && num.friendlyName.trim().toLowerCase() !== (companyNames.get(num.companyId ?? -1) ?? "").trim().toLowerCase() && num.friendlyName.trim().toLowerCase() !== num.number.trim().toLowerCase() && <div className="mt-1 text-xs font-normal text-muted-foreground">{num.friendlyName}</div>}
                </TableCell>
                <TableCell className="font-semibold text-foreground">{num.companyId ? companyNames.get(num.companyId) || `Company #${num.companyId}` : "Unassigned"}</TableCell>
                <TableCell><div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-md px-2 py-1 text-xs font-extrabold ${num.twilioSid ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-blue-500/10 text-blue-700 dark:text-blue-300"}`}>{num.twilioSid ? "Twilio" : "Telnyx"}</span>
                  {!num.isActive && <span className="rounded-md border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-extrabold text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Setup Required</span>}
                </div></TableCell>
                <TableCell>
                  <div className="text-sm sm:text-base font-semibold text-foreground">{num.callerIdName?.trim().toLowerCase() === (companyNames.get(num.companyId ?? -1) ?? "").trim().toLowerCase() ? "—" : (num.callerIdName || "—")}</div>
                </TableCell>
                <TableCell>{getModeBadge(num.answerMode)}</TableCell>
                <TableCell>
                  {num.answerMode === 'forward' && (
                    <span className="font-mono text-sm sm:text-base font-medium text-foreground">→ {num.forwardTo || 'Unassigned'}</span>
                  )}
                  {num.answerMode === 'ai_voice' && <span className="text-sm sm:text-base font-semibold text-foreground">AI Agent</span>}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/numbers/${num.id}`} className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground h-8 w-8">
                    <Settings className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Watches management dialog */}
      <Dialog open={watchesOpen} onOpenChange={setWatchesOpen}>
        <DialogContent className="sm:max-w-lg bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Number Watches
            </DialogTitle>
            <DialogDescription>
              Active alerts for phone number availability. Checked every 5 minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-96 overflow-y-auto mt-2">
            {watchesLoading && <Skeleton className="h-16 w-full" />}
            {!watchesLoading && (watches?.length ?? 0) === 0 && (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <BellOff className="h-6 w-6 mx-auto mb-2 opacity-40" />
                No active watches. Search for a number and click "Watch" when inventory is unavailable.
              </div>
            )}
            {watches?.map(w => (
              <div key={w.id} className={`flex items-center gap-3 p-3 rounded-md border ${
                w.status === "available"
                  ? "border-primary/30 bg-primary/5"
                  : "border-border bg-background/50"
              }`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{w.label}</p>
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                      w.status === "available"
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {w.status}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {w.lastChecked
                      ? `Last checked ${new Date(w.lastChecked).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" })}`
                      : "Not yet checked"}
                    {w.foundNumbers.length > 0 && ` · ${w.foundNumbers.length} numbers available`}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {w.status === "available" && (
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-primary" onClick={() => { setWatchesOpen(false); }}>
                      <Eye className="h-3 w-3 mr-1" />
                      View
                    </Button>
                  )}
                  <button
                    onClick={() => deleteWatch.mutate(w.id)}
                    className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
