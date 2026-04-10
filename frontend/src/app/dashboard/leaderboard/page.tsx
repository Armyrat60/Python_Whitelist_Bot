"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Trophy,
  Calendar,
  Sprout,
  Medal,
  Flame,
} from "lucide-react";
import { usePlayerLeaderboard } from "@/hooks/use-settings";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

const SORT_MODES = [
  { key: "tenure", label: "Longest Members", icon: Calendar, description: "Ranked by membership tenure" },
  { key: "seeding_hours", label: "Top Seeders", icon: Sprout, description: "Ranked by seeding hours" },
] as const;

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-amber-400 font-bold">🥇</span>;
  if (rank === 2) return <span className="text-gray-300 font-bold">🥈</span>;
  if (rank === 3) return <span className="text-amber-700 font-bold">🥉</span>;
  return <span className="text-xs text-muted-foreground w-6 text-right">{rank}</span>;
}

export default function LeaderboardPage() {
  const [sort, setSort] = useState("tenure");
  const { data, isLoading } = usePlayerLeaderboard(sort);

  const entries = data?.entries ?? [];
  const activeMode = SORT_MODES.find((m) => m.key === sort) ?? SORT_MODES[0];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          Player Leaderboard
        </h2>
        <p className="text-sm text-muted-foreground">
          {activeMode.description}
        </p>
      </div>

      {/* Sort Mode Tabs */}
      <div className="flex gap-2">
        {SORT_MODES.map((mode) => {
          const Icon = mode.icon;
          return (
            <button
              key={mode.key}
              onClick={() => setSort(mode.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                sort === mode.key
                  ? "bg-white/[0.08] text-white ring-1 ring-white/[0.12]"
                  : "text-muted-foreground hover:text-white/70 hover:bg-white/[0.04]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {mode.label}
            </button>
          );
        })}
      </div>

      {/* Leaderboard */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Medal className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
            {activeMode.label}
            {data && <Badge variant="secondary" className="text-[10px]">{data.total}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No data yet.</p>
          ) : (
            <div className="space-y-1">
              {entries.map((entry) => (
                <div
                  key={`${entry.discord_id ?? entry.steam_id}-${entry.rank}`}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/[0.04] transition-colors"
                >
                  <div className="w-8 text-center shrink-0">
                    <RankBadge rank={entry.rank} />
                  </div>

                  <div className="flex-1 min-w-0">
                    {entry.discord_id ? (
                      <Link
                        href={`/dashboard/players/${entry.discord_id}`}
                        className="text-sm font-medium text-white/80 hover:text-white truncate block"
                      >
                        {entry.player_name ?? "Unknown"}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-white/80 truncate block">
                        {entry.player_name ?? "Unknown"}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {entry.discord_id ?? entry.steam_id}
                    </span>
                  </div>

                  {/* Stats based on sort mode */}
                  {sort === "tenure" && entry.member_days !== null && (
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-white/90">{entry.member_days}d</p>
                      {entry.whitelist_name && (
                        <p className="text-[10px] text-muted-foreground">{entry.whitelist_name}</p>
                      )}
                    </div>
                  )}

                  {sort === "seeding_hours" && (
                    <div className="flex items-center gap-3 shrink-0">
                      {entry.current_streak !== null && entry.current_streak > 0 && (
                        <div className="flex items-center gap-0.5 text-[10px] text-amber-400">
                          <Flame className="h-3 w-3" />
                          {entry.current_streak}d
                        </div>
                      )}
                      {entry.rewarded && (
                        <Badge variant="default" className="text-[8px] px-1 py-0" style={{ background: "var(--accent-primary)", color: "black" }}>R</Badge>
                      )}
                      <p className="text-sm font-bold text-white/90 w-16 text-right">
                        {entry.seeding_hours}h
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
