"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  CheckCircle2,
  X,
  Save,
  User as UserIcon,
  Users,
  List,
  LayoutGrid,
  Download,
  ArrowRightLeft,
} from "lucide-react";
import { useUsers, useWhitelists, useSteamNames } from "@/hooks/use-settings";
import type { WhitelistUser } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const statusVariant: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  inactive: "secondary",
  expired: "destructive",
};

type ViewMode = "list" | "cards";

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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTargetSlug, setMoveTargetSlug] = useState("");

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

  if (selectedCount === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-6 z-50 mx-auto flex w-fit items-center gap-3 rounded-xl border border-border bg-background/95 px-5 py-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>

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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedUser, setSelectedUser] = useState<WhitelistUser | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const perPage = 24; // divisible by 1, 2, 3 for grid
  const { data, isLoading } = useUsers(page, perPage, search, filters);
  const { data: whitelists } = useWhitelists();
  const [showGapReport, setShowGapReport] = useState(false);
  const [gapData, setGapData] = useState<{gap: {discord_id: string; name: string; matched_roles: string[]}[]; total_role_holders: number; total_registered: number} | null>(null);
  const [gapLoading, setGapLoading] = useState(false);

  async function loadGapReport() {
    setGapLoading(true);
    setShowGapReport(true);
    try {
      const data = await api.get<{gap: {discord_id: string; name: string; matched_roles: string[]}[]; total_role_holders: number; total_registered: number}>("/api/admin/members/gap");
      setGapData(data);
    } catch {
      toast.error("Failed to load gap report");
      setShowGapReport(false);
    } finally {
      setGapLoading(false);
    }
  }

  const users = data?.users ?? [];
  const steamNames = useSteamNames(users);

  // Debounced dynamic search — update after 300ms of no typing
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  function handleSearch() {
    setSearch(searchInput);
    setPage(1);
  }

  const totalPages = data ? Math.ceil(data.total / perPage) : 0;

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
      {/* ---- Toolbar ---- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <div className="flex gap-2">
            <Input
              placeholder="Search users..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="max-w-sm"
            />
            <Button variant="outline" size="icon" onClick={handleSearch}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <Select
          value={filters.whitelist ?? ""}
          onValueChange={(v) => {
            setFilters((prev) => ({
              ...prev,
              whitelist: v === "__all__" ? "" : (v ?? ""),
            }));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All whitelists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All whitelists</SelectItem>
            {whitelists?.map((wl) => (
              <SelectItem key={wl.slug} value={wl.slug}>
                {wl.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={filters.status ?? ""}
          onValueChange={(v) => {
            setFilters((prev) => ({
              ...prev,
              status: v === "__all__" ? "" : (v ?? ""),
            }));
            setPage(1);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue placeholder="All status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>

        {/* View toggle */}
        <div className="flex rounded-md border border-border">
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-r-none"
            onClick={() => setViewMode("list")}
          >
            <List className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "cards" ? "secondary" : "ghost"}
            size="icon"
            className="h-8 w-8 rounded-l-none"
            onClick={() => setViewMode("cards")}
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>

        <AddUserDialog whitelists={whitelists ?? []} />
        <Button variant="outline" size="sm" onClick={loadGapReport} disabled={gapLoading}>
          {gapLoading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Users className="mr-1.5 h-3.5 w-3.5" />
          )}
          Gap Report
        </Button>
      </div>

      {/* ---- Member Gap Report ---- */}
      {showGapReport && gapData && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">Unregistered Members</h3>
              <p className="text-xs text-muted-foreground">
                {gapData.gap.length} member(s) have a whitelist role but haven't submitted IDs
                &nbsp;·&nbsp;{gapData.total_registered}/{gapData.total_role_holders} registered
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowGapReport(false)}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {gapData.gap.length === 0 ? (
            <p className="text-sm text-emerald-400">All role holders have registered!</p>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-1">
              {gapData.gap.map((m) => (
                <div key={m.discord_id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-yellow-500/10">
                  <div>
                    <span className="font-medium">{m.name}</span>
                    <span className="ml-2 font-mono text-muted-foreground">{m.discord_id}</span>
                  </div>
                  <div className="flex gap-1">
                    {m.matched_roles.map((r) => (
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
        />
      )}

      {/* ---- Pagination ---- */}
      {totalPages > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {data?.total ?? 0} total users
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm">
              Page {page} of {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* ---- User Detail Sheet ---- */}
      <Sheet
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selectedUser?.discord_name ?? "User"}</SheetTitle>
            <SheetDescription>{selectedUser?.discord_id}</SheetDescription>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  List View                                                          */
/* ------------------------------------------------------------------ */

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
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {/* Header */}
      <div className="hidden items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
        <span
          className="flex w-8 cursor-pointer items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelectAll();
          }}
        >
          <Checkbox
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            onCheckedChange={() => onToggleSelectAll()}
          />
        </span>
        <span className="w-8" />
        <span className="flex-1">Discord Name</span>
        <span className="w-28 text-center">Tier</span>
        <span className="w-20 text-center">Slots</span>
        <span className="w-20 text-center">Status</span>
        <span className="w-6" />
      </div>

      {users.map((user) => {
        const key = userKey(user);
        const isExpanded = expandedKey === key;
        const allIds = [...(user.steam_ids ?? []), ...(user.eos_ids ?? [])];
        const usedSlots = allIds.length;
        const isSelected = selectedIds.has(key);

        return (
          <div key={key}>
            {/* Row */}
            <div
              className={cn(
                "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50",
                isSelected && "bg-muted/40"
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
              <Avatar size="sm">
                <AvatarFallback>
                  {user.discord_name?.slice(0, 2).toUpperCase() ?? "??"}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {user.discord_name}
              </span>
              <span className="hidden w-28 text-center sm:block">
                <Badge variant="outline" className="text-[11px]">
                  {user.last_plan_name ?? user.whitelist_name}
                </Badge>
              </span>
              <span className="w-20 text-center text-xs text-muted-foreground">
                {usedSlots}/{user.effective_slot_limit}
              </span>
              <span className="w-20 text-center">
                <Badge
                  variant={statusVariant[user.status] ?? "outline"}
                  className={cn(
                    "text-[11px]",
                    user.status === "active" &&
                      "bg-orange-500/15 text-orange-400 dark:bg-orange-500/20 dark:text-orange-300"
                  )}
                >
                  {user.status}
                </Badge>
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
            <p className="text-xs">
              <span className="text-muted-foreground">Tier: </span>
              {user.last_plan_name}
            </p>
          )}
        </div>
      </div>

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
          <Avatar
            size="default"
            className="cursor-pointer"
            onClick={onSelect}
          >
            <AvatarFallback>
              {user.discord_name?.slice(0, 2).toUpperCase() ?? "??"}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <CardTitle
              className="cursor-pointer truncate hover:underline"
              onClick={onSelect}
            >
              {user.discord_name}
            </CardTitle>
            <CardDescription className="font-mono text-[11px]">
              {user.discord_id}
            </CardDescription>
          </div>
          <Badge
            variant={statusVariant[user.status] ?? "outline"}
            className={cn(
              user.status === "active" &&
                "bg-orange-500/15 text-orange-400 dark:bg-orange-500/20 dark:text-orange-300"
            )}
          >
            {user.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        {/* Role / tier badge */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            @{user.whitelist_name}
          </Badge>
          {user.last_plan_name && (
            <span className="text-xs text-muted-foreground">
              {user.last_plan_name}
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {usedSlots}/{slotLimit} slots
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

  // Combine all IDs into unified slots
  const initialSlots = [
    ...(user.steam_ids ?? []),
    ...(user.eos_ids ?? []),
  ];
  if (initialSlots.length === 0) initialSlots.push("");

  const [slots, setSlots] = useState<string[]>(initialSlots);
  const [status, setStatus] = useState(user.status);
  const [expiresAt, setExpiresAt] = useState(user.expires_at ?? "");
  const [notes, setNotes] = useState(user.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

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
          steam_ids: steamIds,
          eos_ids: eosIds,
          expires_at: expiresAt || null,
          notes: notes || null,
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
      {/* Meta info */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Whitelist</Label>
          <Badge variant="outline">{user.whitelist_name}</Badge>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Tier</Label>
          <p className="text-sm">{user.last_plan_name ?? "—"}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Slots</Label>
          <p className="text-sm">
            {usedSlots} / {user.effective_slot_limit}
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
          {usedSlots > user.effective_slot_limit && (
            <span className="text-[11px] text-amber-400">
              Over slot limit ({usedSlots}/{user.effective_slot_limit}) — extra slots will be temporary
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Paste any ID — Steam64 (17 digits starting with 7656119), EOS (32 hex chars), or a Steam profile URL are auto-detected. URLs are converted to Steam64 on blur.
        </p>
      </div>

      {/* Expiry & Notes */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Expiry Date{" "}
            <span className="text-muted-foreground/60">(optional — leave blank for no expiry)</span>
          </Label>
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
/*  Add User Dialog — with role verification                           */
/* ------------------------------------------------------------------ */

interface RoleVerifyResult {
  discord_id: string;
  name: string;
  roles: string[];
  suggested_plan: string | null;
  suggested_slots: number;
}

type VerifyState =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "verified"; result: RoleVerifyResult }
  | { step: "no_role"; name?: string }
  | { step: "error"; message: string };

function AddUserDialog({
  whitelists,
}: {
  whitelists: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [discordId, setDiscordId] = useState("");
  const [whitelistSlug, setWhitelistSlug] = useState("");
  const [steamIds, setSteamIds] = useState("");
  const [eosIds, setEosIds] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [verifyState, setVerifyState] = useState<VerifyState>({
    step: "idle",
  });
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  function resetForm() {
    setDiscordId("");
    setWhitelistSlug("");
    setSteamIds("");
    setEosIds("");
    setExpiresAt("");
    setVerifyState({ step: "idle" });
    setSubmitting(false);
  }

  // Verify roles when Discord ID is entered and a whitelist is selected
  const handleVerify = useCallback(async () => {
    if (!discordId || !whitelistSlug) {
      toast.error("Enter a Discord ID and select a whitelist first");
      return;
    }

    setVerifyState({ step: "checking" });

    try {
      const res = await api.post<{ results: RoleVerifyResult[] }>(
        "/api/admin/verify-roles",
        {
          discord_ids: [discordId],
          whitelist_type: whitelistSlug,
        }
      );

      const match = res.results?.[0];
      if (match && match.suggested_plan) {
        setVerifyState({ step: "verified", result: match });
      } else if (match) {
        setVerifyState({ step: "no_role", name: match.name });
      } else {
        setVerifyState({ step: "no_role" });
      }
    } catch {
      setVerifyState({
        step: "error",
        message: "Failed to verify roles. The user may not be in the server.",
      });
    }
  }, [discordId, whitelistSlug]);

  async function handleAdd() {
    if (verifyState.step !== "verified") {
      toast.error("Role verification must pass before adding a user");
      return;
    }

    const steamList = steamIds
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const eosList = eosIds
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (steamList.length === 0 && eosList.length === 0) {
      toast.error("At least one Steam64 or EOS ID is required");
      return;
    }

    for (const sid of steamList) {
      if (!/^7656119\d{10}$/.test(sid)) {
        toast.error(`Invalid Steam64 ID: ${sid}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await api.post("/api/admin/users", {
        discord_id: discordId,
        discord_name:
          verifyState.result.name || `User ${discordId}`,
        whitelist_slug: whitelistSlug,
        steam_ids: steamList,
        eos_ids: eosList,
        expires_at: expiresAt || null,
      });
      toast.success("User added successfully");
      resetForm();
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch {
      toast.error("Failed to add user");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) resetForm();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add User
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Enter a Discord ID and verify their role before adding.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 1: Discord ID + whitelist selection */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>
                Discord ID <span className="text-destructive">*</span>
              </Label>
              <Input
                value={discordId}
                onChange={(e) => {
                  setDiscordId(e.target.value);
                  if (verifyState.step !== "idle")
                    setVerifyState({ step: "idle" });
                }}
                placeholder="e.g. 123456789012345678"
              />
            </div>
            <div className="space-y-2">
              <Label>
                Whitelist <span className="text-destructive">*</span>
              </Label>
              <Select
                value={whitelistSlug}
                onValueChange={(v) => {
                  setWhitelistSlug(v ?? "");
                  if (verifyState.step !== "idle")
                    setVerifyState({ step: "idle" });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select whitelist" />
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
          </div>

          {/* Verify button */}
          <Button
            variant="outline"
            className="w-full"
            disabled={
              !discordId ||
              !whitelistSlug ||
              verifyState.step === "checking"
            }
            onClick={handleVerify}
          >
            {verifyState.step === "checking" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <UserIcon className="mr-2 h-4 w-4" />
            )}
            Verify Discord Role
          </Button>

          {/* Verify result feedback */}
          {verifyState.step === "verified" && (
            <div className="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-500" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {verifyState.result.name}
                </p>
                <p className="text-muted-foreground">
                  Role: {verifyState.result.suggested_plan} —{" "}
                  {verifyState.result.suggested_slots} slot
                  {verifyState.result.suggested_slots !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          )}

          {verifyState.step === "no_role" && (
            <div className="flex items-start gap-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-500" />
              <div className="space-y-1 text-sm">
                <p className="font-medium">No whitelist role found</p>
                <p className="text-muted-foreground">
                  {verifyState.name ? `${verifyState.name} doesn't` : "This user doesn't"} have a
                  whitelist role assigned in Discord. They need one of the
                  mapped roles (e.g. @Spooky Whitelist, @Ghost Whitelist).
                  Assign the role first, then add them here.
                </p>
              </div>
            </div>
          )}

          {verifyState.step === "error" && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
              <p className="text-sm text-muted-foreground">
                {verifyState.message}
              </p>
            </div>
          )}

          {/* Step 2: IDs — only shown once verified */}
          {verifyState.step === "verified" && (
            <>
              <div className="space-y-2">
                <Label>
                  Steam64 IDs <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={steamIds}
                  onChange={(e) => setSteamIds(e.target.value)}
                  placeholder="e.g. 76561198012345678 (comma-separated)"
                />
                <p className="text-[11px] text-muted-foreground">
                  Must start with 7656119 and be 17 digits. Separate
                  multiple with commas.
                </p>
              </div>
              <div className="space-y-2">
                <Label>
                  EOS IDs{" "}
                  <span className="text-xs text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  value={eosIds}
                  onChange={(e) => setEosIds(e.target.value)}
                  placeholder="e.g. 0002a10186d9453eb8e43a8e67e4f25c"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Expiry Date{" "}
                  <span className="text-xs text-muted-foreground">
                    (optional)
                  </span>
                </Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={handleAdd}
            disabled={verifyState.step !== "verified" || submitting}
          >
            {submitting && (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            )}
            Add User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
