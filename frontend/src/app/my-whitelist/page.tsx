"use client";

import { useState, useEffect } from "react";
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

function WhitelistCard({ data }: { data: MyWhitelistData }) {
  const [steamIds, setSteamIds] = useState<string[]>(data.steam_ids ?? []);
  const [eosIds, setEosIds] = useState<string[]>(data.eos_ids ?? []);
  const [saving, setSaving] = useState(false);

  // Pad arrays to slot limit for input fields
  const totalSlots = data.effective_slot_limit;
  const usedSlots = steamIds.filter(Boolean).length + eosIds.filter(Boolean).length;

  // Ensure we always have at least totalSlots entries to render inputs
  useEffect(() => {
    if (steamIds.length < totalSlots) {
      setSteamIds((prev) => [
        ...prev,
        ...Array(totalSlots - prev.length).fill(""),
      ]);
    }
  }, [totalSlots, steamIds.length]);

  function updateSteamId(index: number, value: string) {
    setSteamIds((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function validateSteamId(value: string): boolean {
    if (!value) return true;
    // Steam64 ID is a 17-digit number
    return /^\d{17}$/.test(value);
  }

  function validateEosId(value: string): boolean {
    if (!value) return true;
    // EOS IDs are hex strings, typically 32 chars
    return /^[0-9a-f]{32}$/i.test(value);
  }

  async function handleSave() {
    const filteredSteam = steamIds.filter(Boolean);
    const filteredEos = eosIds.filter(Boolean);

    // Validate
    for (const id of filteredSteam) {
      if (!validateSteamId(id)) {
        toast.error(`Invalid Steam64 ID: ${id}`);
        return;
      }
    }
    for (const id of filteredEos) {
      if (!validateEosId(id)) {
        toast.error(`Invalid EOS ID: ${id}`);
        return;
      }
    }

    if (filteredSteam.length + filteredEos.length > totalSlots) {
      toast.error(
        `You can only use ${totalSlots} slot${totalSlots !== 1 ? "s" : ""}`
      );
      return;
    }

    setSaving(true);
    try {
      await api.put(`/api/my-whitelist/${data.whitelist_slug}`, {
        steam_ids: filteredSteam,
        eos_ids: filteredEos,
      });
      toast.success("Whitelist saved");
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
            <Badge variant="secondary">{data.tier_name}</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {usedSlots} / {totalSlots} slot{totalSlots !== 1 ? "s" : ""} used
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Label className="text-xs text-muted-foreground">
          Steam64 IDs
        </Label>
        {Array.from({ length: Math.min(totalSlots, steamIds.length) }).map(
          (_, i) => (
            <div key={`steam-${i}`} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-muted-foreground">
                {i + 1}.
              </span>
              <Input
                value={steamIds[i] ?? ""}
                onChange={(e) => updateSteamId(i, e.target.value)}
                placeholder="76561198000000000"
                className={
                  steamIds[i] && !validateSteamId(steamIds[i])
                    ? "border-destructive"
                    : ""
                }
              />
            </div>
          )
        )}
      </CardContent>
      <CardFooter>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="mr-1.5 h-3.5 w-3.5" />
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
