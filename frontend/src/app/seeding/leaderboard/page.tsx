"use client";

import { Sprout, Trophy } from "lucide-react";
import { useSeedingPublicLeaderboard } from "@/hooks/use-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? "var(--accent-primary)" : pct >= 50 ? "#eab308" : "rgba(255,255,255,0.3)";
  return (
    <div className="h-2.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

export default function SeedingLeaderboardPage() {
  const { data, isLoading } = useSeedingPublicLeaderboard();

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!data?.enabled) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl mb-4"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Sprout className="h-7 w-7" style={{ color: "var(--accent-primary)" }} />
        </div>
        <h2 className="text-lg font-bold text-white/90 mb-2">Leaderboard Not Available</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          The seeding leaderboard is not currently enabled for this server. Ask your server administrator to enable it in the dashboard.
        </p>
      </div>
    );
  }

  const { players, points_required } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Trophy className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white/90">Seeding Leaderboard</h1>
          <p className="text-xs text-muted-foreground">
            Join the game server when it has few players to earn points. Reach the threshold to unlock whitelist rewards.
          </p>
        </div>
      </div>

      {points_required > 0 && (
        <p className="text-xs text-muted-foreground border border-white/[0.08] rounded-lg px-3 py-2">
          Earn <strong className="text-foreground">{points_required} points</strong> (1 point per minute while seeding) to unlock a whitelist slot.
        </p>
      )}

      {/* Leaderboard */}
      {players.length === 0 ? (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-12 text-center">
          <p className="text-sm text-muted-foreground">No seeding activity recorded yet. Join the game server when player count is low to start earning points toward whitelist rewards.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {players.map((player, idx) => (
            <div key={idx} className="flex items-center gap-3 rounded-xl bg-white/[0.02] border border-white/[0.06] px-4 py-3">
              <span className={`text-sm font-bold w-8 text-right shrink-0 ${
                idx === 0 ? "text-amber-400" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-700" : "text-white/30"
              }`}>
                #{idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/90 truncate">
                    {player.player_name ?? "Anonymous Seeder"}
                  </span>
                  {player.rewarded && (
                    <Badge variant="default" className="text-[9px] px-1.5 py-0" style={{ background: "var(--accent-primary)", color: "black" }}>
                      Rewarded
                    </Badge>
                  )}
                </div>
                <ProgressBar pct={player.progress_pct} />
              </div>
              <div className="text-right shrink-0">
                <span className="text-sm font-semibold text-white/70">
                  {player.points}/{points_required}
                </span>
                <span className="block text-[10px] text-muted-foreground">
                  {player.progress_pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info */}
      <p className="text-xs text-muted-foreground text-center leading-relaxed">
        Players earn 1 point per minute while seeding. Reach {points_required} points ({Math.round(points_required / 60 * 10) / 10} hours) to earn a whitelist reward.
      </p>
    </div>
  );
}
