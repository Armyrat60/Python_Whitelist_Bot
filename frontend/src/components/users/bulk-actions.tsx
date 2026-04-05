"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Trash2,
  Loader2,
  X,
  Download,
  ArrowRightLeft,
  Crown,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import type { WhitelistUser } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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

/* ------------------------------------------------------------------ */
/*  Bulk CSV export                                                    */
/* ------------------------------------------------------------------ */

function exportUsersAsCsv(users: WhitelistUser[]) {
  const header = [
    "discord_id",
    "discord_name",
    "whitelist_slug",
    "whitelist_name",
    "status",
    "tier",
    "steam_ids",
    "eos_ids",
    "slots_used",
    "slot_limit",
  ].join(",");

  const rows = users.map((u) => {
    const steamIds = (u.steam_ids ?? []).join(";");
    const eosIds = (u.eos_ids ?? []).join(";");
    const allIds = [...(u.steam_ids ?? []), ...(u.eos_ids ?? [])];
    return [
      u.discord_id,
      `"${(u.discord_name ?? "").replace(/"/g, '""')}"`,
      u.whitelist_slug,
      `"${(u.whitelist_name ?? "").replace(/"/g, '""')}"`,
      u.status,
      u.last_plan_name ?? "",
      steamIds,
      eosIds,
      allIds.length,
      u.effective_slot_limit,
    ].join(",");
  });

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whitelist-users-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/*  Bulk Action Bar                                                    */
/* ------------------------------------------------------------------ */

export function BulkActionBar({
  selectedCount,
  selectedUsers,
  whitelists,
  onClear,
  onDeleteDone,
}: {
  selectedCount: number;
  selectedUsers: WhitelistUser[];
  whitelists: { slug: string; name: string }[];
  onClear: () => void;
  onDeleteDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkStatusChanging, setBulkStatusChanging] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTierChanging, setBulkTierChanging] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [showTierDialog, setShowTierDialog] = useState(false);
  const [moveTargetSlug, setMoveTargetSlug] = useState("");
  const [tierTarget, setTierTarget] = useState<{ value: string; slots: number } | null>(null);

  const allTierEntries: { label: string; value: string; slots: number; categoryName: string }[] = [];

  async function handleBulkDelete() {
    setBulkDeleting(true);
    try {
      // Group by whitelist_slug for the API
      const byWhitelist: Record<string, string[]> = {};
      for (const u of selectedUsers) {
        if (!byWhitelist[u.whitelist_slug]) byWhitelist[u.whitelist_slug] = [];
        byWhitelist[u.whitelist_slug].push(u.discord_id);
      }

      const promises = Object.entries(byWhitelist).map(([slug, ids]) =>
        api.post("/api/admin/users/bulk-delete", {
          discord_ids: ids,
          whitelist_slug: slug,
        })
      );
      await Promise.all(promises);

      toast.success(`Removed ${selectedCount} user(s)`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      onDeleteDone();
    } catch {
      toast.error("Failed to bulk delete users");
    } finally {
      setBulkDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleBulkStatusChange(newStatus: string) {
    setBulkStatusChanging(true);
    try {
      const promises = selectedUsers.map((u) =>
        api.patch(`/api/admin/users/${u.discord_id}/${u.whitelist_slug}`, {
          status: newStatus,
          steam_ids: u.steam_ids,
          eos_ids: u.eos_ids,
        })
      );
      await Promise.all(promises);

      toast.success(`Updated ${selectedCount} user(s) to ${newStatus}`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onClear();
    } catch {
      toast.error("Failed to change status");
    } finally {
      setBulkStatusChanging(false);
      setShowStatusMenu(false);
    }
  }

  async function handleBulkMove() {
    if (!moveTargetSlug) return;
    setBulkMoving(true);
    try {
      // Group selected users by their source whitelist
      const bySource: Record<string, string[]> = {};
      for (const u of selectedUsers) {
        if (u.whitelist_slug === moveTargetSlug) continue; // already there
        if (!bySource[u.whitelist_slug]) bySource[u.whitelist_slug] = [];
        bySource[u.whitelist_slug].push(u.discord_id);
      }

      const promises = Object.entries(bySource).map(([fromSlug, ids]) =>
        api.post("/api/admin/users/bulk-move", {
          discord_ids: ids,
          from_whitelist_slug: fromSlug,
          to_whitelist_slug: moveTargetSlug,
        })
      );
      await Promise.all(promises);

      toast.success(`Moved ${selectedCount} user(s) to ${moveTargetSlug}`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      setShowMoveDialog(false);
      setMoveTargetSlug("");
      onClear();
    } catch {
      toast.error("Failed to move users");
    } finally {
      setBulkMoving(false);
    }
  }

  async function handleBulkTierChange() {
    if (!tierTarget) return;
    setBulkTierChanging(true);
    try {
      const promises = selectedUsers.map((u) =>
        api.patch(`/api/admin/users/${u.discord_id}/${u.whitelist_slug}`, {
          plan: tierTarget.value,
          plan_slot_limit: tierTarget.slots,
          steam_ids: u.steam_ids,
          eos_ids: u.eos_ids,
        })
      );
      await Promise.all(promises);
      toast.success(`Set ${selectedCount} user(s) to tier "${tierTarget.value}"`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setShowTierDialog(false);
      setTierTarget(null);
      onClear();
    } catch {
      toast.error("Failed to change tiers");
    } finally {
      setBulkTierChanging(false);
    }
  }

  if (selectedCount === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-2 rounded-2xl border px-5 py-3 shadow-2xl backdrop-blur-md"
      style={{
        background: "color-mix(in srgb, oklch(0.185 0 0) 92%, transparent)",
        borderColor: "rgba(255,255,255,0.10)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.06) inset",
      }}
    >
      <span
        className="mr-1 rounded-lg px-2.5 py-1 text-sm font-semibold"
        style={{
          background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)",
          color: "var(--accent-primary)",
        }}
      >
        {selectedCount} selected
      </span>
      <div className="mx-1 h-4 w-px bg-white/10" />

      {/* Delete Selected */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogTrigger
          render={
            <Button
              variant="destructive"
              size="sm"
              disabled={bulkDeleting}
            />
          }
        >
          {bulkDeleting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          )}
          Delete Selected
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedCount} User(s)</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove {selectedCount} user(s) from their
              respective whitelists. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleBulkDelete}
            >
              {bulkDeleting && (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              )}
              Delete {selectedCount} User(s)
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Change Status */}
      <div className="relative">
        <Button
          variant="outline"
          size="sm"
          disabled={bulkStatusChanging}
          onClick={() => setShowStatusMenu(!showStatusMenu)}
        >
          {bulkStatusChanging && (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          )}
          Change Status
          <ChevronDown className="ml-1.5 h-3 w-3" />
        </Button>
        {showStatusMenu && (
          <div className="absolute bottom-full left-0 mb-1 w-36 rounded-md border border-border bg-popover p-1 shadow-md">
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => handleBulkStatusChange("active")}
            >
              Active
            </button>
            <button
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              onClick={() => handleBulkStatusChange("inactive")}
            >
              Inactive
            </button>
          </div>
        )}
      </div>

      {/* Change Tier */}
      <Dialog open={showTierDialog} onOpenChange={(o) => { setShowTierDialog(o); if (!o) setTierTarget(null); }}>
        <DialogTrigger
          render={<Button variant="outline" size="sm" disabled={bulkTierChanging} />}
        >
          {bulkTierChanging ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Crown className="mr-1.5 h-3.5 w-3.5" />
          )}
          Change Tier
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Tier for {selectedCount} User(s)</DialogTitle>
            <DialogDescription>
              Select a tier to assign. The slot limit will automatically update to match the tier.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Select
              value={tierTarget?.value ?? ""}
              onValueChange={(v) => {
                const entry = allTierEntries.find((e) => e.value === v);
                setTierTarget(entry ? { value: entry.value, slots: entry.slots } : null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a tier..." />
              </SelectTrigger>
              <SelectContent>
                {allTierEntries.length === 0 ? (
                  <SelectItem value="__none__" disabled>No tier entries configured</SelectItem>
                ) : (
                  allTierEntries.map((e) => (
                    <SelectItem key={`${e.categoryName}-${e.value}`} value={e.value}>
                      <span className="flex items-center gap-2">
                        {e.label}
                        <span className="text-[10px] text-muted-foreground">
                          ({e.slots} slot{e.slots !== 1 ? "s" : ""}) · {e.categoryName}
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {tierTarget && (
              <p className="text-[12px] text-muted-foreground">
                All {selectedCount} selected user(s) will be assigned tier{" "}
                <span className="font-semibold text-foreground">"{tierTarget.value}"</span>{" "}
                with <span className="font-semibold text-foreground">{tierTarget.slots} slot{tierTarget.slots !== 1 ? "s" : ""}</span>.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTierDialog(false)}>Cancel</Button>
            <Button disabled={!tierTarget || bulkTierChanging} onClick={handleBulkTierChange}>
              {bulkTierChanging && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Apply to {selectedCount} User{selectedCount !== 1 ? "s" : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move to Whitelist */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogTrigger
          render={
            <Button variant="outline" size="sm" disabled={bulkMoving} />
          }
        >
          {bulkMoving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
          )}
          Move to Whitelist
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedCount} User(s) to Whitelist</DialogTitle>
            <DialogDescription>
              Select the destination whitelist. Users will be moved with their
              identifiers intact. Users already in the target whitelist will be
              skipped.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label className="mb-1.5 block text-sm">Destination Whitelist</Label>
            <Select value={moveTargetSlug} onValueChange={(v) => setMoveTargetSlug(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Select a whitelist..." />
              </SelectTrigger>
              <SelectContent>
                {whitelists.map((wl) => (
                  <SelectItem key={wl.slug} value={wl.slug}>
                    {wl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMoveDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={!moveTargetSlug || bulkMoving}
              onClick={handleBulkMove}
            >
              {bulkMoving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Move Users
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Export */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => exportUsersAsCsv(selectedUsers)}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Export
      </Button>

      {/* Clear */}
      <Button variant="ghost" size="sm" onClick={onClear}>
        <X className="mr-1.5 h-3.5 w-3.5" />
        Clear
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Rematch Orphans Button                                             */
/* ------------------------------------------------------------------ */

export function RematchOrphansButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);

  async function handleRematch() {
    setRunning(true);
    try {
      const res = await api.post<{ matched: number; skipped: number; errors: number }>(
        "/api/admin/reconcile/rematch-orphans",
        {}
      );
      if (res.matched > 0) {
        toast.success(`Linked ${res.matched} entr${res.matched === 1 ? "y" : "ies"} — ${res.skipped} couldn't be matched`);
        onDone();
      } else {
        toast.info(`No new matches found (${res.skipped} checked)`);
      }
    } catch {
      toast.error("Rematch failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRematch} disabled={running} title="Re-run name matching against all unlinked entries">
      {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
      Re-match All
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/*  Purge Orphans Button                                               */
/* ------------------------------------------------------------------ */

export function PurgeOrphansButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState(false);

  async function handlePurge() {
    setRunning(true);
    setOpen(false);
    try {
      const res = await api.post<{ ok: boolean; purged: number }>(
        "/api/admin/reconcile/purge-orphans",
        {}
      );
      toast.success(`Purged ${res.purged} unmatched entr${res.purged === 1 ? "y" : "ies"}`);
      onDone();
    } catch {
      toast.error("Purge failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button variant="outline" size="sm" disabled={running} title="Permanently delete all unmatched orphan entries" />
        }
      >
        {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
        Purge All
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Purge All Unlinked Entries?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes all orphan entries (imported users that could not be matched to a Discord account).
            This cannot be undone. Run &ldquo;Re-match All&rdquo; first to save any that can be matched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handlePurge} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Purge Orphans
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Sync Tiers Button — backfill last_plan_name from Discord roles     */
/* ------------------------------------------------------------------ */

export function SyncTiersButton({ onDone }: { onDone: () => void }) {
  const [running, setRunning] = useState(false);

  async function handleSync() {
    setRunning(true);
    try {
      const res = await api.post<{ ok: boolean; updated: number; disabled: number; total_active: number }>(
        "/api/admin/backfill/tiers",
        {}
      );
      const parts = [`${res.updated} updated`];
      if (res.disabled) parts.push(`${res.disabled} disabled (no role)`);
      toast.success(`Sync complete — ${parts.join(", ")} of ${res.total_active} active users`);
      onDone();
    } catch {
      toast.error("Tier sync failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleSync}
      disabled={running}
      title="Re-sync tier assignments from current Discord roles for all active users"
    >
      {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Crown className="mr-1.5 h-3.5 w-3.5" />}
      Sync Tiers
    </Button>
  );
}
