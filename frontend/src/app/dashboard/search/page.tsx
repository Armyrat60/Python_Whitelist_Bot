"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Search, Shield, BookUser, Clock, Tag, UserRound, BadgeCheck } from "lucide-react";
import { usePlayerSearch } from "@/hooks/use-settings";
import type { PlayerSearchResult } from "@/hooks/use-settings";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeStatus(status: string, expiresAt: string | null) {
  if (status === "inactive" || status === "deactivated") return "inactive";
  if (!expiresAt) return status === "active" ? "active" : "inactive";
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return "expired";
  if (msLeft < 7 * 24 * 60 * 60 * 1000) return "expiring_soon";
  return "active";
}

function StatusDot({ status, expiresAt }: { status: string; expiresAt: string | null }) {
  const s = computeStatus(status, expiresAt);
  const colors: Record<string, string> = {
    active:        "bg-emerald-400",
    expiring_soon: "bg-amber-400",
    expired:       "bg-red-400",
    inactive:      "bg-white/20",
  };
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${colors[s] ?? "bg-white/20"}`} />;
}

// ── Search result card ────────────────────────────────────────────────────────

function PlayerCard({ player }: { player: PlayerSearchResult }) {
  const activeCount  = player.memberships.filter(m => computeStatus(m.status, m.expires_at) === "active").length;
  const expiringCount = player.memberships.filter(m => computeStatus(m.status, m.expires_at) === "expiring_soon").length;

  return (
    <Link
      href={`/dashboard/players/${player.discord_id}`}
      className="group flex items-start gap-4 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3.5 transition-colors hover:bg-white/[0.06] hover:border-white/[0.12]"
    >
      {/* Avatar placeholder */}
      <div
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)" }}
      >
        <UserRound className="h-4.5 w-4.5" style={{ color: "var(--accent-primary)", height: "18px", width: "18px" }} />
      </div>

      <div className="min-w-0 flex-1">
        {/* Name + ID */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm text-white/90">{player.discord_name}</span>
          {player.is_verified && (
            <span title="Bridge Verified"><BadgeCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" /></span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground">{player.discord_id}</span>
        </div>

        {/* Steam / EOS IDs */}
        {(player.steam_ids.length > 0 || player.eos_ids.length > 0) && (
          <div className="mt-1 flex flex-wrap gap-2">
            {player.steam_ids.map(id => (
              <span key={id} className="text-[11px] font-mono text-emerald-400/80">{id}</span>
            ))}
            {player.eos_ids.map(id => (
              <span key={id} className="text-[11px] font-mono text-blue-400/80 truncate max-w-[180px]">{id}</span>
            ))}
          </div>
        )}

        {/* Memberships */}
        {player.memberships.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {player.memberships.map((m, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60"
              >
                <StatusDot status={m.status} expiresAt={m.expires_at} />
                {m.is_manual
                  ? <BookUser className="h-2.5 w-2.5 shrink-0 opacity-60" />
                  : <Shield className="h-2.5 w-2.5 shrink-0 opacity-60" />
                }
                {m.whitelist_name}
                {m.category_name && (
                  <span className="flex items-center gap-0.5 opacity-70">
                    <Tag className="h-2.5 w-2.5" />{m.category_name}
                  </span>
                )}
                {m.expires_at && computeStatus(m.status, m.expires_at) === "expiring_soon" && (
                  <Clock className="h-2.5 w-2.5 text-amber-400" />
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Summary badges */}
      <div className="flex shrink-0 flex-col items-end gap-1">
        {activeCount > 0 && (
          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 border text-[10px] px-1.5 py-0">
            {activeCount} active
          </Badge>
        )}
        {expiringCount > 0 && (
          <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 border text-[10px] px-1.5 py-0">
            {expiringCount} expiring
          </Badge>
        )}
      </div>
    </Link>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlayerSearchPage() {
  const [input, setInput]   = useState("");
  const [query, setQuery]   = useState("");
  const [timer, setTimer]   = useState<ReturnType<typeof setTimeout> | null>(null);

  const { data, isFetching } = usePlayerSearch(query);

  const handleChange = useCallback((val: string) => {
    setInput(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setQuery(val.trim()), 300);
    setTimer(t);
  }, [timer]);

  const players = data?.players ?? [];
  const showResults = query.trim().length >= 2;

  return (
    <div className="max-w-2xl space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white/90">Player Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by Discord name, Discord ID, Steam64 ID, or EOS ID
        </p>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Name, Discord ID, Steam64, EOS ID…"
          className="pl-9"
          autoFocus
        />
      </div>

      {/* Results */}
      {showResults && (
        <div className="space-y-2">
          {isFetching && players.length === 0 && (
            <>
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </>
          )}

          {!isFetching && players.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <UserRound className="mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No players found matching &ldquo;{query}&rdquo;</p>
            </div>
          )}

          {players.length > 0 && (
            <p className="text-center text-xs text-muted-foreground pt-1">
              {players.length} result{players.length !== 1 ? "s" : ""}
            </p>
          )}

          {players.map((p) => (
            <PlayerCard key={p.discord_id} player={p} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!showResults && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Search className="mb-3 h-10 w-10 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">Type at least 2 characters to search</p>
        </div>
      )}
    </div>
  );
}
