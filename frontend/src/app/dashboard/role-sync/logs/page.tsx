"use client";

import { useState, useMemo } from "react";
import { History, ChevronLeft, ChevronRight, ArrowUp, ArrowDown } from "lucide-react";
import { useRoles } from "@/hooks/use-settings";
import { useRoleChangeLogs } from "@/hooks/use-role-sync";
import type { RoleChangeLogParams } from "@/hooks/use-role-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Combobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";

export default function RoleChangeLogsPage() {
  const { data: discordRoles } = useRoles();

  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [searchMember, setSearchMember] = useState("");
  const perPage = 50;

  const params: RoleChangeLogParams = {
    page,
    per_page: perPage,
    ...(roleFilter ? { role_id: roleFilter } : {}),
    ...(actionFilter ? { action: actionFilter as "gained" | "lost" } : {}),
  };

  const { data, isLoading } = useRoleChangeLogs(params);

  const roleOptions: ComboboxOption[] = useMemo(() => {
    const opts: ComboboxOption[] = [{ value: "", label: "All Roles" }];
    if (discordRoles) {
      opts.push(...discordRoles.map((r) => ({ value: r.id, label: r.name })));
    }
    return opts;
  }, [discordRoles]);

  const actionOptions: ComboboxOption[] = [
    { value: "", label: "All Actions" },
    { value: "gained", label: "Gained" },
    { value: "lost", label: "Lost" },
  ];

  // Client-side member name filter (since we search by display name, not discord_id)
  const entries = useMemo(() => {
    if (!data?.entries) return [];
    if (!searchMember.trim()) return data.entries;
    const q = searchMember.toLowerCase();
    return data.entries.filter((e) => e.discord_name.toLowerCase().includes(q));
  }, [data?.entries, searchMember]);

  function formatDate(iso: string) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <History className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          Role Change Logs
        </h1>
        <p className="text-sm text-muted-foreground">
          Track when members gain or lose watched Discord roles.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="w-48">
          <Combobox
            options={roleOptions}
            value={roleFilter}
            onValueChange={(v) => { setRoleFilter(v); setPage(1); }}
            placeholder="Filter by role"
            searchPlaceholder="Search roles..."
          />
        </div>
        <div className="w-36">
          <Combobox
            options={actionOptions}
            value={actionFilter}
            onValueChange={(v) => { setActionFilter(v); setPage(1); }}
            placeholder="Action"
          />
        </div>
        <Input
          placeholder="Search member..."
          value={searchMember}
          onChange={(e) => setSearchMember(e.target.value)}
          className="w-48"
        />
        {data && (
          <div className="ml-auto flex items-center text-xs text-muted-foreground">
            {data.total} total entries
          </div>
        )}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !entries.length ? (
            <div className="py-16 text-center">
              <History className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                {data?.total === 0
                  ? "No role changes logged yet. Configure watched roles on the Role Sync page."
                  : "No entries match the current filters."}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Time</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="w-24">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(entry.created_at)}
                    </TableCell>
                    <TableCell className="font-medium text-sm">
                      {entry.discord_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                        {entry.role_name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {entry.action === "gained" ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/20 text-[10px] px-1.5 py-0.5">
                          <ArrowUp className="mr-0.5 h-2.5 w-2.5" />
                          Gained
                        </Badge>
                      ) : (
                        <Badge className="bg-red-500/15 text-red-400 border-red-500/20 text-[10px] px-1.5 py-0.5">
                          <ArrowDown className="mr-0.5 h-2.5 w-2.5" />
                          Lost
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {data.pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
