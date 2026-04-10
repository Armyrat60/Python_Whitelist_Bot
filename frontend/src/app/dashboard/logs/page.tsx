"use client";

import { useState } from "react";
import {
  History,
  Loader2,
  Download,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useAudit, useWhitelists } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

const PER_PAGE = 50;

const ACTION_COLORS: Record<string, string> = {
  user_added: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  user_removed: "bg-red-500/15 text-red-400 border-red-500/20",
  user_disabled: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  user_reactivated: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  role_sync: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  panel_push: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  whitelist_created: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  whitelist_updated: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  whitelist_deleted: "bg-red-500/15 text-red-400 border-red-500/20",
  admin_purge_orphans: "bg-orange-500/15 text-orange-400 border-orange-500/20",
  seeding_reward: "bg-green-500/15 text-green-400 border-green-500/20",
};

const DEFAULT_COLOR = "bg-white/[0.06] text-white/60 border-white/[0.08]";

function formatAction(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function LogsPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const { data, isLoading } = useAudit(page, PER_PAGE, filters);
  const { data: whitelists } = useWhitelists();

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const hasFilters = Object.values(filters).some((v) => v);

  function updateFilter(key: string, value: string) {
    setPage(1);
    setFilters((prev) => {
      const next = { ...prev };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function clearFilters() {
    setPage(1);
    setFilters({});
  }

  function handleExport() {
    const params = new URLSearchParams();
    if (filters.action) params.set("action", filters.action);
    if (filters.type) params.set("type", filters.type);
    if (filters.date_from) params.set("date_from", filters.date_from);
    if (filters.date_to) params.set("date_to", filters.date_to);
    window.open(`/api/admin/audit/export?${params.toString()}`, "_blank");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <History className="h-5 w-5" />
            Audit Logs
          </h2>
          <p className="text-sm text-muted-foreground">
            {total > 0
              ? `${total.toLocaleString()} total entries`
              : "Activity history for your server"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Action
              </label>
              <select
                value={filters.action ?? ""}
                onChange={(e) => updateFilter("action", e.target.value)}
                className="flex h-8 w-44 items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
              >
                <option value="">All actions</option>
                <option value="user_added">User Added</option>
                <option value="user_removed">User Removed</option>
                <option value="user_disabled">User Disabled</option>
                <option value="user_reactivated">User Reactivated</option>
                <option value="role_sync">Role Sync</option>
                <option value="panel_push">Panel Push</option>
                <option value="whitelist_created">Whitelist Created</option>
                <option value="whitelist_updated">Whitelist Updated</option>
                <option value="whitelist_deleted">Whitelist Deleted</option>
                <option value="admin_purge_orphans">Purge Orphans</option>
                <option value="seeding_reward">Seeding Reward</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Whitelist
              </label>
              <select
                value={filters.type ?? ""}
                onChange={(e) => updateFilter("type", e.target.value)}
                className="flex h-8 w-40 items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50"
              >
                <option value="">All whitelists</option>
                {whitelists?.map((wl) => (
                  <option key={wl.slug} value={wl.slug}>
                    {wl.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Actor ID
              </label>
              <Input
                value={filters.actor ?? ""}
                onChange={(e) => updateFilter("actor", e.target.value)}
                placeholder="Discord ID"
                className="h-8 w-40 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                From
              </label>
              <Input
                type="date"
                value={filters.date_from ?? ""}
                onChange={(e) => updateFilter("date_from", e.target.value)}
                className="h-8 w-36 text-sm"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                To
              </label>
              <Input
                type="date"
                value={filters.date_to ?? ""}
                onChange={(e) => updateFilter("date_to", e.target.value)}
                className="h-8 w-36 text-sm"
              />
            </div>

            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-8 text-muted-foreground hover:text-white"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-6">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <History className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {hasFilters
                  ? "No entries match your filters."
                  : "No audit entries yet."}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-white/[0.10]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Time</TableHead>
                    <TableHead className="w-40">Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            ACTION_COLORS[entry.action_type] ?? DEFAULT_COLOR
                          }
                        >
                          {formatAction(entry.action_type)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.actor_discord_name ? (
                          <div className="flex flex-col">
                            <span className="text-sm">
                              {entry.actor_discord_name}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {entry.actor_discord_id}
                            </span>
                          </div>
                        ) : entry.actor_discord_id ? (
                          <span className="text-xs font-mono text-muted-foreground">
                            {entry.actor_discord_id}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {entry.target_discord_name ? (
                          <div className="flex flex-col">
                            <span className="text-sm">
                              {entry.target_discord_name}
                            </span>
                            <span className="text-[10px] font-mono text-muted-foreground">
                              {entry.target_discord_id}
                            </span>
                          </div>
                        ) : entry.target_discord_id ? (
                          <span className="text-xs font-mono text-muted-foreground">
                            {entry.target_discord_id}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/50">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                        {entry.details ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-white/[0.06] px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Prev
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
