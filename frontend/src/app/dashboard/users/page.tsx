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
  List,
  LayoutGrid,
} from "lucide-react";
import { useUsers, useWhitelists, useSteamNames } from "@/hooks/use-settings";
import type { WhitelistUser } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  const queryClient = useQueryClient();

  const perPage = 24; // divisible by 1, 2, 3 for grid
  const { data, isLoading } = useUsers(page, perPage, search, filters);
  const { data: whitelists } = useWhitelists();

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
      </div>

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
            />
          ))}
        </div>
      ) : (
        <UserListView
          users={users}
          whitelists={whitelists ?? []}
          steamNames={steamNames}
          onSelect={setSelectedUser}
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
}: {
  users: WhitelistUser[];
  whitelists: { slug: string; name: string }[];
  steamNames: Record<string, string>;
  onSelect: (user: WhitelistUser) => void;
}) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <div className="divide-y divide-border rounded-lg border border-border">
      {/* Header */}
      <div className="hidden items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground sm:flex">
        <span className="w-8" />
        <span className="flex-1">Discord Name</span>
        <span className="w-28 text-center">Tier</span>
        <span className="w-20 text-center">Slots</span>
        <span className="w-20 text-center">Status</span>
        <span className="w-6" />
      </div>

      {users.map((user) => {
        const key = `${user.discord_id}-${user.whitelist_slug}`;
        const isExpanded = expandedKey === key;
        const allIds = [...(user.steam_ids ?? []), ...(user.eos_ids ?? [])];
        const usedSlots = allIds.length;

        return (
          <div key={key}>
            {/* Row */}
            <div
              className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
              onClick={() => setExpandedKey(isExpanded ? null : key)}
            >
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
}: {
  user: WhitelistUser;
  onSelect: () => void;
  whitelists: { slug: string; name: string }[];
  steamNames: Record<string, string>;
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
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-start gap-3">
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

function UserDetailSheet({
  user,
  onClose,
}: {
  user: WhitelistUser;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [steamIds, setSteamIds] = useState<string[]>(
    user.steam_ids?.length ? [...user.steam_ids] : [""]
  );
  const [eosIds, setEosIds] = useState<string[]>(
    user.eos_ids?.length ? [...user.eos_ids] : []
  );
  const [status, setStatus] = useState(user.status);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  function updateSteamId(idx: number, value: string) {
    setSteamIds((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function addSteamSlot() {
    setSteamIds((prev) => [...prev, ""]);
  }

  function removeSteamSlot(idx: number) {
    setSteamIds((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateEosId(idx: number, value: string) {
    setEosIds((prev) => {
      const next = [...prev];
      next[idx] = value;
      return next;
    });
  }

  function addEosSlot() {
    setEosIds((prev) => [...prev, ""]);
  }

  function removeEosSlot(idx: number) {
    setEosIds((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    const cleanSteam = steamIds.map((s) => s.trim()).filter(Boolean);
    const cleanEos = eosIds.map((s) => s.trim()).filter(Boolean);

    for (const sid of cleanSteam) {
      if (!/^7656119\d{10}$/.test(sid)) {
        toast.error(`Invalid Steam64 ID: ${sid}`);
        return;
      }
    }

    setSaving(true);
    try {
      await api.patch(
        `/api/admin/users/${user.discord_id}/${user.whitelist_slug}`,
        {
          status,
          steam_ids: cleanSteam,
          eos_ids: cleanEos,
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
            {(user.steam_ids?.length ?? 0) + (user.eos_ids?.length ?? 0)} /{" "}
            {user.effective_slot_limit}
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

      {/* Steam IDs */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Steam IDs</Label>
        {steamIds.map((id, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
              Slot {idx + 1}
            </span>
            <Input
              className="h-8 font-mono text-xs"
              value={id}
              onChange={(e) => updateSteamId(idx, e.target.value)}
              placeholder="76561198..."
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => removeSteamSlot(idx)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addSteamSlot}>
          <Plus className="mr-1 h-3 w-3" /> Add Steam ID
        </Button>
      </div>

      {/* EOS IDs */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">EOS IDs</Label>
        {eosIds.length === 0 && (
          <p className="text-xs text-muted-foreground">None</p>
        )}
        {eosIds.map((id, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
              EOS {idx + 1}
            </span>
            <Input
              className="h-8 font-mono text-xs"
              value={id}
              onChange={(e) => updateEosId(idx, e.target.value)}
              placeholder="0002a101..."
            />
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => removeEosSlot(idx)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={addEosSlot}>
          <Plus className="mr-1 h-3 w-3" /> Add EOS ID
        </Button>
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
