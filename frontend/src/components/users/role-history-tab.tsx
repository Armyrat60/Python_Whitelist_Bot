"use client";

import { useState } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Clock, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { WhitelistBadge, TierChip } from "@/components/users/badges";

/* ------------------------------------------------------------------ */
/*  Types & Helpers                                                     */
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

/* ------------------------------------------------------------------ */
/*  RoleHistoryTab                                                      */
/* ------------------------------------------------------------------ */

export function RoleHistoryTab({ whitelists }: { whitelists: { slug: string; name: string; is_manual?: boolean }[] }) {
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
          {isFetching ? "Loading\u2026" : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
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
