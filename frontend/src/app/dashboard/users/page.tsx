"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Users,
  List,
  LayoutGrid,
  Download,
  ExternalLink,
  BadgeCheck,
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
import {
  StatusBadge,
  TierChip,
  WhitelistBadge,
  RegSourceChip,
  TempChip,
  SlotBar,
} from "@/components/users/badges";
import {
  BulkActionBar,
  RematchOrphansButton,
  PurgeOrphansButton,
  SyncTiersButton,
} from "@/components/users/bulk-actions";
import { RoleHistoryTab } from "@/components/users/role-history-tab";
import { AddSteamEntryDialog } from "@/components/users/add-steam-dialog";
import { UserDetailSheet } from "@/components/users/user-detail-sheet";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

type ViewMode = "list" | "cards";

/** Unique key for a user row (composite: discord_id + whitelist_slug) */
function userKey(user: WhitelistUser) {
  return `${user.discord_id}::${user.whitelist_slug}`;
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
  const [showGapReport, setShowGapReport] = useState(true);
  interface GapMember { discord_id: string; username: string; display_name: string; whitelisted_roles: string[] }
  const { data: gapData } = useQuery<{members: GapMember[]; total: number}>({
    queryKey: ["gap-report"],
    queryFn: () => api.get("/api/admin/members/gap"),
    staleTime: 60_000,
  });
  function loadGapReport() {
    setShowGapReport(true);
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
        const totalWithRoles = statsData.total_active_users + (gapData?.total ?? 0);
        const stats = [
          { label: "Active Members", value: statsData.total_active_users, sub: `of ${totalWithRoles} with roles`, color: "text-emerald-400" },
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
                  onClick={() => { setShowGapReport(true); document.getElementById("gap-section")?.scrollIntoView({ behavior: "smooth" }); }}
                  title="Discord members with a whitelist role who haven't submitted any IDs yet"
                >
                  <Users className="mr-1.5 h-3.5 w-3.5" />
                  Gap Report {gapData?.total ? `(${gapData.total})` : ""}
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

                  {/* Linked Status */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Linked</label>
                    <div className="flex gap-1">
                      <Button
                        variant={filters.verified === "true" ? "secondary" : "outline"}
                        size="sm"
                        className="h-8 flex-1 justify-center gap-1 text-xs"
                        onClick={() => { setFilters(p => ({ ...p, verified: p.verified === "true" ? "" : "true" })); }}
                      >
                        <BadgeCheck className={`h-3.5 w-3.5 ${filters.verified === "true" ? "text-emerald-400" : ""}`} />
                        Linked
                      </Button>
                      <Button
                        variant={filters.verified === "false" ? "secondary" : "outline"}
                        size="sm"
                        className="h-8 flex-1 justify-center gap-1 text-xs"
                        onClick={() => { setFilters(p => ({ ...p, verified: p.verified === "false" ? "" : "false" })); }}
                      >
                        Not Linked
                      </Button>
                    </div>
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

      {/* ---- Unregistered Role Holders ---- */}
      {gapData && gapData.total > 0 && (
        <div id="gap-section" className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold flex items-center gap-2">
                Not Registered
                <Badge variant="outline" className="text-yellow-400 border-yellow-500/30">{gapData.total}</Badge>
              </h3>
              <p className="text-xs text-muted-foreground">
                These members have a whitelist role but haven't submitted their IDs yet
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowGapReport(!showGapReport)}>
              {showGapReport ? "Hide" : "Show"}
            </Button>
          </div>
          {showGapReport && (
            <div className="max-h-96 overflow-y-auto space-y-1">
              {gapData.members.map((m) => (
                <div key={m.discord_id} className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-yellow-500/10">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.display_name || m.username}</span>
                    <Badge variant="outline" className="text-yellow-400 border-yellow-500/30 text-[10px]">Not Registered</Badge>
                  </div>
                  <div className="flex gap-1">
                    {m.whitelisted_roles.map((r) => (
                      <Badge key={r} variant="outline" className="text-[10px] border-white/10 text-muted-foreground">{r}</Badge>
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
                {user.is_verified ? (
                  <Badge variant="outline" className="shrink-0 text-emerald-400 border-emerald-500/30 text-[10px] gap-0.5 py-0 h-5">
                    <BadgeCheck className="h-3 w-3" />
                    Linked
                  </Badge>
                ) : (
                  <Badge variant="outline" className="shrink-0 text-yellow-400 border-yellow-500/30 text-[10px] py-0 h-5">
                    Not Linked
                  </Badge>
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
