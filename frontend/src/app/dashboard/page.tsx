"use client";

import {
  Users,
  Hash,
  Shield,
  PanelTop,
  RefreshCw,
  Settings2,
  AlertTriangle,
  Info,
  UserX,
  Sprout,
  Gift,
  TrendingUp,
  ArrowRight,
  Flame,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useStats, useHealth, useAudit, useWhitelists, usePanels, useSettings, useRoleStats, useDuplicateIdCount, useSeedingConfig, useSeedingStats, useGuildInfo } from "@/hooks/use-settings";
import { api } from "@/lib/api";
import { StatCard } from "@/components/stats/stat-card";
import { SetupGuide } from "@/components/setup-guide";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: "Discord login was cancelled or denied.",
  oauth_failed: "Discord authentication failed. Please try again.",
};

export default function DashboardPage() {
  const searchParams = useSearchParams();
  const oauthError = searchParams.get("error");

  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: health, isLoading: healthLoading } = useHealth();
  const { data: audit, isLoading: auditLoading } = useAudit(1, 10);
  const { data: whitelists } = useWhitelists();
  const { data: panels } = usePanels();
  const { data: settingsData } = useSettings();
  const { data: roleStats } = useRoleStats();
  const { data: dupData } = useDuplicateIdCount();
  const { data: seedingConfigData } = useSeedingConfig();
  const { data: seedingStats } = useSeedingStats();
  const { data: guildInfo } = useGuildInfo();

  const seedingConfig = seedingConfigData?.config ?? null;
  const whitelistCount = whitelists?.filter((w) => w.enabled).length ?? 0;
  const panelCount = panels?.length ?? 0;

  // Setup guide state
  const hasWhitelistEnabled = whitelists?.some((w) => w.enabled) ?? false;
  const hasWhitelistRoles = (roleStats?.stats?.length ?? 0) > 0;
  const hasPanelChannel = panels?.some((p) => p.channel_id) ?? false;

  async function handleResync() {
    try {
      await api.post("/api/admin/resync");
      toast.success("Resync triggered successfully");
    } catch {
      toast.error("Failed to trigger resync");
    }
  }

  return (
    <div className="space-y-6">
      {/* OAuth error banner */}
      {oauthError && OAUTH_ERRORS[oauthError] && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-300">{OAUTH_ERRORS[oauthError]}</p>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Users"
          value={stats?.total_active_users}
          icon={Users}
          loading={statsLoading}
        />
        <StatCard
          label="Active IDs"
          value={stats?.total_identifiers}
          icon={Hash}
          loading={statsLoading}
        />
        <StatCard
          label="Whitelists"
          value={whitelistCount}
          icon={Shield}
          loading={statsLoading}
        />
        <StatCard
          label="Panels"
          value={panelCount}
          icon={PanelTop}
          loading={statsLoading}
        />
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleResync}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Resync
        </Button>
        <Link href="/dashboard/config?tab=panels">
          <Button variant="outline" size="sm">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Manage Panels
          </Button>
        </Link>
      </div>

      {/* System Overview + Health */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* System Overview */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>System Overview</CardTitle>
            <CardDescription>Submissions last 7 days · whitelist breakdown · issues</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
              </div>
            ) : (
              <>
                {/* Daily submissions bar chart */}
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Submissions — Last 7 Days
                  </p>
                  {stats?.daily_submissions && stats.daily_submissions.length > 0 ? (() => {
                    const max = Math.max(...stats.daily_submissions.map((d) => d.count), 1);
                    return (
                      <div className="flex h-24 items-end gap-1.5">
                        {stats.daily_submissions.map((d) => (
                          <div key={d.date} className="group flex flex-1 flex-col items-center gap-1">
                            <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                              {d.count}
                            </span>
                            <div
                              className="w-full rounded-t-sm transition-all"
                              style={{
                                height: `${Math.max((d.count / max) * 72, d.count > 0 ? 4 : 2)}px`,
                                background: d.count > 0
                                  ? `linear-gradient(180deg, var(--accent-primary) 0%, color-mix(in srgb, var(--accent-primary) 60%, transparent) 100%)`
                                  : "rgba(255,255,255,0.06)",
                              }}
                            />
                            <span className="text-[10px] text-muted-foreground">{d.day}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })() : (
                    <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-white/[0.08] text-xs text-muted-foreground">
                      No submissions in the last 7 days
                    </div>
                  )}
                </div>

                {/* Per-whitelist breakdown */}
                {stats?.per_type && Object.keys(stats.per_type).length > 0 && (
                  <div>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Whitelist Breakdown
                    </p>
                    <div className="space-y-3">
                      {Object.entries(stats.per_type).map(([slug, s]) => {
                        const slotPct = s.capacity > 0 ? Math.min((s.slots_used / s.capacity) * 100, 100) : null;
                        const slotColor = slotPct === null ? "var(--accent-primary)"
                          : slotPct >= 90 ? "#f87171"
                          : slotPct >= 70 ? "#fbbf24"
                          : "var(--accent-primary)";
                        return (
                          <div key={slug} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-white/70 capitalize font-medium">{slug.replace(/-/g, " ")}</span>
                              <span className="text-muted-foreground">
                                {s.active_users} users · {s.total_ids} IDs
                                {s.capacity > 0 && (
                                  <span className="ml-2" style={{ color: slotColor }}>
                                    {s.slots_used}/{s.capacity} slots
                                  </span>
                                )}
                              </span>
                            </div>
                            <div className="relative h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full transition-all"
                                style={{
                                  width: `${Math.min((s.active_users / Math.max(stats.total_active_users, 1)) * 100, 100)}%`,
                                  background: "var(--accent-primary)",
                                }}
                              />
                            </div>
                            {s.capacity > 0 && (
                              <div className="relative h-1 rounded-full bg-white/[0.04] overflow-hidden">
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full transition-all"
                                  style={{ width: `${slotPct}%`, background: slotColor }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Orphan warning */}
                {(stats?.orphan_count ?? 0) > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-sm text-amber-400">
                    <UserX className="h-4 w-4 shrink-0" />
                    <span>
                      <span className="font-semibold">{stats!.orphan_count}</span> unlinked{" "}
                      {stats!.orphan_count === 1 ? "entry" : "entries"} — imported but no Discord account matched.{" "}
                      <Link href="/dashboard/users" className="underline underline-offset-2 hover:text-amber-300">
                        View in Roster
                      </Link>
                    </span>
                  </div>
                )}

                {/* Steam ID conflicts */}
                {(dupData?.count ?? 0) > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2 text-sm text-red-400">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>
                      <span className="font-semibold">{dupData!.count}</span> Steam ID{" "}
                      {dupData!.count === 1 ? "conflict" : "conflicts"} — duplicate IDs registered to multiple users.{" "}
                      <Link href="/dashboard/conflicts" className="underline underline-offset-2 hover:text-red-300">
                        Resolve
                      </Link>
                    </span>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Right column: Health + Discord */}
        <div className="space-y-6">
          {/* Health Status */}
          <Card>
            <CardHeader>
              <CardTitle>Health Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {healthLoading ? (
                <>
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </>
              ) : health?.alerts?.length ? (
                <div className="space-y-2">
                  {health.alerts.map((alert, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                        alert.level === "warning"
                          ? "border-amber-800 bg-amber-950/30 text-amber-400"
                          : alert.level === "error"
                          ? "border-red-800 bg-red-950/30 text-red-400"
                          : "border-blue-800 bg-blue-950/30 text-blue-400"
                      )}
                    >
                      {alert.level === "warning" ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      ) : (
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                      )}
                      <span>{alert.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--accent-primary)" }}>
                  <Shield className="h-4 w-4" />
                  All systems healthy — no alerts
                </div>
              )}
            </CardContent>
          </Card>

          {/* Discord Server Stats */}
          {guildInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
                  Discord Server
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Members</p>
                    <p className="text-lg font-bold text-white/90">
                      {guildInfo.member_count.toLocaleString()}
                    </p>
                    {guildInfo.online_count > 0 && (
                      <p className="text-[10px] text-emerald-400">{guildInfo.online_count.toLocaleString()} online</p>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Boost Level</p>
                    <p className="text-lg font-bold text-white/90">
                      {guildInfo.boost_level > 0 ? `Tier ${guildInfo.boost_level}` : "None"}
                    </p>
                    {guildInfo.booster_count > 0 && (
                      <p className="text-[10px] text-pink-400">{guildInfo.booster_count} booster{guildInfo.booster_count !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/[0.06]">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{guildInfo.role_count} roles</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Seeding Stats — only if seeding is configured */}
      {seedingConfig && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sprout className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
                Seeding
              </CardTitle>
              <CardDescription>Live seeding activity</CardDescription>
            </div>
            <Link href="/dashboard/seeding">
              <Button variant="ghost" size="sm" className="text-muted-foreground">
                Details <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Active Seeders</p>
                <p className="text-2xl font-bold text-white/90">{seedingStats?.total_seeders ?? 0}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Rewards Given</p>
                <p className="text-2xl font-bold text-white/90">{seedingStats?.total_rewarded ?? 0}</p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Total Hours</p>
                <p className="text-2xl font-bold text-white/90">{seedingStats?.total_seeding_hours ?? 0}h</p>
              </div>
            </div>
            {/* Active bonus indicators */}
            {(seedingConfig.bonus_multiplier_enabled || seedingConfig.streak_enabled) && (
              <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-white/[0.06]">
                {seedingConfig.bonus_multiplier_enabled && (
                  <div className="flex items-center gap-1.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-xs">
                    <Flame className="h-3 w-3 text-amber-400" />
                    <span className="text-amber-300 font-medium">{seedingConfig.bonus_multiplier_value}x Points</span>
                  </div>
                )}
                {seedingConfig.streak_enabled && (
                  <div className="flex items-center gap-1.5 rounded-md border border-violet-500/20 bg-violet-500/5 px-2.5 py-1 text-xs">
                    <Zap className="h-3 w-3 text-violet-400" />
                    <span className="text-violet-300 font-medium">{seedingConfig.streak_multiplier}x after {seedingConfig.streak_days_required}d</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Recent Audit */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest 10 audit entries</CardDescription>
          </div>
          <Link href="/dashboard/logs">
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              View All
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : audit?.entries?.length ? (
            <div className="space-y-2">
              {audit.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.10] px-3 py-2 text-sm"
                >
                  <Badge variant="secondary" className="shrink-0">
                    {entry.action_type}
                  </Badge>
                  <span className="flex-1 truncate text-muted-foreground">
                    {entry.details ?? "No details"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No audit entries yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Setup guide — fixed bottom popup, shown until dismissed or fully configured */}
      <SetupGuide
        hasWhitelistEnabled={hasWhitelistEnabled}
        hasWhitelistRoles={hasWhitelistRoles}
        hasPanelChannel={hasPanelChannel}
      />
    </div>
  );
}
