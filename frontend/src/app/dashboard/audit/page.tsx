"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useAudit, useWhitelists } from "@/hooks/use-settings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

// Full action type list matching backend audit events
const ACTION_TYPES: { value: string; label: string }[] = [
  { value: "user_added",             label: "User Added" },
  { value: "user_removed",           label: "User Removed" },
  { value: "user_updated",           label: "User Updated" },
  { value: "ids_updated",            label: "IDs Updated" },
  { value: "auto_disable_role_lost", label: "Auto-Disabled (Role Lost)" },
  { value: "auto_reactivate_role_return", label: "Auto Re-enabled (Role Return)" },
  { value: "left_guild",             label: "Left Discord Server" },
  { value: "auto_expire",            label: "Expired" },
  { value: "daily_role_sync_add",    label: "Role Sync — Added" },
  { value: "daily_role_sync_remove", label: "Role Sync — Removed" },
  { value: "bulk_import",            label: "Bulk Import" },
  { value: "mod_override",           label: "Mod Override" },
  { value: "mod_remove",             label: "Mod Remove" },
  { value: "mod_set",                label: "Mod Set IDs" },
  { value: "panel_pushed",           label: "Panel Pushed" },
  { value: "settings_changed",       label: "Settings Changed" },
  { value: "whitelist_toggled",      label: "Whitelist Toggled" },
  { value: "role_mapping_added",     label: "Role Mapping Added" },
  { value: "role_mapping_removed",   label: "Role Mapping Removed" },
  { value: "resync",                 label: "Resync" },
  { value: "admin_add_user",         label: "Admin: Add User" },
  { value: "group_create",           label: "Group Created" },
  { value: "group_delete",           label: "Group Deleted" },
  { value: "group_edit_perms",       label: "Group Permissions Edited" },
];

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

function actionVariant(actionType: string): BadgeVariant {
  if (["user_added", "admin_add_user", "daily_role_sync_add", "auto_reactivate_role_return"].includes(actionType)) return "default";
  if (["user_removed", "auto_disable_role_lost", "left_guild", "auto_expire", "mod_remove", "daily_role_sync_remove"].includes(actionType)) return "destructive";
  if (["settings_changed", "whitelist_toggled", "role_mapping_added", "role_mapping_removed", "group_create", "group_delete", "group_edit_perms"].includes(actionType)) return "outline";
  return "secondary";
}

function actionLabel(actionType: string): string {
  return ACTION_TYPES.find((a) => a.value === actionType)?.label ?? actionType.replace(/_/g, " ");
}

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const { data: whitelists } = useWhitelists();

  const perPage = 25;
  const { data, isLoading } = useAudit(page, perPage, filters);
  const totalPages = data ? Math.ceil(data.total / perPage) : 0;

  function setFilter(key: string, value: string) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearFilter(key: string) {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setPage(1);
  }

  function buildExportUrl() {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }
    return `/api/admin/audit/export?${params.toString()}`;
  }

  const hasFilters = Object.values(filters).some(Boolean);

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Action type */}
        <Select
          value={filters.action ?? ""}
          onValueChange={(v) => setFilter("action", v === "__all__" ? "" : (v ?? ""))}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="All actions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All actions</SelectItem>
            {ACTION_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Whitelist */}
        <Select
          value={filters.type ?? ""}
          onValueChange={(v) => setFilter("type", v === "__all__" ? "" : (v ?? ""))}
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

        {/* Date from */}
        <div className="relative">
          <Input
            type="date"
            className="w-40"
            value={filters.date_from ?? ""}
            onChange={(e) => setFilter("date_from", e.target.value)}
          />
          {filters.date_from && (
            <button
              onClick={() => clearFilter("date_from")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Date to */}
        <div className="relative">
          <Input
            type="date"
            className="w-40"
            value={filters.date_to ?? ""}
            onChange={(e) => setFilter("date_to", e.target.value)}
          />
          {filters.date_to && (
            <button
              onClick={() => clearFilter("date_to")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Actor Discord ID */}
        <Input
          className="w-44"
          placeholder="Actor Discord ID"
          value={filters.actor ?? ""}
          onChange={(e) => setFilter("actor", e.target.value)}
        />

        {/* Clear all / Export */}
        <div className="ml-auto flex gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => { setFilters({}); setPage(1); }}>
              Clear filters
            </Button>
          )}
          <a href={buildExportUrl()} download="audit_log.csv">
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </a>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-white/[0.06]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Timestamp</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Whitelist</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.entries.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-muted-foreground"
                    >
                      No audit entries found.
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={actionVariant(entry.action_type)}>
                          {actionLabel(entry.action_type)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {entry.whitelist_name ? (
                          <Badge variant="outline">{entry.whitelist_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.actor_discord_id ? (
                          <button
                            className="hover:underline text-accent"
                            onClick={() => setFilter("actor", entry.actor_discord_id!)}
                            title="Filter by this actor"
                          >
                            {entry.actor_discord_id}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {entry.target_discord_id ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                        {entry.details ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {data?.total ?? 0} total entries
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
    </div>
  );
}
