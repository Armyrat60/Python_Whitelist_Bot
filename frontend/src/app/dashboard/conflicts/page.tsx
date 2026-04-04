"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
}

interface DuplicateEntry {
  steam_id: string;
  holder_count: number;
  holders: DuplicateHolder[];
}

function useDuplicateIds() {
  return useQuery<{ duplicates: DuplicateEntry[] }>({
    queryKey: ["duplicate-ids"],
    queryFn: () => api.get<{ duplicates: DuplicateEntry[] }>("/api/admin/health/duplicate-ids"),
  });
}

export default function ConflictsPage() {
  const { data, isLoading, error } = useDuplicateIds();
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);

  const duplicates = data?.duplicates ?? [];

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
      toast.success(`Removed Steam ID from user`);
      queryClient.invalidateQueries({ queryKey: ["duplicate-ids"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setRemoving(null);
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
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              {duplicates.length} Conflicting Steam ID{duplicates.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-white/[0.06]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Steam ID</TableHead>
                    <TableHead>Registered To</TableHead>
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
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{holder.discord_name || "(unknown)"}</span>
                            <span className="text-[10px] font-mono text-muted-foreground">{holder.discord_id}</span>
                          </div>
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
