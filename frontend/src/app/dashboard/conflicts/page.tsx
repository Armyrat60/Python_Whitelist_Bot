"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2, CheckCircle2, Import, Link, UserX } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface DuplicateHolder {
  discord_id: string;
  discord_name: string | null;
  discord_username: string | null;
  verification_source: string | null;
  created_at: string;
  is_orphan: boolean;
}

interface DuplicateEntry {
  steam_id: string;
  holder_count: number;
  holders: DuplicateHolder[];
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function sourceLabel(source: string | null): string {
  switch (source) {
    case "discord_connection": return "Discord Link";
    case "steam_openid":       return "Steam Login";
    case "steam_api":          return "Steam API";
    case "manual":             return "Manual";
    case "bridge_sync":        return "Bridge Sync";
    case "squadjs_bridge":     return "In-Game";
    case "eos_auto_linked":    return "EOS Auto-Link";
    case "seeding_reward":     return "Seeding Reward";
    case "import":             return "Imported";
    default:                   return source || "Unknown";
  }
}

function useDuplicateIds() {
  return useQuery<{ duplicates: DuplicateEntry[] }>({
    queryKey: ["duplicate-ids"],
    queryFn: () => api.get<{ duplicates: DuplicateEntry[] }>("/api/admin/health/duplicate-ids"),
  });
}

export default function ConflictsPage() {
  const { data, isLoading } = useDuplicateIds();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [bulkRemoving, setBulkRemoving] = useState(false);

  const duplicates = data?.duplicates ?? [];
  const orphanConflictCount = duplicates.filter(d => d.holders.some(h => h.is_orphan)).length;

  async function handleRemove(steamId: string, discordId: string) {
    const key = `${steamId}:${discordId}`;
    setRemoving(key);
    try {
      const res = await fetch("/api/admin/health/identifier", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steam_id: steamId, discord_id: discordId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to remove");
      toast.success("Removed Steam ID from user");
      queryClient.invalidateQueries({ queryKey: ["duplicate-ids"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemoving(null);
    }
  }

  async function handleBulkResolve() {
    setBulkRemoving(true);
    try {
      const res = await fetch("/api/admin/health/conflicts/orphans", {
        method: "DELETE",
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to resolve");
      toast.success(`Removed ${json.removed} orphaned entries`);
      queryClient.invalidateQueries({ queryKey: ["duplicate-ids"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resolve");
    } finally {
      setBulkRemoving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Steam ID Conflicts</h2>
        <p className="text-sm text-muted-foreground">
          These Steam IDs are registered to multiple users. Remove the incorrect assignment to resolve each conflict.
        </p>
      </div>

      {duplicates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <p className="text-sm text-muted-foreground">No conflicts found — all Steam IDs are unique.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                {duplicates.length} Conflicting Steam ID{duplicates.length !== 1 ? "s" : ""}
              </CardTitle>
              {orphanConflictCount > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                  disabled={bulkRemoving}
                  onClick={handleBulkResolve}
                >
                  {bulkRemoving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <UserX className="h-3.5 w-3.5 mr-1" />
                  )}
                  Resolve All Imported ({orphanConflictCount})
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-white/[0.10]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Steam ID</TableHead>
                    <TableHead>Registered To</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Added</TableHead>
                    <TableHead className="w-24">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {duplicates.map((dup) =>
                    dup.holders.map((holder, idx) => (
                      <TableRow key={`${dup.steam_id}-${holder.discord_id}`}>
                        {idx === 0 ? (
                          <TableCell rowSpan={dup.holders.length} className="font-mono text-xs align-top pt-4">
                            {dup.steam_id}
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-medium">
                                  {holder.discord_name || "(unknown)"}
                                </span>
                                {holder.is_orphan && (
                                  <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                                    <Import className="h-2.5 w-2.5" />
                                    Imported
                                  </Badge>
                                )}
                              </div>
                              {holder.is_orphan ? (
                                <span className="text-[10px] text-muted-foreground">No linked Discord account</span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  {holder.discord_username ? `@${holder.discord_username}` : holder.discord_id}
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            {holder.verification_source === "discord_connection" ? (
                              <Link className="h-3 w-3" />
                            ) : null}
                            {sourceLabel(holder.verification_source)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground" title={holder.created_at ? new Date(holder.created_at).toLocaleString() : ""}>
                            {holder.created_at ? formatRelative(holder.created_at) : "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            disabled={removing === `${dup.steam_id}:${holder.discord_id}`}
                            onClick={() => handleRemove(dup.steam_id, holder.discord_id)}
                          >
                            {removing === `${dup.steam_id}:${holder.discord_id}` ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                            <span className="ml-1">Remove</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
