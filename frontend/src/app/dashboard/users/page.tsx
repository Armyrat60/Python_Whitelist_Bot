"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Pencil,
  Trash2,
  Loader2,
  AlertTriangle,
  X,
  Save,
  Users,
  List,
  LayoutGrid,
  Download,
  ArrowRightLeft,
  Crown,
  RefreshCw,
  ExternalLink,
  BadgeCheck,
  RotateCcw,
  Clock,
  UserRound,
  UserMinus,
  Filter,
  SlidersHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import Link from "next/link";
import { useInfiniteUsers, useWhitelists, useSteamNames, useCategories, useRoleStats, useStats } from "@/hooks/use-settings";
import { useIsAdmin } from "@/hooks/use-session";
import type { WhitelistUser } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type ViewMode = "list" | "cards";

/* ------------------------------------------------------------------ */
/*  Tactical UI Components                                             */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  active: {
    label: "active",
    dot: "#22C55E", text: "#4ADE80",
    bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.28)",
  },
  inactive: {
    label: "inactive",
    dot: "#64748B", text: "#94A3B8",
    bg: "rgba(100,116,139,0.10)", border: "rgba(100,116,139,0.22)",
  },
  expired: {
    label: "expired",
    dot: "#EF4444", text: "#F87171",
    bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.28)",
  },
  disabled_role_lost: {
    label: "Role Lost",
    dot: "#F59E0B", text: "#FCD34D",
    bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.28)",
  },
};

/** Status badge — green/gray/red/amber dot with glow */
function StatusBadge({ status }: { status: string }) {
  const c = STATUS_META[status] ?? STATUS_META.inactive;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: c.dot,
          boxShadow: status === "active" ? `0 0 5px ${c.dot}` : "none",
        }}
      />
      {c.label}
    </span>
  );
}

/** Parse a plan string like "Solo:1 + Duo:2" into individual tier parts */
function parsePlanTiers(plan: string | null | undefined): { name: string; slots: number }[] {
  if (!plan) return [];
  // Ignore system strings like "error:no_member", "default:1"
  if (plan.startsWith("error:")) return [];
  return plan.split("+").map((part) => {
    const colonIdx = part.lastIndexOf(":");
    if (colonIdx !== -1) {
      const name = part.slice(0, colonIdx).trim();
      const slots = parseInt(part.slice(colonIdx + 1), 10);
      // Skip "default" tier — it's a fallback, not a real role
      if (name === "default") return null;
      return { name, slots: isNaN(slots) ? 1 : slots };
    }
    return { name: part.trim(), slots: 1 };
  }).filter(Boolean) as { name: string; slots: number }[];
}

function getTierColors(name: string): { bg: string; border: string; color: string } {
  const lower = name.toLowerCase();
  if (lower.includes("spectre") || lower.includes("command") || lower.includes("elite"))
    return { bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.30)", color: "#C084FC" };
  if (lower.includes("ghost") || lower.includes("squad") || lower.includes("recon"))
    return { bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.28)", color: "#7DD3FC" };
  if (lower.includes("duo") || lower.includes("fire"))
    return { bg: "rgba(20,184,166,0.12)", border: "rgba(20,184,166,0.28)", color: "#5EEAD4" };
  if (lower.includes("vip") || lower.includes("gold"))
    return { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.28)", color: "#FCD34D" };
  return { bg: "rgba(148,163,184,0.09)", border: "rgba(148,163,184,0.20)", color: "#94A3B8" };
}

/** Tier chip — single pill for one role, first pill + "+N" tooltip for stacked roles */
function TierChip({ tier }: { tier: string | null | undefined }) {
  const tiers = parsePlanTiers(tier);

  if (tiers.length === 0) {
    // Show raw value if it's an override (admin set), otherwise dash
    if (tier && tier.startsWith("override")) {
      return (
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{ background: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.28)", color: "#A5B4FC" }}
          title={tier}
        >
          Override
        </span>
      );
    }
    return <span className="text-[11px] text-muted-foreground/60">—</span>;
  }

  const first = tiers[0];
  const rest = tiers.slice(1);
  const { bg, border, color } = getTierColors(first.name);

  if (rest.length === 0) {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-[7rem] truncate"
        style={{ background: bg, borderColor: border, color }}
        title={`${first.name} — ${first.slots} slot${first.slots !== 1 ? "s" : ""}`}
      >
        {first.name}
      </span>
    );
  }

  // Multiple stacked roles — first pill + "+N" with tooltip listing all
  const tooltipText = tiers
    .map((t) => `${t.name}: ${t.slots} slot${t.slots !== 1 ? "s" : ""}`)
    .join("\n");

  return (
    <span
      className="inline-flex items-center gap-1 cursor-default"
      title={tooltipText}
    >
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-[5rem] truncate"
        style={{ background: bg, borderColor: border, color }}
      >
        {first.name}
      </span>
      <span
        className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold"
        style={{ background: "rgba(148,163,184,0.09)", borderColor: "rgba(148,163,184,0.22)", color: "#94A3B8" }}
      >
        +{rest.length}
      </span>
    </span>
  );
}

