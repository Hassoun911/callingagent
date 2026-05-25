import { useState } from "react";
import { Link } from "wouter";
import { useListPhoneNumbers, useSearchAvailableNumbers, useProvisionPhoneNumber, getListPhoneNumbersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Plus, Hash, Settings, PhoneForwarded, Bot, Voicemail, Ban, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function Numbers() {
  const { data: numbers, isLoading } = useListPhoneNumbers();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [searchOpen, setSearchOpen] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [country, setCountry] = useState("US");
  const [tollFree, setTollFree] = useState(false);
  const [searched, setSearched] = useState(false);

  const { data: availableNumbers, isLoading: searchLoading, refetch: search, error: searchError } = useSearchAvailableNumbers(
    { areaCode: tollFree ? undefined : areaCode || undefined, country, tollFree: tollFree || undefined },
    { query: { enabled: false } }
  );

  const handleSearch = async () => {
    setSearched(true);
    await search();
  };

  const provisionMutation = useProvisionPhoneNumber({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPhoneNumbersQueryKey() });
        toast({ title: "Number provisioned", description: "The new phone number is ready to use." });
        setSearchOpen(false);
        setAreaCode("");
        setSearched(false);
      },
      onError: (err: any) => {
        toast({ title: "Failed to provision", description: err?.message ?? "Unknown error", variant: "destructive" });
      }
    }
  });

  const getModeBadge = (mode: string) => {
    switch(mode) {
      case 'forward': return <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20"><PhoneForwarded className="w-3 h-3 mr-1" /> Forward</Badge>;
      case 'ai_voice': return <Badge variant="outline" className="bg-purple-500/10 text-purple-500 border-purple-500/20"><Bot className="w-3 h-3 mr-1" /> AI Voice</Badge>;
      case 'voicemail': return <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-orange-500/20"><Voicemail className="w-3 h-3 mr-1" /> Voicemail</Badge>;
      case 'reject': return <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20"><Ban className="w-3 h-3 mr-1" /> Reject</Badge>;
      default: return <Badge variant="outline">{mode}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Phone Numbers</h1>
          <p className="text-muted-foreground mt-1">Manage active lines and routing rules.</p>
        </div>
        
        <Dialog open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) { setAreaCode(""); setSearched(false); setTollFree(false); setCountry("US"); } }}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Provision Number
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl bg-card border-border">
            <DialogHeader>
              <DialogTitle>Provision New Number</DialogTitle>
              <DialogDescription>
                Search and purchase local or toll-free numbers from US or Canada.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {/* Search controls */}
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 items-end">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Area Code</Label>
                  <Input
                    placeholder={tollFree ? "Any toll-free" : "e.g. 415, 519, 212"}
                    value={areaCode}
                    disabled={tollFree}
                    onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 3))}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    className="font-mono bg-background"
                    maxLength={3}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider">Country</Label>
                  <Select value={country} onValueChange={(v) => { setCountry(v); setSearched(false); }}>
                    <SelectTrigger className="w-[110px] bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="US">US</SelectItem>
                      <SelectItem value="CA">Canada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleSearch} disabled={searchLoading} className="mb-0 self-end">
                  {searchLoading ? "Searching..." : "Search"}
                </Button>
              </div>

              {/* Toll-free toggle */}
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={tollFree}
                  onClick={() => { setTollFree(!tollFree); setSearched(false); }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none ${tollFree ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform ${tollFree ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <span className="text-muted-foreground">Toll-free number (800, 888, 877…)</span>
              </div>

              {/* Results table */}
              <div className="border border-border rounded-md bg-background/50 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border hover:bg-transparent">
                      <TableHead>Number</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {searchLoading && (
                      [...Array(4)].map((_, i) => (
                        <TableRow key={i} className="border-border">
                          <TableCell><Skeleton className="h-4 w-36 font-mono" /></TableCell>
                          <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                          <TableCell className="text-right"><Skeleton className="h-7 w-20 ml-auto" /></TableCell>
                        </TableRow>
                      ))
                    )}
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
                    {!searchLoading && !searchError && searched && availableNumbers?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8">
                          <div className="flex flex-col items-center gap-1 text-muted-foreground text-sm">
                            <p className="font-medium">No numbers available</p>
                            <p className="text-xs">Try a different area code, or switch to toll-free.</p>
                            {country === "US" && areaCode && (
                              <p className="text-xs mt-1 text-primary/70 cursor-pointer underline underline-offset-2" onClick={() => { setCountry("CA"); handleSearch(); }}>
                                Try searching Canada instead
                              </p>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {!searchLoading && !searched && (
                      <TableRow>
                        <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                          Enter an area code and press Search
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
                            onClick={() => {
                              provisionMutation.mutate({
                                data: {
                                  number: n.phoneNumber,
                                  friendlyName: n.friendlyName,
                                  callerIdName: "New Number",
                                  answerMode: "forward",
                                }
                              });
                            }}
                          >
                            {provisionMutation.isPending ? "Provisioning…" : "Provision"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

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
                <TableCell>
                  {getModeBadge(num.answerMode)}
                </TableCell>
                <TableCell>
                  {num.answerMode === 'forward' && (
                    <span className="font-mono text-sm text-muted-foreground flex items-center gap-1">
                      → {num.forwardTo || 'Unassigned'}
                    </span>
                  )}
                  {num.answerMode === 'ai_voice' && (
                    <span className="text-sm text-muted-foreground flex items-center gap-1">
                      AI Agent
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/numbers/${num.id}`} className="inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 hover:bg-accent hover:text-accent-foreground h-8 w-8">
                    <Settings className="h-4 w-4" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
