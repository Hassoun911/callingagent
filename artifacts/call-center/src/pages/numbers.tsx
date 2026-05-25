import { useState } from "react";
import { Link } from "wouter";
import {
  useListPhoneNumbers,
  useSearchAvailableNumbers,
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
import { Phone, Plus, Hash, Settings, PhoneForwarded, Bot, Voicemail, Ban, AlertCircle, Bell, BellOff, Trash2, Eye } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useWatches, useCreateWatch, useDeleteWatch, useDismissWatch } from "@/hooks/use-watches";

export default function Numbers() {
  const { data: numbers, isLoading } = useListPhoneNumbers();
  const { data: watches, isLoading: watchesLoading } = useWatches();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchOpen, setSearchOpen] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("US");
  const [tollFree, setTollFree] = useState(false);
  const [searched, setSearched] = useState(false);
  const [watchesOpen, setWatchesOpen] = useState(false);

  const { data: availableNumbers, isLoading: searchLoading, refetch: search, error: searchError } = useSearchAvailableNumbers(
    {
      areaCode: tollFree || city ? undefined : areaCode || undefined,
      country,
      tollFree: tollFree || undefined,
      city: city || undefined,
    } as any,
    { query: { enabled: false } }
  );

  const handleSearch = async () => {
    setSearched(true);
    await search();
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
            if (!open) { setAreaCode(""); setCity(""); setSearched(false); setTollFree(false); setCountry("US"); }
          }}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" />Provision Number</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl bg-card border-border">
              <DialogHeader>
                <DialogTitle>Provision New Number</DialogTitle>
                <DialogDescription>
                  Search by area code or city. Can't find one? Set a watch and we'll alert you when it's available.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 pt-2">
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
                      onChange={(e) => { setCity(e.target.value); setSearched(false); }}
                      onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <Select value={country} onValueChange={(v) => { setCountry(v); setSearched(false); }}>
                      <SelectTrigger className="bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="US">United States</SelectItem>
                        <SelectItem value="CA">Canada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Toll-free toggle */}
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={tollFree}
                      onClick={() => { setTollFree(!tollFree); setSearched(false); }}
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

                {/* Results */}
                <div className="border border-border rounded-md bg-background/50 overflow-hidden max-h-64 overflow-y-auto">
                  <Table>
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
                      {!searchLoading && availableNumbers?.map((n) => (
                        <TableRow key={n.phoneNumber} className="border-border">
                          <TableCell className="font-mono text-sm font-medium">{n.friendlyName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {[n.locality, n.region, n.isoCountry].filter(Boolean).join(", ")}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={provisionMutation.isPending}
                              onClick={() => provisionMutation.mutate({
                                data: { number: n.phoneNumber, friendlyName: n.friendlyName, callerIdName: "New Number", answerMode: "forward" }
                              })}
                            >
                              {provisionMutation.isPending ? "Provisioning…" : "Provision"}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[200px]">Number</TableHead>
              <TableHead>Name / Caller ID</TableHead>
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
                <TableCell colSpan={5} className="text-center py-12">
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <Hash className="h-8 w-8 mb-4 opacity-50" />
                    <p>No numbers provisioned yet.</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : numbers?.map((num) => (
              <TableRow key={num.id} className="border-border group cursor-pointer" onClick={() => window.location.href = `/numbers/${num.id}`}>
                <TableCell className="font-mono font-medium">
                  <div className="flex items-center gap-2">
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    {num.friendlyName}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{num.callerIdName}</div>
                </TableCell>
                <TableCell>{getModeBadge(num.answerMode)}</TableCell>
                <TableCell>
                  {num.answerMode === 'forward' && (
                    <span className="font-mono text-sm text-muted-foreground">→ {num.forwardTo || 'Unassigned'}</span>
                  )}
                  {num.answerMode === 'ai_voice' && <span className="text-sm text-muted-foreground">AI Agent</span>}
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
                      ? `Last checked ${new Date(w.lastChecked).toLocaleTimeString()}`
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