/** Whitelist badge — simple muted pill showing which whitelist */
function WhitelistBadge({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-[11px] text-muted-foreground/60">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-[8rem] truncate"
      style={{
        background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--accent-primary) 25%, transparent)",
        color: "var(--accent-primary)",
      }}
      title={name}
    >
      {name}
    </span>
  );
}

/** Registration source chip — how the user was first added */
function RegSourceChip({ source }: { source?: string | null }) {
  const cfgs: Record<string, { label: string; bg: string; border: string; color: string }> = {
    self_register: { label: "Self Reg",  bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.30)",  color: "#4ADE80" },
    role_sync:     { label: "Role Sync", bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.30)", color: "#C084FC" },
    import:        { label: "Import",    bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.28)", color: "#94A3B8" },
    web_dashboard: { label: "Dashboard", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.28)", color: "#7DD3FC" },
    admin:         { label: "Admin",     bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.22)", color: "#7DD3FC" },
    admin_web:     { label: "Admin",     bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.22)", color: "#7DD3FC" },
    orphan:        { label: "Unmatched", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.30)", color: "#FB923C" },
  };
  const c = source ? cfgs[source] : null;
  if (!c) return <span className="text-[10px] text-muted-foreground/60">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ background: c.bg, borderColor: c.border, color: c.color }}
    >
      {c.label}
    </span>
  );
}

/** Temp whitelist chip — shown when user has an expiry date */
function TempChip({ expiresAt, createdAt }: { expiresAt?: string | null; createdAt?: string }) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  const now = new Date();
  const isExpired = exp < now;
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  const label = isExpired
    ? `Temp · exp ${fmt(exp)}`
    : `Temp · ${createdAt ? fmt(new Date(createdAt)) + " → " : ""}${fmt(exp)}`;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        background: isExpired ? "rgba(239,68,68,0.10)" : "rgba(251,146,60,0.10)",
        borderColor: isExpired ? "rgba(239,68,68,0.30)" : "rgba(251,146,60,0.30)",
        color: isExpired ? "#F87171" : "#FB923C",
      }}
    >
      {label}
    </span>
  );
}

/** Slot visualization — dot + count + slim progress bar */
function SlotBar({ used, total }: { used: number; total: number }) {
  if (total === 0) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: "#F87171", boxShadow: "0 0 5px rgba(248,113,113,0.5)" }}
        />
        <span className="text-[11px] font-medium text-red-400">No Access</span>
      </div>
    );
  }

  const pct = Math.min((used / total) * 100, 100);
  const isOver = used > total;
  const barColor = isOver ? "#F87171" : "var(--accent-primary)";
  const glowColor = isOver ? "rgba(248,113,113,0.5)" : "color-mix(in srgb, var(--accent-primary) 50%, transparent)";

  return (
    <div className="flex items-center gap-2">
      {/* Colored identity dot */}
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: barColor, boxShadow: `0 0 5px ${glowColor}` }}
      />
      <span className={cn("min-w-[26px] text-[11px] tabular-nums font-medium", isOver ? "text-red-400" : "text-white/60")}>
        {used}/{total}
      </span>
      {/* Progress track */}
      <div className="relative h-[3px] w-20 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: barColor,
            boxShadow: `0 0 6px ${glowColor}`,
          }}
        />
      </div>
    </div>
  );
}

/** Unique key for a user row (composite: discord_id + whitelist_slug) */
function userKey(user: WhitelistUser) {
  return `${user.discord_id}::${user.whitelist_slug}`;
}

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

