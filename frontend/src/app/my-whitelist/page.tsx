"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Save, Shield } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWhitelists } from "@/hooks/use-settings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

interface MyWhitelistData {
  whitelist_slug: string;
  whitelist_name: string;
  tier_name: string | null;
  effective_slot_limit: number;
  steam_ids: string[];
  eos_ids: string[];
}

function useMyWhitelists() {
  return useQuery<MyWhitelistData[]>({
    queryKey: ["my-whitelists"],
    queryFn: () => api.get<MyWhitelistData[]>("/api/my-whitelist"),
  });
}

export default function MyWhitelistPage() {
  const { data, isLoading, error } = useMyWhitelists();

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          Unable to load your whitelist data
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Please try again later or contact an administrator.
        </p>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          You don&apos;t have whitelist access
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Contact a server administrator to get whitelisted.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.map((wl) => (
        <WhitelistCard key={wl.whitelist_slug} data={wl} />
      ))}
    </div>
  );
}

// Auto-detect ID type from value
function detectIdType(val: string): "steam64" | "eosid" | "steam_url" | "unknown" {
  if (/^7656119\d{10}$/.test(val)) return "steam64";
  if (/^[0-9a-f]{32}$/i.test(val)) return "eosid";
  if (/steamcommunity\.com\/profiles\/\d{17}/i.test(val)) return "steam_url";
  return "unknown";
}

function extractSteam64FromUrl(val: string): string {
  const m = val.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  return m ? m[1] : val;
}

function WhitelistCard({ data }: { data: MyWhitelistData }) {
  // Combine all IDs into unified slots
  const existingIds = [
    ...(data.steam_ids ?? []),
    ...(data.eos_ids ?? []),
  ];
  const totalSlots = data.effective_slot_limit;

  // Pad to slot count
  const initial = [...existingIds];
  while (initial.length < totalSlots) initial.push("");

  const [slots, setSlots] = useState<string[]>(initial);
  const [saving, setSaving] = useState(false);

  const usedSlots = slots.filter(Boolean).length;

  function updateSlot(index: number, value: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleBlur(index: number) {
    // Auto-convert Steam URLs to Steam64 IDs
    const val = slots[index]?.trim();
    if (val && detectIdType(val) === "steam_url") {
      updateSlot(index, extractSteam64FromUrl(val));
    }
  }

  function getSlotStatus(val: string): { valid: boolean; type: string } {
    if (!val) return { valid: true, type: "empty" };
    const t = detectIdType(val);
    if (t === "steam64") return { valid: true, type: "Steam64" };
    if (t === "eosid") return { valid: true, type: "EOS" };
    if (t === "steam_url") return { valid: true, type: "Steam URL" };
    return { valid: false, type: "Invalid" };
  }

  async function handleSave() {
    // Normalize and classify
    const steamIds: string[] = [];
    const eosIds: string[] = [];

    for (let val of slots) {
      val = val.trim();
      if (!val) continue;
      // Extract Steam64 from URL
      if (detectIdType(val) === "steam_url") val = extractSteam64FromUrl(val);
      const t = detectIdType(val);
      if (t === "steam64") steamIds.push(val);
      else if (t === "eosid") eosIds.push(val.toLowerCase());
      else {
        toast.error(`Invalid ID: ${val}`);
        return;
      }
    }

    if (steamIds.length + eosIds.length > totalSlots) {
      toast.error(`You can only use ${totalSlots} slot${totalSlots !== 1 ? "s" : ""}`);
      return;
    }

    setSaving(true);
    try {
      await api.put(`/api/my-whitelist/${data.whitelist_slug}`, {
        steam_ids: steamIds,
        eos_ids: eosIds,
      });
      toast.success("Whitelist saved!");
    } catch {
      toast.error("Failed to save whitelist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {data.whitelist_name}
          {data.tier_name && (
            <Badge variant="secondary" className="bg-orange-500/15 text-orange-400 border-orange-500/30">
              {data.tier_name}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {usedSlots} / {totalSlots} slot{totalSlots !== 1 ? "s" : ""} used
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {slots.map((val, i) => {
          const status = getSlotStatus(val);
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-12 text-right text-xs text-muted-foreground">
                Slot {i + 1}
              </span>
              <Input
                value={val}
                onChange={(e) => updateSlot(i, e.target.value)}
                onBlur={() => handleBlur(i)}
                placeholder="Paste Steam64, EOS ID, or Steam profile URL"
                className={!status.valid ? "border-destructive" : ""}
              />
              {val && (
                <Badge
                  variant="outline"
                  className={
                    status.type === "Steam64"
                      ? "text-emerald-400 border-emerald-500/30"
                      : status.type === "EOS"
                      ? "text-blue-400 border-blue-500/30"
                      : status.type === "Invalid"
                      ? "text-red-400 border-red-500/30"
                      : "text-violet-400 border-violet-500/30"
                  }
                >
                  {status.type}
                </Badge>
              )}
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={saving} className="bg-orange-600 hover:bg-orange-700">
          <Save className="mr-1.5 h-3.5 w-3.5" />
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
