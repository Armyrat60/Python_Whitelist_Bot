"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { RotateCcw, Clock, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useWhitelists } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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

function useRoleLoss(days: number, whitelistSlug: string) {
  return useQuery({
    queryKey: ["role-loss", days, whitelistSlug || null],
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) })
      if (whitelistSlug) params.set("whitelist_slug", whitelistSlug)
      return api.get<{ users: RoleLossEntry[] }>(`/api/admin/role-loss?${params}`)
    },
  })
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "2-digit",
  })
}

function heldFor(addedAt: string, lostAt: string): string {
  const days = Math.floor((new Date(lostAt).getTime() - new Date(addedAt).getTime()) / (1000 * 60 * 60 * 24))
  if (days < 1) return "< 1 day"
  if (days === 1) return "1 day"
  if (days < 30) return `${days} days`
  const months = Math.floor(days / 30)
  return `${months} mo`
}

export default function RoleHistoryPage() {
  const [days, setDays] = useState(90)
  const [whitelistSlug, setWhitelistSlug] = useState("")
  const { data: whitelists } = useWhitelists()
  const { data, isFetching } = useRoleLoss(days, whitelistSlug)
  const qc = useQueryClient()

  const roleWhitelists = (whitelists ?? []).filter(wl => !wl.is_manual)
  const entries = data?.users ?? []

  async function handleRestore(entry: RoleLossEntry) {
    try {
      await api.patch(`/api/admin/users/${entry.discord_id}/${entry.whitelist_slug}`, { status: "active" })
      toast.success(`Restored ${entry.discord_name}`)
      qc.invalidateQueries({ queryKey: ["role-loss"] })
      qc.invalidateQueries({ queryKey: ["users"] })
    } catch {
      toast.error("Failed to restore user")
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white/90">Role History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Users who lost their Discord role and were deactivated from the whitelist.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Days selector */}
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

        {/* Whitelist filter */}
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
          {isFetching ? "Loading…" : `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
        </span>
      </div>

      {/* Table */}
      {isFetching && entries.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
          <UserRound className="mb-3 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm font-medium text-white/60">No role losses in the last {days} days</p>
          <p className="mt-1 text-xs text-muted-foreground">Members who lose their whitelist role will appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={`${entry.discord_id}::${entry.whitelist_slug}`}
              className="flex items-center gap-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition-colors hover:bg-white/[0.04]"
            >
              {/* Status indicator */}
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                <UserRound className="h-4 w-4 text-amber-400" />
              </div>

              {/* User info */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-white/90">{entry.discord_name}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">{entry.discord_id}</span>
                  <Badge
                    className="text-[10px] px-1.5 py-0"
                    style={{
                      background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
                      color: "var(--accent-primary)",
                      border: "1px solid color-mix(in srgb, var(--accent-primary) 25%, transparent)",
                    }}
                  >
                    {entry.whitelist_name}
                  </Badge>
                  {entry.last_plan_name && (
                    <span className="text-[10px] text-muted-foreground/60">{entry.last_plan_name}</span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <UserRound className="h-3 w-3 text-amber-400/70" />
                    Lost {formatRelative(entry.lost_at)} · {formatDate(entry.lost_at)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Held for {heldFor(entry.added_at, entry.lost_at)}
                  </span>
                </div>
              </div>

              {/* Restore */}
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
  )
}
