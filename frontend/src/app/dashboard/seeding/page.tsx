"use client";

import Link from "next/link";
import {
  Sprout,
  Clock,
  Users,
  Trophy,
  Gift,
  Settings2,
  ArrowRight,
  TrendingUp,
  Link2,
} from "lucide-react";
import {
  useSeedingConfig,
  useSeedingStats,
} from "@/hooks/use-settings";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { SeedingConfig } from "@/lib/types";

function getConnectionStatus(config: SeedingConfig | null): "green" | "yellow" | "red" | "grey" {
  if (!config) return "grey";
  if (!config.enabled) return "grey";
  if (!config.last_poll_at) return "yellow";
  if (config.last_poll_status === "error") return "red";
  const age = Date.now() - new Date(config.last_poll_at).getTime();
  if (age > 5 * 60 * 1000) return "yellow";
  return "green";
}
const STATUS_COLORS: Record<string, string> = { green: "#10b981", yellow: "#eab308", red: "#ef4444", grey: "#6b7280" };
const STATUS_LABELS: Record<string, string> = { green: "Connected", yellow: "Connecting...", red: "Error", grey: "Not configured" };

function StatusDot({ status }: { status: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0 animate-pulse" style={{ background: STATUS_COLORS[status] ?? STATUS_COLORS.grey, boxShadow: `0 0 6px ${STATUS_COLORS[status] ?? STATUS_COLORS.grey}` }} />;
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? "var(--accent-primary)" : pct >= 50 ? "#eab308" : "rgba(255,255,255,0.3)";
  return (
    <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon }: { label: string; value: string | number; sub?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-1">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold text-white/90">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

export default function SeedingDashboard() {
  const { data: configData, isLoading: configLoading } = useSeedingConfig();
  const { data: stats, isLoading: statsLoading } = useSeedingStats();

  const config = configData?.config ?? null;
  const connStatus = getConnectionStatus(config);
  const isLoading = configLoading || statsLoading;

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-24 rounded-xl" /></div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // Not configured state
  if (!config) {
    return (
      <div className="max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}>
            <Sprout className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white/90">Seeding Dashboard</h1>
            <p className="text-xs text-muted-foreground">Reward players who help seed your server</p>
          </div>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-8 py-12 text-center space-y-4">
          <Sprout className="h-12 w-12 mx-auto text-muted-foreground/30" />
          <h2 className="text-lg font-semibold text-white/80">Get Started with Seeding Rewards</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Connect to your SquadJS instance and configure rewards to incentivize players who help seed your server.
          </p>
          <Link href="/dashboard/seeding/settings" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-black" style={{ background: "var(--accent-primary)" }}>
            <Settings2 className="h-4 w-4" /> Configure Seeding <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}>
          <Sprout className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white/90">Seeding Dashboard</h1>
            <StatusDot status={connStatus} />
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[connStatus]}</span>
          </div>
          <p className="text-xs text-muted-foreground">Live seeding status and activity</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={config.enabled ? "default" : "secondary"} className="text-[10px]">{config.enabled ? "Enabled" : "Disabled"}</Badge>
          <Link href="/dashboard/seeding/settings" className="text-xs text-muted-foreground hover:text-white/70 flex items-center gap-1">
            <Settings2 className="h-3.5 w-3.5" /> Settings
          </Link>
        </div>
      </div>

      {/* Poll status */}
      {config.last_poll_at && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> Last poll: {new Date(config.last_poll_at).toLocaleString()}
          {config.last_poll_status === "ok" && <span className="text-emerald-400 ml-1">{config.last_poll_message}</span>}
          {config.last_poll_status === "error" && <span className="text-red-400 ml-1">{config.last_poll_message}</span>}
        </div>
      )}

      {/* Stats grid */}
      <div className={`grid gap-3 ${config.require_discord_link && (stats?.pending_discord_link ?? 0) > 0 ? "grid-cols-4" : "grid-cols-3"}`}>
        <StatCard icon={Users} label="Active Seeders" value={stats?.total_seeders ?? 0} sub="Players with points this cycle" />
        <StatCard icon={Gift} label="Rewards Given" value={stats?.total_rewarded ?? 0} sub="Players who earned whitelist" />
        <StatCard icon={TrendingUp} label="Total Seeding" value={`${stats?.total_seeding_hours ?? 0}h`} sub="Combined hours all players" />
        {config.require_discord_link && (stats?.pending_discord_link ?? 0) > 0 && (
          <StatCard icon={Link2} label="Pending Link" value={stats?.pending_discord_link ?? 0} sub="Qualified but no Discord linked" />
        )}
      </div>

      {/* Two-column layout: Top seeders + Recent activity */}
      <div className="grid grid-cols-2 gap-4">
        {/* Top Seeders */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
              <h2 className="text-sm font-semibold text-white/80">Top Seeders</h2>
            </div>
            <Link href="/dashboard/seeding/leaderboard" className="text-[10px] text-muted-foreground hover:text-white/70 flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          {(!stats?.top_5 || stats.top_5.length === 0) ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No seeding data yet</p>
          ) : (
            <div className="space-y-2">
              {stats.top_5.map((player, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className={`text-xs font-bold w-5 text-right shrink-0 ${idx === 0 ? "text-amber-400" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-700" : "text-white/30"}`}>
                    {idx + 1}
                  </span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-white/80 truncate">{player.player_name ?? "Unknown"}</span>
                      {player.rewarded && <Badge variant="default" className="text-[8px] px-1 py-0" style={{ background: "var(--accent-primary)", color: "black" }}>R</Badge>}
                    </div>
                    <ProgressBar pct={player.progress_pct} />
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">{player.progress_pct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Rewards */}
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Gift className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
            <h2 className="text-sm font-semibold text-white/80">Recent Rewards</h2>
          </div>
          {(!stats?.recent_rewards || stats.recent_rewards.length === 0) ? (
            <p className="text-xs text-muted-foreground py-4 text-center">No rewards granted yet</p>
          ) : (
            <div className="space-y-2">
              {stats.recent_rewards.map((reward, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-white/80 truncate">{reward.player_name}</span>
                    <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">{reward.tier_label}</Badge>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(reward.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Current Config Summary */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-2">
        <h2 className="text-sm font-semibold text-white/80">Current Configuration</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Required Time</span>
            <span className="text-white/70">{Math.floor(config.points_required / 60)}h {config.points_required % 60}m</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Thresholds</span>
            <span className="text-white/70">{config.seeding_start_player_count} - {config.seeding_player_threshold} players</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Reward Duration</span>
            <span className="text-white/70">{Math.floor(config.reward_duration_hours / 24)}d {config.reward_duration_hours % 24}h</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tracking Mode</span>
            <span className="text-white/70">{config.tracking_mode === "daily_decay" ? "Daily Decay" : "Fixed Reset"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Time Window</span>
            <span className="text-white/70">{config.seeding_window_enabled ? `${config.seeding_window_start} - ${config.seeding_window_end}` : "24/7"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tiered Rewards</span>
            <span className="text-white/70">{config.reward_tiers ? `${config.reward_tiers.length} tiers` : "Single tier"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Discord Link</span>
            <span className="text-white/70">{config.require_discord_link ? "Required" : "Not required"}</span>
          </div>
        </div>
        <div className="pt-1">
          <Link href="/dashboard/seeding/settings" className="text-xs flex items-center gap-1 hover:underline" style={{ color: "var(--accent-primary)" }}>
            <Settings2 className="h-3 w-3" /> Edit Configuration
          </Link>
        </div>
      </div>

      {/* Whitelist info */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.01] px-4 py-2 flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground">
          Seeding rewards added to main whitelist — Group: <code className="bg-white/[0.06] px-1 rounded">SeedReserve:reserve</code>
        </div>
        <Badge variant="secondary" className="text-[9px]">Reserve only</Badge>
      </div>
    </div>
  );
}
