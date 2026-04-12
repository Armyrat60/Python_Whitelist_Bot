"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Save, Shield, Clock, Tag, BadgeCheck, Trash2, ClipboardPaste, Zap } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useGuild } from "@/hooks/use-guild";
import { useSession } from "@/hooks/use-session";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

// ── Types ───────────────────────────────────────────────────────────────────

interface ProfileData {
  discord_id: string;
  username: string;
  avatar: string | null;
  is_booster: boolean;
  total_slots: number;
  used_slots: number;
  steam_ids: string[];
  eos_ids: string[];
  verified_steam_ids: string[];
  verified_eos_ids: string[];
  is_fully_linked: boolean;
}

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
  linked_ids: Record<string, string>;
  status: string | null;
  expires_at: string | null;
  category_name: string | null;
}

interface MyWhitelistResponse {
  profile: ProfileData;
  whitelists: MyWhitelistData[];
}

function useMyWhitelists(activeGuildId: string | undefined) {
  return useQuery<MyWhitelistResponse>({
    queryKey: ["my-whitelists", activeGuildId ?? null],
    queryFn: () => api.get<MyWhitelistResponse>("/api/my-whitelist"),
    enabled: !!activeGuildId,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function discordAvatarUrl(userId: string, avatar: string | null) {
  if (!avatar) return `https://cdn.discordapp.com/embed/avatars/${parseInt(userId) % 5}.png`;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=128`;
}

function guildIconUrl(guildId: string, icon: string) {
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.webp?size=64`;
}

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

function computeStatus(status: string | null, expiresAt: string | null): "active" | "expiring_soon" | "expired" | "inactive" {
  if (status === "inactive" || status === "deactivated") return "inactive";
  if (!expiresAt) return status === "active" ? "active" : "inactive";
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return "expired";
  if (msLeft < 7 * 24 * 60 * 60 * 1000) return "expiring_soon";
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

// ── Steam verification toast ────────────────────────────────────────────────

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

// ── Profile Card ────────────────────────────────────────────────────────────

function ProfileCard({ profile, guild }: { profile: ProfileData; guild: { id: string; name: string; icon: string | null } }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start gap-4">
          <Avatar size="lg" className="h-16 w-16">
            <AvatarImage src={discordAvatarUrl(profile.discord_id, profile.avatar)} alt={profile.username} />
            <AvatarFallback className="text-lg font-semibold">
              {profile.username.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold truncate">{profile.username}</h2>
              {profile.is_fully_linked ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border gap-1">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Linked
                </Badge>
              ) : profile.used_slots > 0 ? (
                <Badge className="bg-yellow-500/15 text-yellow-400 border-yellow-500/30 border">
                  Not Fully Linked
                </Badge>
              ) : (
                <Badge variant="secondary">No IDs Submitted</Badge>
              )}
              {profile.is_booster && (
                <Badge className="bg-pink-500/15 text-pink-400 border-pink-500/30 border">
                  Server Booster
                </Badge>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <span>{profile.used_slots} / {profile.total_slots} slots used</span>
              <span>{profile.verified_steam_ids.length} verified Steam ID{profile.verified_steam_ids.length !== 1 ? "s" : ""}</span>
              {profile.verified_eos_ids.length > 0 && (
                <span>{profile.verified_eos_ids.length} verified EOS ID{profile.verified_eos_ids.length !== 1 ? "s" : ""}</span>
              )}
            </div>
            {!profile.is_fully_linked && profile.used_slots > 0 && (
              <p className="mt-2 text-xs text-yellow-400/80">
                Verify your IDs to link them to your account. Use <code className="rounded bg-muted px-1 py-0.5">/verify</code> in Discord or click the verify link next to unlinked IDs below.
              </p>
            )}
          </div>
          {guild.icon && (
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={guildIconUrl(guild.id, guild.icon)} alt={guild.name} />
              <AvatarFallback className="text-xs">{guild.name.slice(0, 2)}</AvatarFallback>
            </Avatar>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Whitelist Card (editable) ───────────────────────────────────────────────

function buildSlotsFromData(d: MyWhitelistData): string[] {
  const existingIds = [...(d.steam_ids ?? []), ...(d.eos_ids ?? [])];
  const padded = [...existingIds];
  while (padded.length < d.effective_slot_limit) padded.push("");
  return padded;
}

function WhitelistCard({ data, hideTitle }: { data: MyWhitelistData; hideTitle?: boolean }) {
  const queryClient = useQueryClient();
  const totalSlots = data.effective_slot_limit;
  const serverFingerprint = useMemo(
    () =>
      `${data.whitelist_slug}|${data.effective_slot_limit}|${(data.steam_ids ?? []).join(",")}|${(data.eos_ids ?? []).join(",")}`,
    [data.whitelist_slug, data.effective_slot_limit, data.steam_ids, data.eos_ids]
  );

  const [slots, setSlots] = useState<string[]>(() => buildSlotsFromData(data));
  const [baseline, setBaseline] = useState<string[]>(() => buildSlotsFromData(data));
  const [saving, setSaving] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState("");

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

  function handleClearAll() {
    setSlots(Array(totalSlots).fill(""));
  }

  function handleBulkApply() {
    const lines = bulkText
      .split(/[,\n\r]+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (detectIdType(l) === "steam_url" ? extractSteam64FromUrl(l) : l));

    const newSlots = Array(totalSlots).fill("");
    for (let i = 0; i < Math.min(lines.length, totalSlots); i++) {
      newSlots[i] = lines[i];
    }
    setSlots(newSlots);
    setBulkMode(false);
    setBulkText("");
    if (lines.length > totalSlots) {
      toast.error(`You have ${totalSlots} slots but pasted ${lines.length} IDs. Only the first ${totalSlots} were kept.`);
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
      queryClient.invalidateQueries({ queryKey: ["my-whitelists"] });
    } catch {
      toast.error("Failed to save whitelist");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {!hideTitle && <CardTitle className="text-base">{data.whitelist_name}</CardTitle>}
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
            {data.expires_at && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {formatExpiry(data.expires_at)}
              </span>
            )}
          </div>
          <span className="text-sm text-muted-foreground">{usedSlots} / {totalSlots} slots</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Instructions */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
          <p className="text-sm font-medium">How to add your IDs</p>
          <p className="text-xs text-muted-foreground">
            Paste one ID per slot. We accept:
          </p>
          <ul className="text-xs text-muted-foreground space-y-0.5 pl-4 list-disc">
            <li><strong>Steam64 ID</strong> — 17-digit number starting with 7656 (e.g. <code className="bg-muted px-1 rounded">76561198012345678</code>)</li>
            <li><strong>Steam Profile URL</strong> — steamcommunity.com/profiles/... (auto-converted)</li>
            <li><strong>EOS ID</strong> — 32-character hex string from Epic Online Services</li>
          </ul>
          <p className="text-xs text-muted-foreground">
            After adding your ID, verify it using <code className="bg-muted px-1 rounded">/verify</code> in Discord or click &quot;Not Linked&quot; next to the ID.
          </p>
        </div>

        {/* Bulk paste / Clear all toolbar */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setBulkMode(!bulkMode); setBulkText(slots.filter(Boolean).join("\n")); }}
          >
            <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" />
            {bulkMode ? "Cancel Bulk" : "Bulk Paste"}
          </Button>
          {usedSlots > 0 && (
            <Button variant="outline" size="sm" onClick={handleClearAll}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear All
            </Button>
          )}
        </div>

        {/* Bulk paste mode */}
        {bulkMode ? (
          <div className="space-y-2">
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"Paste all your IDs here, one per line or comma-separated.\n\nExample:\n76561198012345678\n76561198087654321\nabc123def456..."}
              rows={Math.min(Math.max(totalSlots, 4), 12)}
              className="font-mono text-xs"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleBulkApply}>
                <Zap className="mr-1.5 h-3.5 w-3.5" />
                Apply ({bulkText.split(/[,\n\r]+/).filter((l) => l.trim()).length} IDs)
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBulkMode(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          /* Individual slot inputs */
          <div className="space-y-1.5">
            {slots.map((val, i) => {
              const status = getSlotStatus(val);
              const linkSource = val ? (data.linked_ids?.[val] || data.linked_ids?.[val.toLowerCase()]) : undefined;
              const isLinked = val ? (!!linkSource ||
                (data.verified_steam_ids ?? []).concat(data.verified_eos_ids ?? []).includes(val) ||
                (data.verified_steam_ids ?? []).concat(data.verified_eos_ids ?? []).includes(val.toLowerCase())
              ) : false;

              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-8 text-right text-xs text-muted-foreground shrink-0">{i + 1}</span>
                  <Input
                    value={val}
                    onChange={(e) => updateSlot(i, e.target.value)}
                    onBlur={() => handleBlur(i)}
                    placeholder="Steam64 ID, EOS ID, or Steam profile URL"
                    className={`text-sm ${!status.valid ? "border-destructive" : ""}`}
                  />
                  {val && isLinked && (
                    <Badge variant="outline" className="shrink-0 text-emerald-400 border-emerald-500/30 gap-1 text-[10px]">
                      <BadgeCheck className="h-3 w-3" />
                      Linked
                    </Badge>
                  )}
                  {val && !isLinked && status.type === "Steam64" && (
                    <a href="/api/steam/verify" className="shrink-0">
                      <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 cursor-pointer hover:bg-yellow-500/10 text-[10px]">
                        Not Linked
                      </Badge>
                    </a>
                  )}
                  {val && !isLinked && status.type === "EOS" && (
                    <Badge variant="outline" className="shrink-0 text-muted-foreground border-white/10 text-[10px]">
                      In-game
                    </Badge>
                  )}
                  {val && !status.valid && (
                    <Badge variant="outline" className="shrink-0 text-red-400 border-red-500/30 text-[10px]">
                      Invalid
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="text-black font-semibold"
          style={{ background: "var(--accent-primary)" }}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// ── Manual Roster card (read-only) ──────────────────────────────────────────

function ManualRosterCard({ data }: { data: MyWhitelistData }) {
  const allIds = [...(data.steam_ids ?? []), ...(data.eos_ids ?? [])];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {data.category_name && (
            <Badge variant="outline" className="gap-1">
              <Tag className="h-3 w-3" />
              {data.category_name}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {allIds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No identifiers on file. Contact an admin to add your Steam ID.</p>
        ) : (
          <div className="space-y-1.5">
            {(data.steam_ids ?? []).map((id) => {
              const isLinked = !!(data.linked_ids?.[id]) || (data.verified_steam_ids ?? []).includes(id);
              return (
                <div key={id} className="flex items-center gap-2 text-sm">
                  <code className="text-xs text-muted-foreground">{id}</code>
                  <Badge variant="outline" className={`text-[10px] ${isLinked ? "text-emerald-400 border-emerald-500/30" : "text-yellow-400 border-yellow-500/30"}`}>
                    {isLinked ? "Linked" : "Not Linked"}
                  </Badge>
                </div>
              );
            })}
            {(data.eos_ids ?? []).map((id) => (
              <div key={id} className="flex items-center gap-2 text-sm">
                <code className="text-xs text-muted-foreground">{id}</code>
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">EOS</Badge>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Managed by server admins. Contact them to update your IDs.
        </p>
      </CardContent>
    </Card>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function MyWhitelistPage() {
  const { activeGuild } = useGuild();
  const { data, isLoading, error } = useMyWhitelists(activeGuild?.id);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Unable to load your whitelist data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Please try again later or contact{" "}
          {activeGuild ? <strong>{activeGuild.name}</strong> : "a server administrator"} for help.
        </p>
      </div>
    );
  }

  const { profile, whitelists } = data;
  const hideTitle = whitelists.filter((wl) => !wl.is_manual).length <= 1;

  if (whitelists.length === 0) {
    return (
      <div className="space-y-6">
        {activeGuild && <ProfileCard profile={profile} guild={activeGuild} />}
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-4 h-12 w-12 text-muted-foreground" />
          <h2 className="text-lg font-semibold">You don&apos;t have whitelist access</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Contact{" "}
            {activeGuild ? <strong>{activeGuild.name}</strong> : "a server administrator"} to get whitelisted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Suspense fallback={null}><SteamVerifyToast /></Suspense>

      {/* Profile Card */}
      {activeGuild && <ProfileCard profile={profile} guild={activeGuild} />}

      {/* Whitelist Cards */}
      {whitelists.map((wl) =>
        wl.is_manual ? (
          <ManualRosterCard key={wl.whitelist_slug} data={wl} />
        ) : (
          <WhitelistCard key={wl.whitelist_slug} data={wl} hideTitle={hideTitle} />
        )
      )}
    </div>
  );
}
