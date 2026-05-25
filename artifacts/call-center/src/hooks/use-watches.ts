import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type Watch = {
  id: number;
  areaCode: string | null;
  city: string | null;
  country: string;
  status: "watching" | "available" | "provisioned" | "paused";
  foundNumbers: Array<{ phoneNumber: string; friendlyName: string; locality: string | null; region: string | null; isoCountry: string }>;
  lastChecked: string | null;
  notifiedAt: string | null;
  label: string | null;
  createdAt: string;
};

export function useWatches() {
  return useQuery<Watch[]>({
    queryKey: ["watches"],
    queryFn: async () => {
      const res = await fetch(`${BASE}/api/watches`);
      if (!res.ok) throw new Error("Failed to fetch watches");
      return res.json();
    },
    refetchInterval: 60_000, // refresh every minute
  });
}

export function useCreateWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: { areaCode?: string; city?: string; country: string; label?: string }) => {
      const res = await fetch(`${BASE}/api/watches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watches"] }),
  });
}

export function useDeleteWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await fetch(`${BASE}/api/watches/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watches"] }),
  });
}

export function useDismissWatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`${BASE}/api/watches/${id}/dismiss`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to dismiss");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["watches"] }),
  });
}