function BulkActionBar({
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
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function UsersPage() {
  const [activeTab, setActiveTab] = useState<"members" | "removed">("members");
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({ status: "active" });
  const [sort, setSort] = useState("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
  const [selectedUser, setSelectedUser] = useState<WhitelistUser | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const perPage = 30;
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteUsers(perPage, search, filters, sort, sortOrder);
  const { data: whitelists } = useWhitelists();
  const { data: roleStatsData } = useRoleStats();
  const { data: statsData } = useStats();
  const selectedWl = whitelists?.find(wl => wl.slug === filters.whitelist);
  const { data: categories } = useCategories(selectedWl?.id ?? null);
  const allTierOptions: { label: string; value: string }[] = [];

  // Deduplicated role names from panel roles for the role filter
  const roleOptions = useMemo(() => {
    const seen = new Set<string>();
    const opts: { label: string; value: string }[] = [];
    for (const r of roleStatsData?.stats ?? []) {
      if (!seen.has(r.role_name)) {
        seen.add(r.role_name);
        opts.push({ label: r.role_name, value: r.role_name });
      }
    }
    return opts;
  }, [roleStatsData]);
  const [showGapReport, setShowGapReport] = useState(false);
  const [gapData, setGapData] = useState<{members: {discord_id: string; display_name: string; whitelisted_roles: string[]}[]; total: number} | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  async function loadGapReport() {
    setGapLoading(true);
    setShowGapReport(true);
    try {
      const data = await api.get<{members: {discord_id: string; display_name: string; whitelisted_roles: string[]}[]; total: number}>("/api/admin/members/gap");
      setGapData(data);
    } catch {
      toast.error("Failed to load gap report");
      setShowGapReport(false);
    } finally {
      setGapLoading(false);
    }
  }

  const users = useMemo(() => data?.pages.flatMap(p => p.users) ?? [], [data]);
  const total = data?.pages[0]?.total ?? 0;
  const steamNames = useSteamNames(users);

  // Debounced dynamic search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) setSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  function handleSearch() {
    setSearch(searchInput);
  }

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleSort = useCallback((col: string) => {
    if (sort === col) {
      setSortOrder(o => o === "asc" ? "desc" : "asc");
    } else {
      setSort(col);
      setSortOrder("asc");
    }
  }, [sort]);

  // Selection helpers
  const allVisibleKeys = useMemo(
    () => users.map((u) => userKey(u)),
    [users]
  );

  const allSelected =
    users.length > 0 && allVisibleKeys.every((k) => selectedIds.has(k));

  const someSelected = allVisibleKeys.some((k) => selectedIds.has(k));

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all visible
        for (const k of allVisibleKeys) next.delete(k);
      } else {
        // Select all visible
        for (const k of allVisibleKeys) next.add(k);
      }
      return next;
    });
  }

  function toggleSelect(key: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedUsers = useMemo(
    () => users.filter((u) => selectedIds.has(userKey(u))),
    [users, selectedIds]
  );

  function clearSelection() {
    setSelectedIds(new Set());
  }

  return (
    <div className="space-y-6">
      {/* ---- Stats Banner ---- */}
      {statsData && (() => {
        const slotsGranted = Object.values(statsData.per_type).reduce((sum, wl) => sum + wl.slots_used, 0);
        const stats = [
          { label: "Active Members", value: statsData.total_active_users, sub: `of ${statsData.total_registered} registered`, color: "text-emerald-400" },
          { label: "Slots Granted", value: slotsGranted, sub: "total across all roles", color: "text-white/80" },
          { label: "IDs Submitted", value: statsData.total_identifiers, sub: `${slotsGranted > 0 ? Math.round((statsData.total_identifiers / slotsGranted) * 100) : 0}% fill rate · all users`, color: "var(--accent-primary)" },
        ];
        return (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {stats.map(({ label, value, sub, color }) => (
              <div key={label} className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-3">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
                <span className="text-2xl font-semibold tabular-nums" style={{ color }}>{value}</span>
                <span className="text-[11px] text-muted-foreground/50">{sub}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ---- Tabs (roles inline + Removed at end) ---- */}
      <div className="flex flex-wrap items-center gap-1">
        <button
          onClick={() => { setActiveTab("members"); setFilters(f => ({ ...f, role_name: "" })); }}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "members" && !filters.role_name
              ? "bg-white/[0.08] text-white"
              : "text-white/60 hover:text-white/80 hover:bg-white/[0.04]"
          )}
        >
          <Users className="h-3.5 w-3.5" />
          All
        </button>
        {roleOptions.map(r => (
          <button
            key={r.value}
            onClick={() => { setActiveTab("members"); setFilters(f => ({ ...f, role_name: r.value })); }}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              activeTab === "members" && filters.role_name === r.value
                ? "bg-white/[0.08] text-white"
                : "text-white/60 hover:text-white/80 hover:bg-white/[0.04]"
            )}
          >{r.label}</button>
        ))}
        <div className="mx-1 h-4 w-px shrink-0 bg-white/[0.10]" />
        <button
          onClick={() => setActiveTab("removed")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeTab === "removed"
              ? "bg-white/[0.08] text-white"
              : "text-white/60 hover:text-white/80 hover:bg-white/[0.04]"
          )}
        >
          <UserMinus className="h-3.5 w-3.5" />
          Removed
        </button>
      </div>

      {activeTab === "removed" && <RoleHistoryTab whitelists={whitelists ?? []} />}
      {activeTab !== "removed" && <>

      {/* ---- Toolbar ---- */}
      {(() => {
        // Count active non-default filters (role_name handled by tabs, excluded here)
        const activeFilterKeys = ["whitelist", "status", "category_id", "verified"] as const;
        const defaultFilters: Record<string, string> = { status: "active" };
        const activeCount = activeFilterKeys.filter(k => {
          const v = filters[k] ?? "";
          return v !== "" && v !== (defaultFilters[k] ?? "");
        }).length;

        // Chip labels for active filters
        const chips: { key: string; label: string }[] = [];
        if (filters.whitelist) chips.push({ key: "whitelist", label: `Whitelist: ${whitelists?.find(w => w.slug === filters.whitelist)?.name ?? filters.whitelist}` });
        if (filters.status && filters.status !== "active") chips.push({ key: "status", label: `Status: ${filters.status}` });
        if (filters.category_id) chips.push({ key: "category_id", label: `Category: ${categories?.find(c => String(c.id) === filters.category_id)?.name ?? filters.category_id}` });
        if (filters.verified === "true") chips.push({ key: "verified", label: "Verified only" });

        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Search */}
              <div className="flex flex-1 min-w-[200px] gap-2">
                <Input
                  placeholder="Search name, Discord ID, Steam ID…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="max-w-sm"
                  maxLength={100}
                />
                <Button variant="outline" size="icon" onClick={handleSearch}>
                  <Search className="h-4 w-4" />
                </Button>
              </div>

              {/* Filters button */}
              <Button
                variant={showFilters || activeCount > 0 ? "secondary" : "outline"}
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setShowFilters(v => !v)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Filters
                {activeCount > 0 && (
                  <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-semibold">
                    {activeCount}
                  </span>
                )}
              </Button>

              {/* View toggle */}
              <div className="flex rounded-md border border-border">
                <Button variant={viewMode === "list" ? "secondary" : "ghost"} size="icon" className="h-9 w-9 rounded-r-none" onClick={() => setViewMode("list")}>
                  <List className="h-4 w-4" />
                </Button>
                <Button variant={viewMode === "cards" ? "secondary" : "ghost"} size="icon" className="h-9 w-9 rounded-l-none" onClick={() => setViewMode("cards")}>
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* Export */}
                <a href={`/api/admin/users/export?${new URLSearchParams(
                  Object.fromEntries(Object.entries({ ...filters, ...(search ? { search } : {}) }).filter(([, v]) => Boolean(v)))
                ).toString()}`} download="roster-export.csv">
                  <Button variant="outline" size="sm">
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Export
                  </Button>
                </a>

                {/* Gap Report */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadGapReport}
                  disabled={gapLoading}
                  title="Discord members with a whitelist role who haven't submitted any IDs yet"
                >
                  {gapLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Users className="mr-1.5 h-3.5 w-3.5" />}
                  Gap Report
                </Button>

                <SyncTiersButton onDone={() => queryClient.invalidateQueries({ queryKey: ["users"] })} />
              </div>
            </div>

            {/* Filter panel */}
            {showFilters && (
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {/* Status */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Status</label>
                    <Select
                      value={filters.status ?? "active"}
                      onValueChange={(v) => { setFilters(p => ({ ...p, status: v === "__all__" ? "" : (v ?? "") })); }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Active" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All statuses</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="expired">Expired</SelectItem>
                        <SelectItem value="disabled_role_lost">Role Lost</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Whitelist */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Whitelist</label>
                    <Select
                      value={filters.whitelist ?? ""}
                      onValueChange={(v) => { setFilters(p => ({ ...p, whitelist: v === "__all__" ? "" : (v ?? ""), category_id: "" })); }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="All whitelists" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All whitelists</SelectItem>
                        {whitelists?.map((wl) => (
                          <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Category (manual whitelist only) */}
                  {selectedWl?.is_manual && categories && categories.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Category</label>
                      <Select
                        value={filters.category_id ?? ""}
                        onValueChange={(v) => { setFilters(p => ({ ...p, category_id: v === "__all__" ? "" : (v ?? "") })); }}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="All categories" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All categories</SelectItem>
                          {categories.map(cat => (
                            <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Verified */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Verified</label>
                    <Button
                      variant={filters.verified === "true" ? "secondary" : "outline"}
                      size="sm"
                      className="h-8 w-full justify-start gap-1.5 text-xs"
                      onClick={() => { setFilters(p => ({ ...p, verified: p.verified === "true" ? "" : "true" })); }}
                    >
                      <BadgeCheck className={`h-3.5 w-3.5 ${filters.verified === "true" ? "text-emerald-400" : ""}`} />
                      {filters.verified === "true" ? "Verified only" : "All members"}
                    </Button>
                  </div>
                </div>

                {/* Reset link */}
                {activeCount > 0 && (
                  <button
                    className="text-[11px] text-muted-foreground/60 hover:text-white/60 transition-colors"
                    onClick={() => { setFilters({ status: "active" }); }}
                  >
                    Reset to defaults
                  </button>
                )}
              </div>
            )}

            {/* Active filter chips */}
            {chips.length > 0 && !showFilters && (
              <div className="flex flex-wrap gap-1.5">
                {chips.map(({ key, label }) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1 rounded-full border border-white/[0.10] bg-white/[0.04] px-2.5 py-0.5 text-[11px] text-white/70"
                  >
                    {label}
                    <button
                      onClick={() => {
                        setFilters(p => {
                          const next = { ...p };
                          if (key === "status") next.status = "active";
                          else delete next[key];
                          return next;
                        });
                        
                      }}
                      className="ml-0.5 text-muted-foreground/50 hover:text-white/80"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button
                  className="text-[11px] text-muted-foreground/50 hover:text-white/60 transition-colors"
                  onClick={() => { setFilters({ status: "active" }); }}
                >
                  Clear all
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ---- Member Gap Report ---- */}
      {showGapReport && gapData && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Unregistered Members</h3>
              <p className="text-xs text-muted-foreground">
                {gapData.total} member(s) have a whitelist role but haven't submitted IDs yet
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowGapReport(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {gapData.members.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--accent-primary)" }}>All role holders have registered!</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {gapData.members.map((m) => (
                <div key={m.discord_id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-yellow-500/10">
                  <div>
                    <span className="font-medium">{m.display_name}</span>
                    <span className="ml-2 font-mono text-muted-foreground">{m.discord_id}</span>
                  </div>
                  <div className="flex gap-1">
                    {m.whitelisted_roles.map((r) => (
                      <Badge key={r} variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-400">{r}</Badge>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Content ---- */}
      {isLoading ? (
        viewMode === "cards" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        )
      ) : isError ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 text-destructive">
          <AlertTriangle className="h-6 w-6" />
          <p className="text-sm">Failed to load users. Check your connection and try refreshing.</p>
        </div>
      ) : users.length === 0 ? (
        <div className="flex h-48 items-center justify-center text-muted-foreground">
          No users found.
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {users.map((user) => (
            <UserCard
              key={`${user.discord_id}-${user.whitelist_slug}`}
              user={user}
              onSelect={() => setSelectedUser(user)}
              whitelists={whitelists ?? []}
              steamNames={steamNames}
              selected={selectedIds.has(userKey(user))}
              onToggleSelect={() => toggleSelect(userKey(user))}
            />
          ))}
        </div>
      ) : (
        <UserListView
          users={users}
          whitelists={whitelists ?? []}
          steamNames={steamNames}
          onSelect={setSelectedUser}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          allSelected={allSelected}
          someSelected={someSelected}
          onToggleSelectAll={toggleSelectAll}
          sort={sort}
          sortOrder={sortOrder}
          onSort={handleSort}
        />
      )}

      {/* ---- Infinite scroll sentinel ---- */}
      <div ref={sentinelRef} className="flex items-center justify-center py-4">
        {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {!hasNextPage && users.length > 0 && (
          <p className="text-xs text-muted-foreground/50">{total} total · {users.length} loaded</p>
        )}
      </div>

      {/* ---- User Detail Sheet ---- */}
      <Sheet
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {selectedUser?.clan_tag && (
                <span className="rounded px-1.5 py-0.5 text-xs font-bold tracking-wide text-white/60 bg-white/[0.05] border border-white/[0.08]">
                  {selectedUser.clan_tag}
                </span>
              )}
              {selectedUser
                ? (selectedUser.clan_tag
                    ? (selectedUser.discord_name.replace(/^\[[^\]]+\]\s*/, '').trim() || selectedUser.discord_name)
                    : selectedUser.discord_name)
                : "User"}
            </SheetTitle>
            <SheetDescription>
              {selectedUser && parseInt(selectedUser.discord_id) < 0
                ? "No Discord account linked"
                : selectedUser?.discord_username
                  ? <span><span className="text-white/50">@{selectedUser.discord_username}</span> · {selectedUser.discord_id}</span>
                  : selectedUser?.discord_id}
            </SheetDescription>
          </SheetHeader>
          {selectedUser && (
            <UserDetailSheet
              user={selectedUser}
              onClose={() => setSelectedUser(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* ---- Bulk Action Bar ---- */}
      <BulkActionBar
        selectedCount={selectedIds.size}
        selectedUsers={selectedUsers}
        whitelists={whitelists ?? []}
        onClear={clearSelection}
        onDeleteDone={clearSelection}
      />
      </>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Role History Tab                                                   */
/* ------------------------------------------------------------------ */

interface RoleLossEntry {
  discord_id: string;
  discord_name: string;
  whitelist_slug: string;
  whitelist_name: string;
  lost_at: string;
  added_at: string;
  last_plan_name: string | null;
  effective_slot_limit: number;
}

function formatRelativeRl(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function heldForRl(addedAt: string, lostAt: string): string {
  const days = Math.floor((new Date(lostAt).getTime() - new Date(addedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) return "< 1 day";
  if (days === 1) return "1 day";
  if (days < 30) return `${days} days`;
  return `${Math.floor(days / 30)} mo`;
}

function RoleHistoryTab({ whitelists }: { whitelists: { slug: string; name: string; is_manual?: boolean }[] }) {
  const [days, setDays] = useState(90);
  const [whitelistSlug, setWhitelistSlug] = useState("");
  const queryClient = useQueryClient();

  const roleWhitelists = whitelists.filter(wl => !wl.is_manual);

  const { data, isFetching } = useQuery({
    queryKey: ["role-loss", days, whitelistSlug || null],
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) });
      if (whitelistSlug) params.set("whitelist_slug", whitelistSlug);
      return api.get<{ users: RoleLossEntry[] }>(`/api/admin/role-loss?${params}`);
    },
  });

  const entries = data?.users ?? [];

  async function handleRestore(entry: RoleLossEntry) {
    try {
      await api.patch(`/api/admin/users/${entry.discord_id}/${entry.whitelist_slug}`, { status: "active" });
      toast.success(`Restored ${entry.discord_name}`);
      queryClient.invalidateQueries({ queryKey: ["role-loss"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch {
      toast.error("Failed to restore user");
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-border text-xs">
          {[30, 60, 90].map((d) => (
            <Button
              key={d}
              variant={days === d ? "secondary" : "ghost"}
              size="sm"
              className="rounded-none px-3 h-8 first:rounded-l-md last:rounded-r-md"
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
        <Select value={whitelistSlug || "__all"} onValueChange={(v) => setWhitelistSlug(!v || v === "__all" ? "" : v)}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue placeholder="All whitelists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All whitelists</SelectItem>
            {roleWhitelists.map((wl) => (
              <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {isFetching ? "Loading…" : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
        </span>
      </div>

      {/* List */}
      {isFetching && entries.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 w-full rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
          <UserRound className="mb-3 h-8 w-8 text-muted-foreground/60" />
          <p className="text-sm font-medium text-white/60">No role losses in the last {days} days</p>
          <p className="mt-1 text-xs text-muted-foreground">Members who lose their whitelist role will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={`${entry.discord_id}::${entry.whitelist_slug}`}
              className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <UserRound className="h-4 w-4 text-amber-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white/90">{entry.discord_name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{entry.discord_id}</span>
                  <WhitelistBadge name={entry.whitelist_name} />
                  {entry.last_plan_name && (
                    <TierChip tier={entry.last_plan_name} />
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <UserRound className="h-3 w-3 text-amber-400/70" />
                    Lost {formatRelativeRl(entry.lost_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Held for {heldForRl(entry.added_at, entry.lost_at)}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10"
                onClick={() => handleRestore(entry)}
              >
                <RotateCcw className="mr-1.5 h-3 w-3" />
                Restore
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  List View                                                          */
/* ------------------------------------------------------------------ */

function SortIcon({ col, sort, sortOrder }: { col: string; sort: string; sortOrder: "asc" | "desc" }) {
  if (sort !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  return sortOrder === "asc"
    ? <ArrowUp className="h-3 w-3" style={{ color: "var(--accent-primary)" }} />
    : <ArrowDown className="h-3 w-3" style={{ color: "var(--accent-primary)" }} />;
}

function UserListView({
  users,
  whitelists,
  steamNames,
  onSelect,
  selectedIds,
  onToggleSelect,
  allSelected,
  someSelected,
  onToggleSelectAll,
  sort,
  sortOrder,
  onSort,
}: {
  users: WhitelistUser[];
  whitelists: { slug: string; name: string }[];
  steamNames: Record<string, string>;
  onSelect: (user: WhitelistUser) => void;
  selectedIds: Set<string>;
  onToggleSelect: (key: string) => void;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelectAll: () => void;
  sort: string;
  sortOrder: "asc" | "desc";
  onSort: (col: string) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="glass-panel overflow-hidden rounded-xl">
      {/* Header */}
      <div className="hidden items-center gap-3 border-b border-white/[0.10] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 sm:flex">
        <span
          className="flex w-8 cursor-pointer items-center justify-center"
          onClick={(e) => { e.stopPropagation(); onToggleSelectAll(); }}
        >
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            onCheckedChange={() => onToggleSelectAll()}
          />
        </span>
        <button className="flex flex-1 items-center gap-1 hover:text-white/80 transition-colors" onClick={() => onSort("name")}>
          Discord Name <SortIcon col="name" sort={sort} sortOrder={sortOrder} />
        </button>
        <button className="flex w-36 items-center gap-1 hover:text-white/80 transition-colors" onClick={() => onSort("slots")}>
          Slots <SortIcon col="slots" sort={sort} sortOrder={sortOrder} />
        </button>
        <button className="flex w-32 items-center justify-center gap-1 hover:text-white/80 transition-colors" onClick={() => onSort("whitelist")}>
          Whitelist <SortIcon col="whitelist" sort={sort} sortOrder={sortOrder} />
        </button>
        <span className="w-28 text-center">Role</span>
        <button className="flex w-20 items-center justify-center gap-1 hover:text-white/80 transition-colors" onClick={() => onSort("status")}>
          Status <SortIcon col="status" sort={sort} sortOrder={sortOrder} />
        </button>
        <span className="w-6" />
      </div>

      {users.map((user) => {
        const key = userKey(user);
        const isExpanded = expandedKey === key;
        const allIds = [...(user.steam_ids ?? []), ...(user.eos_ids ?? [])];
        const usedSlots = allIds.length;
        const isSelected = selectedIds.has(key);

        return (
          <div key={key} className="border-b border-white/[0.04] last:border-0">
            {/* Row */}
            <div
              className={cn(
                "row-hover flex cursor-pointer items-center gap-3 px-4 py-3",
                isSelected && "row-selected"
              )}
              onClick={() => setExpandedKey(isExpanded ? null : key)}
            >
              <span
                className="flex w-8 items-center justify-center"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelect(key);
                }}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => onToggleSelect(key)}
                />
              </span>
              <span className="min-w-0 flex-1 flex items-center gap-1.5 truncate">
                {user.clan_tag && (
                  <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-bold tracking-wide text-white/60 bg-white/[0.05] border border-white/[0.08]">
                    {user.clan_tag}
                  </span>
                )}
                <span
                  className="truncate text-sm font-medium text-white/85"
                  title={user.discord_username && user.discord_username !== user.discord_name ? `@${user.discord_username}` : undefined}
                >
                  {user.clan_tag
                    ? (user.discord_name.replace(/^\[[^\]]+\]\s*/, '').trim() || user.discord_name)
                    : user.discord_name}
                </span>
                {user.is_verified && (
                  <span title="Bridge Verified"><BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" /></span>
                )}
                <Link
                  href={`/dashboard/players/${user.discord_id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 text-muted-foreground/60 hover:text-white/80 transition-colors"
                  title="View profile"
                >
                  <ExternalLink className="h-3 w-3" />
                </Link>
              </span>
              <span className="flex w-36 items-center">
                <SlotBar used={usedSlots} total={user.effective_slot_limit} />
              </span>
              <span className="hidden w-32 justify-center sm:flex">
                <WhitelistBadge name={user.whitelist_name} />
              </span>
              <span className="hidden w-28 justify-center sm:flex">
                <TierChip tier={user.last_plan_name} />
              </span>
              <span className="flex w-20 flex-col items-center gap-0.5">
                <StatusBadge status={user.status} />
                <TempChip expiresAt={user.expires_at} createdAt={user.created_at} />
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                  isExpanded && "rotate-180"
                )}
              />
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <ListRowDetail
                user={user}
                steamNames={steamNames}
                whitelists={whitelists}
                onEdit={() => onSelect(user)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  List Row Detail (expanded)                                         */
/* ------------------------------------------------------------------ */

function ListRowDetail({
  user,
  steamNames,
  whitelists,
  onEdit,
}: {
  user: WhitelistUser;
  steamNames: Record<string, string>;
  whitelists: { slug: string; name: string }[];
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);

  const slotLimit = user.effective_slot_limit;
  const allIds = [...(user.steam_ids ?? []), ...(user.eos_ids ?? [])];

  async function handleRemove() {
    setRemoving(true);
    try {
      await api.delete(
        `/api/admin/users/${user.discord_id}/${user.whitelist_slug}`
      );
      toast.success(`Removed ${user.discord_name}`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch {
      toast.error("Failed to remove user");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="border-t border-border/50 bg-muted/30 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* Slot details */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Slot Details
          </p>
          {Array.from({ length: slotLimit }).map((_, idx) => {
            const id = allIds[idx];
            const isSteam = idx < (user.steam_ids?.length ?? 0);
            const resolvedName =
              isSteam && id ? steamNames[id] : undefined;
            const isOwner = idx === 0;
            return (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs"
              >
                <span className="w-14 shrink-0 font-mono text-muted-foreground">
                  Slot {idx + 1}:
                </span>
                {id ? (
                  <>
                    <span className="min-w-0 truncate font-mono">
                      {id}
                      {resolvedName && (
                        <span className="ml-1 text-muted-foreground">
                          ({resolvedName})
                        </span>
                      )}
                    </span>
                    {isOwner && (
                      <Badge
                        variant="secondary"
                        className="ml-auto shrink-0 text-[10px]"
                      >
                        owner
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="italic text-muted-foreground/50">
                    — empty —
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Meta info */}
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Info</p>
          <p className="text-xs">
            <span className="text-muted-foreground">Discord ID: </span>
            <span className="font-mono">{user.discord_id}</span>
          </p>
          <p className="text-xs">
            <span className="text-muted-foreground">Whitelist: </span>
            {user.whitelist_name}
          </p>
          {user.last_plan_name && (
            <p className="text-xs flex items-center gap-1.5">
              <span className="text-muted-foreground">Role:</span>
              <TierChip tier={user.last_plan_name} />
            </p>
          )}
        </div>
      </div>

      {/* Role Lost explanation */}
      {user.status === "disabled_role_lost" && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <span>
            <span className="font-semibold">Role Lost</span> — this user no longer holds the Discord role that granted them whitelist access. They were automatically disabled by the bot. Their Steam IDs are excluded from the whitelist file. You can re-enable them via Edit, or remove the record entirely.
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          <Pencil className="mr-1.5 h-3 w-3" />
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="outline" size="sm" disabled={removing} />
            }
          >
            {removing ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3 w-3" />
            )}
            Remove
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove User</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove {user.discord_name} from the{" "}
                {user.whitelist_name} whitelist. This action cannot be undone.
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

/* ------------------------------------------------------------------ */
/*  User Card                                                          */
/* ------------------------------------------------------------------ */

function UserCard({
  user,
  onSelect,
  whitelists,
  steamNames,
  selected,
  onToggleSelect,
}: {
  user: WhitelistUser;
  onSelect: () => void;
  whitelists: { slug: string; name: string }[];
  steamNames: Record<string, string>;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState(false);

  const slotLimit = user.effective_slot_limit;
  const allIds = [...(user.steam_ids ?? []), ...(user.eos_ids ?? [])];
  const usedSlots = allIds.length;

  async function handleRemove() {
    setRemoving(true);
    try {
      await api.delete(
        `/api/admin/users/${user.discord_id}/${user.whitelist_slug}`
      );
      toast.success(`Removed ${user.discord_name}`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch {
      toast.error("Failed to remove user");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card className={cn("flex flex-col", selected && "ring-2 ring-primary/50")}>
      <CardHeader>
        <div className="flex items-start gap-3">
          <span
            className="flex items-center pt-1"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggleSelect()}
            />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
            <CardTitle
              className="cursor-pointer truncate hover:underline"
              onClick={onSelect}
            >
              {user.discord_name}
            </CardTitle>
            <Link
              href={`/dashboard/players/${user.discord_id}`}
              className="shrink-0 text-muted-foreground/60 hover:text-white/80 transition-colors"
              title="View profile"
            >
              <ExternalLink className="h-3 w-3" />
            </Link>
            </div>
            <CardDescription className="font-mono text-[11px]">
              {user.discord_id}
            </CardDescription>
          </div>
          <StatusBadge status={user.status} />
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {/* Whitelist + Tier + slot bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <WhitelistBadge name={user.whitelist_name} />
          <TierChip tier={user.last_plan_name} />
          <span className="ml-auto">
            <SlotBar used={usedSlots} total={slotLimit} />
          </span>
        </div>

        {/* Slot list */}
        <div className="space-y-1">
          {Array.from({ length: slotLimit }).map((_, idx) => {
            const id = allIds[idx];
            const isSteam = idx < (user.steam_ids?.length ?? 0);
            const resolvedName =
              isSteam && id ? steamNames[id] : undefined;
            const isOwner = idx === 0;
            return (
              <div
                key={idx}
                className="flex items-center gap-2 text-xs"
              >
                <span className="w-14 shrink-0 font-mono text-muted-foreground">
                  Slot {idx + 1}:
                </span>
                {id ? (
                  <>
                    <span className="min-w-0 truncate font-mono">
                      {id}
                      {resolvedName && (
                        <span className="ml-1 text-muted-foreground">
                          ({resolvedName})
                        </span>
                      )}
                    </span>
                    {isOwner && (
                      <Badge
                        variant="secondary"
                        className="ml-auto shrink-0 text-[10px]"
                      >
                        owner
                      </Badge>
                    )}
                  </>
                ) : (
                  <span className="italic text-muted-foreground/50">
                    — empty —
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onSelect}>
          <Pencil className="mr-1.5 h-3 w-3" />
          Edit
        </Button>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button variant="outline" size="sm" disabled={removing} />
            }
          >
            {removing ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-3 w-3" />
            )}
            Remove
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove User</AlertDialogTitle>
              <AlertDialogDescription>
                This will remove {user.discord_name} from the{" "}
                {user.whitelist_name} whitelist. This action cannot be undone.
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
      </CardFooter>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  User Detail Sheet                                                  */
/* ------------------------------------------------------------------ */

// Auto-detect ID type — now supports Steam profile URLs
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

function UserDetailSheet({
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

/* ------------------------------------------------------------------ */
/*  Rematch Orphans Button                                             */
/* ------------------------------------------------------------------ */

function RematchOrphansButton({ onDone }: { onDone: () => void }) {
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

function PurgeOrphansButton({ onDone }: { onDone: () => void }) {
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

function SyncTiersButton({ onDone }: { onDone: () => void }) {
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

/* ------------------------------------------------------------------ */
/*  Add Steam Entry Dialog — no Discord required                       */
/* ------------------------------------------------------------------ */

function AddSteamEntryDialog({
  whitelists,
}: {
  whitelists: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [whitelistSlug, setWhitelistSlug] = useState(whitelists[0]?.slug ?? "");
  const [ids, setIds] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  function reset() {
    setName(""); setIds(""); setSubmitting(false);
  }

  async function handleAdd() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!ids.trim()) { toast.error("At least one Steam64 or EOS ID is required"); return; }
    if (!whitelistSlug) { toast.error("Select a whitelist"); return; }

    const parsed = ids.split(/[\s,\n]+/).map((s) => s.trim()).filter(Boolean);
    const steamIds = parsed.filter((s) => /^7656119\d{10}$/.test(s));
    const eosIds = parsed.filter((s) => /^[0-9a-f]{32}$/i.test(s));
    const invalid = parsed.filter((s) => !steamIds.includes(s) && !eosIds.includes(s));

    if (invalid.length > 0) {
      toast.error(`Invalid IDs: ${invalid.join(", ")}`);
      return;
    }
    if (steamIds.length === 0 && eosIds.length === 0) {
      toast.error("No valid IDs found");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/admin/users", {
        discord_name: name.trim(),
        whitelist_slug: whitelistSlug,
        steam_ids: steamIds,
        eos_ids: eosIds,
      });
      toast.success(`Added ${name.trim()} — ${steamIds.length + eosIds.length} ID(s)`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      reset();
      setOpen(false);
    } catch {
      toast.error("Failed to add entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add Steam Entry
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Steam / EOS Entry</DialogTitle>
          <DialogDescription>
            Add a player by Steam64 or EOS ID without requiring a Discord account.
            They can claim this record later via the bot panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Player Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Armyrat60" />
          </div>
          <div className="space-y-2">
            <Label>Whitelist</Label>
            <Select value={whitelistSlug} onValueChange={(v) => setWhitelistSlug(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select whitelist" /></SelectTrigger>
              <SelectContent>
                {whitelists.map((wl) => (
                  <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Steam64 / EOS IDs</Label>
            <Textarea
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              placeholder={"76561198012345678\n76561198012345679"}
              rows={3}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">One per line, or comma-separated. Steam64 = 17 digits starting with 7656119. EOS = 32 hex chars.</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleAdd} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Add Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}