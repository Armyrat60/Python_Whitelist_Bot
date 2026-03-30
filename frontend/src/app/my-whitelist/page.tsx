"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Save, Shield, Clock, Tag, BadgeCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useGuild } from "@/hooks/use-guild";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  is_manual: boolean;
  tier_name: string | null;
  effective_slot_limit: number;
  steam_ids: string[];
  eos_ids: string[];
  verified_steam_ids: string[];
  verified_eos_ids: string[];
  status: string | null;
  expires_at: string | null;
  category_name: string | null;
}

function useMyWhitelists(activeGuildId: string | undefined) {
  return useQuery<MyWhitelistData[]>({
    queryKey: ["my-whitelists", activeGuildId ?? null],
    queryFn: () => api.get<MyWhitelistData[]>("/api/my-whitelist"),
    enabled: !!activeGuildId,
  });
}

function guildIconUrl(guildId: string, icon: string) {
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp?size=64`;
}

function GuildBanner({ guildId, name, icon }: { guildId: string; name: string; icon: string | null }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <Avatar size="lg">
        {icon ? (
          <AvatarImage src={guildIconUrl(guildId, icon)} alt={name} />
        ) : null}
        <AvatarFallback className="text-sm font-semibold">
          {name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Whitelist Portal
        </p>
        <h2 className="text-xl font-bold text-foreground">{name}</h2>
      </div>
    </div>
  );
}

// ── Status helpers ───────────────────────────────────────────────────────────

function computeStatus(status: string | null, expiresAt: string | null): "active" | "expiring_soon" | "expired" | "inactive" {
  if (status === "inactive" || status === "deactivated") return "inactive";
  if (!expiresAt) return status === "active" ? "active" : "inactive";
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return "expired";
  if (msLeft < 7 * 24 * 60 * 60 * 1000) return "expiring_soon"; // < 7 days
  return "active";
}

function formatExpiry(expiresAt: string): string {
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  return `Expires in ${days} days`;
}

function StatusBadge({ status, expiresAt }: { status: string | null; expiresAt: string | null }) {
  const computed = computeStatus(status, expiresAt);
  if (computed === "active") {
    return (
      <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border">
        Active
      </Badge>
    );
  }
  if (computed === "expiring_soon") {
    return (
      <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 border">
        <Clock className="mr-1 h-3 w-3" />
        Expiring Soon
      </Badge>
    );
  }
  if (computed === "expired") {
    return (
      <Badge className="bg-red-500/15 text-red-400 border-red-500/30 border">
        Expired
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">Inactive</Badge>
  );
}

// ── Steam verification toast (needs Suspense boundary for useSearchParams) ───

function SteamVerifyToast() {
  const searchParams = useSearchParams();
  useEffect(() => {
    const result = searchParams.get("steam_verify");
    if (!result) return;
    const steamId = searchParams.get("steam_id");
    if (result === "success") {
      toast.success(`Steam ID ${steamId} verified!`);
    } else if (result === "cancelled") {
      toast.info("Steam verification cancelled.");
    } else {
      const reason = searchParams.get("reason");
      if (reason === "id_not_registered") {
        toast.error(`Steam ID ${steamId} isn't one of your registered IDs. Add it first, then verify.`);
      } else {
        toast.error("Steam verification failed. Please try again.");
      }
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("steam_verify");
    url.searchParams.delete("steam_id");
    url.searchParams.delete("reason");
    window.history.replaceState({}, "", url.toString());
  }, [searchParams]);
  return null;
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function MyWhitelistPage() {
  const { activeGuild } = useGuild();
  const { data, isLoading, error } = useMyWhitelists(activeGuild?.id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-64 rounded-xl" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const guildBanner = activeGuild ? (
    <GuildBanner guildId={activeGuild.id} name={activeGuild.name} icon={activeGuild.icon} />
  ) : null;

  if (error || !data) {
    return (
      <>
        {guildBanner}
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">Unable to load your whitelist data</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Please try again later or contact{" "}
            {activeGuild ? <strong>{activeGuild.name}</strong> : "a server administrator"} for help.
          </p>
        </div>
      </>
    );
  }

  if (data.length === 0) {
    return (
      <>
        {guildBanner}
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">You don&apos;t have whitelist access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact{" "}
            {activeGuild ? <strong>{activeGuild.name}</strong> : "a server administrator"} to get whitelisted.
          </p>
        </div>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={null}><SteamVerifyToast /></Suspense>
      {guildBanner}
      <p className="text-sm text-muted-foreground">
        Entries here are the same as using{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">/whitelist</code> in Discord.
      </p>
      {data.map((wl) =>
        wl.is_manual ? (
          <ManualRosterCard key={wl.whitelist_slug} data={wl} />
        ) : (
          <WhitelistCard key={wl.whitelist_slug} data={wl} />
        )
      )}
    </div>
  );
}

// ── Manual Roster card (read-only) ───────────────────────────────────────────

function ManualRosterCard({ data }: { data: MyWhitelistData }) {
  const allIds = [...(data.steam_ids ?? []), ...(data.eos_ids ?? [])];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{data.whitelist_name}</CardTitle>
          <Badge
            variant="outline"
            style={{
              background: "color-mix(in srgb, var(--accent-secondary) 12%, transparent)",
              color: "var(--accent-secondary)",
              border: "1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent)",
            }}
          >
            Manual Roster
          </Badge>
          <StatusBadge status={data.status} expiresAt={data.expires_at} />
        </div>
        <CardDescription className="flex flex-wrap items-center gap-3 pt-1">
          {data.category_name && (
            <span className="flex items-center gap-1">
              <Tag className="h-3 w-3" />
              {data.category_name}
            </span>
          )}
          {data.expires_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatExpiry(data.expires_at)}
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No identifiers on file. Contact an admin to add your Steam ID.</p>
        ) : (
          <div className="space-y-2">
            {(data.steam_ids ?? []).map((id) => (
              <div key={id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 shrink-0">Steam64</Badge>
                <code className="text-xs text-muted-foreground">{id}</code>
              </div>
            ))}
            {(data.eos_ids ?? []).map((id) => (
              <div key={id} className="flex items-center gap-2">
                <Badge variant="outline" className="text-blue-400 border-blue-500/30 shrink-0">EOS</Badge>
                <code className="text-xs text-muted-foreground">{id}</code>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          This roster is managed by your server admins. Contact them to update your Steam ID.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Discord Roster card (editable) ───────────────────────────────────────────

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

function buildSlotsFromData(d: MyWhitelistData): string[] {
  const existingIds = [...(d.steam_ids ?? []), ...(d.eos_ids ?? [])];
  const padded = [...existingIds];
  while (padded.length < d.effective_slot_limit) padded.push("");
  return padded;
}

function WhitelistCard({ data }: { data: MyWhitelistData }) {
  const totalSlots = data.effective_slot_limit;
  const serverFingerprint = useMemo(
    () =>
      `${data.whitelist_slug}|${data.effective_slot_limit}|${(data.steam_ids ?? []).join(",")}|${(data.eos_ids ?? []).join(",")}`,
    [data.whitelist_slug, data.effective_slot_limit, data.steam_ids, data.eos_ids]
  );

  const [slots, setSlots] = useState<string[]>(() => buildSlotsFromData(data));
  const [baseline, setBaseline] = useState<string[]>(() => buildSlotsFromData(data));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = buildSlotsFromData(data);
    setSlots(next);
    setBaseline(next);
  }, [serverFingerprint]);

  const isDirty = useMemo(
    () => JSON.stringify(slots) !== JSON.stringify(baseline),
    [slots, baseline]
  );

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const usedSlots = slots.filter(Boolean).length;

  function updateSlot(index: number, value: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleBlur(index: number) {
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
    const steamIds: string[] = [];
    const eosIds: string[] = [];

    for (let val of slots) {
      val = val.trim();
      if (!val) continue;
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
      setBaseline([...slots]);
    } catch {
      toast.error("Failed to save whitelist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{data.whitelist_name}</CardTitle>
          {data.tier_name && (
            <Badge
              variant="secondary"
              style={{
                background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)",
                color: "var(--accent-primary)",
                border: "1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)",
              }}
            >
              {data.tier_name}
            </Badge>
          )}
          {data.status && (
            <StatusBadge status={data.status} expiresAt={data.expires_at} />
          )}
        </div>
        <CardDescription className="flex flex-wrap items-center gap-3 pt-1">
          <span>{usedSlots} / {totalSlots} slot{totalSlots !== 1 ? "s" : ""} used</span>
          {data.expires_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatExpiry(data.expires_at)}
            </span>
          )}
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
              {val && (
                (data.verified_steam_ids ?? []).concat(data.verified_eos_ids ?? []).includes(val.toLowerCase()) ||
                (data.verified_steam_ids ?? []).concat(data.verified_eos_ids ?? []).includes(val)
              ) && (
                <span title="Bridge Verified">
                  <BadgeCheck className="h-4 w-4 text-emerald-400 shrink-0" />
                </span>
              )}
            </div>
          );
        })}
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="text-black font-semibold"
          style={{ background: "var(--accent-primary)" }}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save"}
        </Button>
      </CardFooter>
    </Card>
  );
}
