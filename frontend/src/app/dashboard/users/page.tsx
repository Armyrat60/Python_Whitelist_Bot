"use client";

import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  flexRender,
} from "@tanstack/react-table";
import { toast } from "sonner";
import {
  ArrowUpDown,
  Search,
  Plus,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useUsers, useWhitelists } from "@/hooks/use-settings";
import type { WhitelistUser } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

function avatarUrl(userId: string) {
  return `https://cdn.discordapp.com/avatars/${userId}/placeholder.webp?size=64`;
}

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  inactive: "secondary",
  expired: "destructive",
};

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selectedUser, setSelectedUser] = useState<WhitelistUser | null>(null);

  const perPage = 25;
  const { data, isLoading } = useUsers(page, perPage, search, filters);
  const { data: whitelists } = useWhitelists();

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

  const columns = useMemo<ColumnDef<WhitelistUser>[]>(
    () => [
      {
        accessorKey: "discord_name",
        header: "User",
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Avatar size="sm">
              <AvatarFallback>
                {row.original.discord_name?.slice(0, 2).toUpperCase() ?? "??"}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{row.original.discord_name}</p>
              <p className="text-xs text-muted-foreground">
                {row.original.discord_id}
              </p>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "whitelist_name",
        header: "Whitelist",
        cell: ({ row }) => (
          <Badge variant="outline">{row.original.whitelist_name}</Badge>
        ),
      },
      {
        accessorKey: "last_plan_name",
        header: "Tier",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {row.original.last_plan_name ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "effective_slot_limit",
        header: "Slots",
        cell: ({ row }) => {
          const used =
            (row.original.steam_ids?.length ?? 0) +
            (row.original.eos_ids?.length ?? 0);
          return (
            <span>
              {used} / {row.original.effective_slot_limit}
            </span>
          );
        },
      },
      {
        id: "steam_ids",
        header: "Steam IDs",
        cell: ({ row }) => (
          <span className="font-mono text-xs">
            {row.original.steam_ids?.length ?? 0}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Badge
            variant={statusVariant[row.original.status] ?? "outline"}
          >
            {row.original.status}
          </Badge>
        ),
      },
      {
        accessorKey: "updated_at",
        header: "Last Updated",
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.updated_at).toLocaleDateString()}
          </span>
        ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: data?.users ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualPagination: true,
    pageCount: data ? Math.ceil(data.total / perPage) : -1,
  });

  const totalPages = data ? Math.ceil(data.total / perPage) : 0;

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
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
            setFilters((prev) => ({ ...prev, whitelist: v === "__all__" ? "" : (v ?? "") }));
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
            setFilters((prev) => ({ ...prev, status: v === "__all__" ? "" : (v ?? "") }));
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
        <AddUserDialog whitelists={whitelists ?? []} />
      </div>

      {/* Data Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-zinc-800">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        className={cn(
                          header.column.getCanSort() && "cursor-pointer select-none"
                        )}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          {header.column.getCanSort() && (
                            <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No users found.
                    </TableCell>
                  </TableRow>
                ) : (
                  table.getRowModel().rows.map((row) => (
                    <TableRow
                      key={row.id}
                      className="cursor-pointer"
                      onClick={() => setSelectedUser(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
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
        </>
      )}

      {/* User Detail Sheet */}
      <Sheet
        open={!!selectedUser}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      >
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selectedUser?.discord_name ?? "User"}</SheetTitle>
            <SheetDescription>
              {selectedUser?.discord_id}
            </SheetDescription>
          </SheetHeader>
          {selectedUser && <UserDetail user={selectedUser} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function UserDetail({ user }: { user: WhitelistUser }) {
  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Whitelist</Label>
        <Badge variant="outline">{user.whitelist_name}</Badge>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Status</Label>
        <Badge variant={statusVariant[user.status] ?? "outline"}>
          {user.status}
        </Badge>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Tier</Label>
        <p className="text-sm">{user.last_plan_name ?? "—"}</p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Slots</Label>
        <p className="text-sm">
          {(user.steam_ids?.length ?? 0) + (user.eos_ids?.length ?? 0)} /{" "}
          {user.effective_slot_limit}
        </p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Steam IDs</Label>
        {user.steam_ids?.length ? (
          <ul className="space-y-1">
            {user.steam_ids.map((id) => (
              <li key={id} className="font-mono text-xs">
                {id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None</p>
        )}
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">EOS IDs</Label>
        {user.eos_ids?.length ? (
          <ul className="space-y-1">
            {user.eos_ids.map((id) => (
              <li key={id} className="font-mono text-xs">
                {id}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None</p>
        )}
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Created</Label>
        <p className="text-xs">{new Date(user.created_at).toLocaleString()}</p>
      </div>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Last Updated</Label>
        <p className="text-xs">{new Date(user.updated_at).toLocaleString()}</p>
      </div>
    </div>
  );
}

function AddUserDialog({
  whitelists,
}: {
  whitelists: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [discordId, setDiscordId] = useState("");
  const [discordName, setDiscordName] = useState("");
  const [whitelistSlug, setWhitelistSlug] = useState("");
  const [steamIds, setSteamIds] = useState("");
  const [eosIds, setEosIds] = useState("");
  const queryClient = useQueryClient();

  async function handleAdd() {
    if (!discordId || !whitelistSlug) {
      toast.error("Discord ID and whitelist are required");
      return;
    }
    // Parse comma/newline separated IDs
    const steamList = steamIds.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const eosList = eosIds.split(/[,\n]/).map(s => s.trim()).filter(Boolean);

    if (steamList.length === 0 && eosList.length === 0) {
      toast.error("At least one Steam64 or EOS ID is required");
      return;
    }

    // Validate Steam64 format
    for (const sid of steamList) {
      if (!/^7656119\d{10}$/.test(sid)) {
        toast.error(`Invalid Steam64 ID: ${sid}`);
        return;
      }
    }

    try {
      await api.post(`/api/admin/users`, {
        discord_id: discordId,
        discord_name: discordName || `User ${discordId}`,
        whitelist_slug: whitelistSlug,
        steam_ids: steamList,
        eos_ids: eosList,
      });
      toast.success("User added successfully");
      setDiscordId("");
      setDiscordName("");
      setWhitelistSlug("");
      setSteamIds("");
      setEosIds("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    } catch {
      toast.error("Failed to add user");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add User
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add User</DialogTitle>
          <DialogDescription>
            Manually add a user to a whitelist with their IDs.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Discord ID <span className="text-destructive">*</span></Label>
              <Input
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                placeholder="e.g. 123456789012345678"
              />
            </div>
            <div className="space-y-2">
              <Label>Discord Name</Label>
              <Input
                value={discordName}
                onChange={(e) => setDiscordName(e.target.value)}
                placeholder="e.g. username"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Whitelist <span className="text-destructive">*</span></Label>
            <Select value={whitelistSlug} onValueChange={(v) => setWhitelistSlug(v ?? "")}>
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
          <div className="space-y-2">
            <Label>Steam64 IDs <span className="text-destructive">*</span></Label>
            <Input
              value={steamIds}
              onChange={(e) => setSteamIds(e.target.value)}
              placeholder="e.g. 76561198012345678 (comma-separated for multiple)"
            />
            <p className="text-[11px] text-muted-foreground">
              Must start with 7656119 and be 17 digits. Separate multiple with commas.
            </p>
          </div>
          <div className="space-y-2">
            <Label>EOS IDs <span className="text-xs text-muted-foreground">(optional)</span></Label>
            <Input
              value={eosIds}
              onChange={(e) => setEosIds(e.target.value)}
              placeholder="e.g. 0002a10186d9453eb8e43a8e67e4f25c"
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleAdd} disabled={!discordId || !whitelistSlug}>
            Add User
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
