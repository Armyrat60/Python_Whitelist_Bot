"use client";

import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
  X,
  Save,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/use-session";
import type { WhitelistUser } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  ID-type helpers                                                    */
/* ------------------------------------------------------------------ */

function detectIdType(
  value: string
): "steam64" | "eosid" | "steam_url" | "invalid" | "empty" {
  const v = value.trim();
  if (!v) return "empty";
  if (/^7656119\d{10}$/.test(v)) return "steam64";
  if (/^[0-9a-fA-F]{32}$/.test(v)) return "eosid";
  if (v.includes("steamcommunity.com/profiles/")) return "steam_url";
  return "invalid";
}

/** Extract Steam64 from a Steam profile URL */
function extractSteam64FromUrl(value: string): string | null {
  const match = value.match(
    /steamcommunity\.com\/profiles\/(\d{17})/
  );
  return match?.[1] ?? null;
}

/** Normalize an input value: if it's a Steam URL, extract the ID */
function normalizeSlotValue(value: string): string {
  const type = detectIdType(value);
  if (type === "steam_url") {
    return extractSteam64FromUrl(value) ?? value;
  }
  return value.trim();
}

/** Display label for detected type */
function idTypeLabel(
  value: string
): { label: string; color: string } | null {
  const type = detectIdType(value);
  switch (type) {
    case "steam64":
      return { label: "Steam64", color: "text-emerald-400 border-emerald-500/30" };
    case "eosid":
      return { label: "EOS", color: "text-blue-400 border-blue-500/30" };
    case "steam_url":
      return { label: "Steam URL", color: "text-violet-400 border-violet-500/30" };
    case "invalid":
      return { label: "Invalid", color: "text-red-400 border-red-500/30" };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/*  UserDetailSheet                                                    */
/* ------------------------------------------------------------------ */

export function UserDetailSheet({
  user,
  onClose,
}: {
  user: WhitelistUser;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const isAdmin = useIsAdmin();
  const isOrphan = parseInt(user.discord_id) < 0;

  // Combine all IDs into unified slots
  const initialSlots = [
    ...(user.steam_ids ?? []),
    ...(user.eos_ids ?? []),
  ];
  if (initialSlots.length === 0) initialSlots.push("");

  const [slots, setSlots] = useState<string[]>(initialSlots);
  const [status, setStatus] = useState(user.status);
  const [plan, setPlan] = useState(user.last_plan_name ?? "");
  const [planSlotLimit, setPlanSlotLimit] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState(user.expires_at ?? "");
  const [notes, setNotes] = useState(user.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Link-to-Discord state (orphan records only)
  const [suggestions, setSuggestions] = useState<{discord_id: string; discord_name: string; score: number; match_via: string; username?: string}[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [linkResults, setLinkResults] = useState<{discord_id: string; discord_name: string}[]>([]);
  const [linkSelected, setLinkSelected] = useState<{discord_id: string; discord_name: string} | null>(null);
  const [manualDiscordId, setManualDiscordId] = useState("");
  const [manualDiscordName, setManualDiscordName] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkSearching, setLinkSearching] = useState(false);

  // Auto-fetch top suggestions when sheet opens for an orphan
  useEffect(() => {
    if (!isOrphan) return;
    setSuggestionsLoading(true);
    api.get<{suggestions: typeof suggestions}>(`/api/admin/reconcile/suggest?orphan_id=${user.discord_id}&limit=5`)
      .then((res) => setSuggestions(res.suggestions ?? []))
      .catch(() => setSuggestions([]))
      .finally(() => setSuggestionsLoading(false));
  }, [isOrphan, user.discord_id]);

  // Debounced search for existing Discord users
  useEffect(() => {
    if (!isOrphan || !linkSearch.trim() || linkSearch.length < 2) {
      setLinkResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLinkSearching(true);
      try {
        const res = await api.get<{users: WhitelistUser[]}>(`/api/admin/users?search=${encodeURIComponent(linkSearch)}&per_page=20`);
        setLinkResults(
          (res.users ?? [])
            .filter((u) => parseInt(u.discord_id) > 0)
            .map((u) => ({ discord_id: u.discord_id, discord_name: u.discord_name }))
            .filter((u, i, arr) => arr.findIndex((x) => x.discord_id === u.discord_id) === i)
        );
      } catch {
        setLinkResults([]);
      } finally {
        setLinkSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [linkSearch, isOrphan]);

  async function handleLink() {
    const targetId = linkSelected?.discord_id || manualDiscordId.trim();
    const targetName = linkSelected?.discord_name || manualDiscordName.trim() || user.discord_name;
    if (!targetId || !/^\d{17,20}$/.test(targetId)) {
      toast.error("Enter a valid Discord ID (17-20 digits)");
      return;
    }
    setLinking(true);
    try {
      await api.post("/api/admin/reconcile/apply", {
        matches: [{ orphan_discord_id: user.discord_id, real_discord_id: targetId, real_discord_name: targetName }],
      });
      toast.success(`Linked ${user.discord_name} → ${targetName}`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    } catch {
      toast.error("Failed to link user");
    } finally {
      setLinking(false);
    }
  }

  const allTierEntries: { label: string; value: string; slots: number; categoryName: string }[] = [];

  function updateSlot(idx: number, value: string) {
    setSlots((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  /** When the input loses focus, auto-normalize Steam URLs to Steam64 */
  function handleSlotBlur(idx: number) {
    setSlots((prev) => {
      const next = [...prev];
      const normalized = normalizeSlotValue(next[idx]);
      if (normalized !== next[idx]) {
        next[idx] = normalized;
      }
      return next;
    });
  }

  function addSlot() {
    setSlots((prev) => [...prev, ""]);
  }

  function removeSlot(idx: number) {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    const steamIds: string[] = [];
    const eosIds: string[] = [];

    for (const slot of slots) {
      // Normalize before saving
      const v = normalizeSlotValue(slot);
      if (!v) continue;
      const type = detectIdType(v);
      if (type === "steam64") steamIds.push(v);
      else if (type === "eosid") eosIds.push(v);
      else {
        toast.error(`Invalid ID: ${v}. Must be a Steam64 (17 digits starting with 7656119) or EOS ID (32 hex chars).`);
        return;
      }
    }

    if (steamIds.length === 0 && eosIds.length === 0) {
      toast.error("At least one valid ID is required");
      return;
    }

    setSaving(true);
    try {
      await api.patch(
        `/api/admin/users/${user.discord_id}/${user.whitelist_slug}`,
        {
          status,
          plan: plan || null,
          plan_slot_limit: planSlotLimit,
          steam_ids: steamIds,
          eos_ids: eosIds,
          ...(isAdmin ? { expires_at: expiresAt || null, notes: notes || null } : {}),
        }
      );
      toast.success("User updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClose();
    } catch {
      toast.error("Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setRemoving(true);
    try {
      await api.delete(
        `/api/admin/users/${user.discord_id}/${user.whitelist_slug}`
      );
      toast.success(`Removed ${user.discord_name}`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    } catch {
      toast.error("Failed to remove user");
    } finally {
      setRemoving(false);
    }
  }

  const usedSlots = slots.filter((s) => s.trim()).length;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">

      {/* ── Link to Discord (orphan only) ── */}
      {isOrphan && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3">
          <p className="text-xs font-medium text-amber-400">Link to Discord User</p>

          {/* Auto-computed suggestions */}
          {suggestionsLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Finding possible matches…
            </div>
          )}
          {!suggestionsLoading && suggestions.length > 0 && !linkSelected && (
            <div className="space-y-1">
              <p className="text-[11px] text-muted-foreground">Possible matches</p>
              {suggestions.map((s) => (
                <button
                  key={s.discord_id}
                  className="w-full text-left rounded-md border border-border/60 bg-card px-3 py-2 text-xs hover:bg-white/5 flex items-center justify-between gap-2"
                  onClick={() => { setLinkSelected({discord_id: s.discord_id, discord_name: s.discord_name}); setLinkSearch(""); }}
                >
                  <span className="font-medium truncate">{s.discord_name}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {s.username && s.username !== s.discord_name && (
                      <span className="text-muted-foreground text-[10px]">@{s.username}</span>
                    )}
                    <span className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      s.score >= 0.90 ? "bg-emerald-500/15 text-emerald-400" :
                      s.score >= 0.75 ? "bg-amber-500/15 text-amber-400" :
                      "bg-white/5 text-muted-foreground"
                    )}>
                      {Math.round(s.score * 100)}%
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {!suggestionsLoading && suggestions.length === 0 && !linkSelected && (
            <p className="text-[11px] text-muted-foreground">No automatic matches found — search or enter Discord ID below.</p>
          )}

          {/* Search existing linked users */}
          <div className="space-y-1.5">
            <Label className="text-[11px] text-muted-foreground">Search by name</Label>
            <div className="relative">
              <Input
                value={linkSearch}
                onChange={(e) => { setLinkSearch(e.target.value); setLinkSelected(null); }}
                placeholder="Type a Discord username…"
                className="h-8 text-xs pr-7"
              />
              {linkSearching && <Loader2 className="absolute right-2 top-2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {linkResults.length > 0 && !linkSelected && (
              <div className="rounded-md border border-border bg-card max-h-36 overflow-y-auto divide-y divide-border/50">
                {linkResults.map((r) => (
                  <button
                    key={r.discord_id}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 flex items-center justify-between gap-2"
                    onClick={() => { setLinkSelected(r); setLinkSearch(r.discord_name); setManualDiscordId(""); setManualDiscordName(""); }}
                  >
                    <span className="font-medium">{r.discord_name}</span>
                    <span className="font-mono text-muted-foreground text-[10px]">{r.discord_id}</span>
                  </button>
                ))}
              </div>
            )}
            {linkSelected && (
              <div className="flex items-center gap-2 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs">
                <span className="text-sky-400">✓ {linkSelected.discord_name}</span>
                <span className="font-mono text-muted-foreground text-[10px]">{linkSelected.discord_id}</span>
                <button className="ml-auto text-muted-foreground hover:text-foreground" onClick={() => { setLinkSelected(null); setLinkSearch(""); }}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          {/* Manual Discord ID fallback */}
          {!linkSelected && (
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Or paste Discord ID manually</Label>
              <div className="flex gap-2">
                <Input value={manualDiscordId} onChange={(e) => setManualDiscordId(e.target.value)} placeholder="Discord ID (17-20 digits)" className="h-8 text-xs font-mono flex-1" />
                <Input value={manualDiscordName} onChange={(e) => setManualDiscordName(e.target.value)} placeholder="Name (optional)" className="h-8 text-xs w-36" />
              </div>
            </div>
          )}

          <Button
            size="sm"
            className="w-full"
            disabled={linking || (!linkSelected && (!manualDiscordId || !/^\d{17,20}$/.test(manualDiscordId.trim())))}
            onClick={handleLink}
          >
            {linking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Link to Discord User
          </Button>
        </div>
      )}

      {/* Meta info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Whitelist</Label>
          <Badge variant="outline">{user.whitelist_name}</Badge>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Role / Plan</Label>
          <Select
            value={plan}
            onValueChange={(v) => {
              const entry = allTierEntries.find((e) => e.value === v);
              setPlan(v ?? "");
              setPlanSlotLimit(entry?.slots ?? null);
            }}
          >
            <SelectTrigger className="h-8 w-full">
              <SelectValue placeholder="— no tier —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">— no tier —</SelectItem>
              {allTierEntries.map((e) => (
                <SelectItem key={`${e.categoryName}-${e.value}`} value={e.value}>
                  <span className="flex items-center gap-2">
                    {e.label}
                    <span className="text-[10px] text-muted-foreground">
                      ({e.slots} slot{e.slots !== 1 ? "s" : ""})
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {planSlotLimit !== null && planSlotLimit !== user.effective_slot_limit && (
            <p className="text-[11px] text-amber-400">
              Slot limit will update to {planSlotLimit}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Slots</Label>
          <p className={cn("text-sm", user.effective_slot_limit === 0 ? "text-red-400 font-medium" : "")}>
            {user.effective_slot_limit === 0 ? "No Access" : `${usedSlots} / ${user.effective_slot_limit}`}
          </p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={status} onValueChange={(v) => v && setStatus(v)}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Unified Slots — auto-detect Steam64, EOS ID, or Steam URL */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">
          Slots ({usedSlots}/{user.effective_slot_limit})
        </Label>
        {slots.map((id, idx) => {
          const typeInfo = idTypeLabel(id);
          return (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                Slot {idx + 1}
              </span>
              <Input
                className="h-8 flex-1 font-mono text-xs"
                value={id}
                onChange={(e) => updateSlot(idx, e.target.value)}
                onBlur={() => handleSlotBlur(idx)}
                placeholder="Paste Steam64, EOS ID, or Steam profile URL"
              />
              {/* Type indicator */}
              {typeInfo && (
                <Badge
                  variant="outline"
                  className={cn("shrink-0 text-[10px]", typeInfo.color)}
                >
                  {typeInfo.label}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => removeSlot(idx)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={addSlot}>
            <Plus className="mr-1 h-3 w-3" /> Add Slot
          </Button>
          {user.effective_slot_limit === 0 && (
            <span className="text-[11px] text-red-400">
              No slots — user has no whitelist access
            </span>
          )}
          {user.effective_slot_limit > 0 && usedSlots > user.effective_slot_limit && (
            <span className="text-[11px] text-amber-400">
              Over limit ({usedSlots} saved, {user.effective_slot_limit} exported) — only the first {user.effective_slot_limit} ID{user.effective_slot_limit !== 1 ? "s" : ""} will appear in the whitelist file
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Paste any ID — Steam64 (17 digits starting with 7656119), EOS (32 hex chars), or a Steam profile URL are auto-detected. URLs are converted to Steam64 on blur.
        </p>
      </div>

      {/* Expiry & Notes (admin only) */}
      {isAdmin && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Expiry Date{" "}
              <span className="text-muted-foreground/60">(optional — leave blank for no expiry)</span>
            </Label>
            {/* Quick-set presets */}
            <div className="flex gap-1.5 flex-wrap">
              {[
                { label: "30d", days: 30 },
                { label: "60d", days: 60 },
                { label: "90d", days: 90 },
                { label: "1yr", days: 365 },
                { label: "Clear", days: -1 },
              ].map(({ label, days }) => {
                const val = days === -1 ? "" : (() => {
                  const d = new Date();
                  d.setDate(d.getDate() + days);
                  return d.toISOString().split("T")[0];
                })();
                const current = expiresAt ? expiresAt.split("T")[0] : "";
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setExpiresAt(val)}
                    className="rounded border px-2 py-0.5 text-[11px] transition-colors hover:text-foreground"
                    style={{
                      borderColor: current === val && val !== "" ? "var(--accent-primary)" : "rgba(255,255,255,0.12)",
                      color: current === val && val !== "" ? "var(--accent-primary)" : days === -1 ? "rgba(239,68,68,0.7)" : "rgba(255,255,255,0.45)",
                      background: current === val && val !== "" ? "color-mix(in srgb, var(--accent-primary) 10%, transparent)" : "transparent",
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <Input
              type="date"
              className="h-8 text-xs"
              value={expiresAt ? expiresAt.split("T")[0] : ""}
              onChange={(e) => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
            <Input
              className="h-8 text-xs"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal admin note..."
            />
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground">
        <div>
          <Label className="text-[11px]">Created</Label>
          <p>{new Date(user.created_at).toLocaleString()}</p>
        </div>
        <div>
          <Label className="text-[11px]">Last Updated</Label>
          <p>{new Date(user.updated_at).toLocaleString()}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-auto flex gap-2 border-t pt-4">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Save Changes
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="destructive" disabled={removing} />
            }
          >
            {removing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            Remove
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove User</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove {user.discord_name} from the{" "}
                {user.whitelist_name} whitelist.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={handleRemove}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
