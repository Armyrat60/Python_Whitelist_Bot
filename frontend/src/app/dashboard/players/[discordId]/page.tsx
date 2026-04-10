"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  User,
  Clock,
  Tag,
  ExternalLink,
  Shield,
  BookUser,
  AlertCircle,
  Gamepad2,
  BadgeCheck,
  TrendingUp,
  Sprout,
  Calendar,
  Flame,
} from "lucide-react";
import { usePlayerProfile, useBattleMetricsPlayer } from "@/hooks/use-settings";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

// ── Helpers ──────────────────────────────────────────────────────────────────

function computeStatus(status: string, expiresAt: string | null) {
  if (status === "inactive" || status === "deactivated") return "inactive";
  if (!expiresAt) return status === "active" ? "active" : "inactive";
  const msLeft = new Date(expiresAt).getTime() - Date.now();
  if (msLeft <= 0) return "expired";
  if (msLeft < 7 * 24 * 60 * 60 * 1000) return "expiring_soon";
  return "active";
}

function StatusBadge({ status, expiresAt }: { status: string; expiresAt: string | null }) {
  const s = computeStatus(status, expiresAt);
  if (s === "active") return <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">Active</Badge>;
  if (s === "expiring_soon") return <Badge className="bg-amber-500/15 text-amber-400 border border-amber-500/30"><Clock className="mr-1 h-3 w-3" />Expiring Soon</Badge>;
  if (s === "expired") return <Badge className="bg-red-500/15 text-red-400 border border-red-500/30">Expired</Badge>;
  return <Badge variant="secondary">Inactive</Badge>;
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatActionType(t: string) {
  return t.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlayerProfilePage() {
  const { discordId } = useParams<{ discordId: string }>();
  const { data: player, isLoading, error } = usePlayerProfile(discordId ?? null);
  const primarySteamId = player?.steam_ids?.[0] ?? null;
  const { data: bmData } = useBattleMetricsPlayer(primarySteamId);

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !player) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="mb-4 h-10 w-10 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Player not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">No player with this Discord ID exists in this guild.</p>
        <Link href="/dashboard/search" className={cn(buttonVariants({ variant: "outline" }), "mt-4")}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />Back to Search
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Back */}
      <Link href="/dashboard/search" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-muted-foreground -ml-2")}>
        <ArrowLeft className="mr-1.5 h-4 w-4" />Player Search
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <User className="h-7 w-7" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white/90">{player.discord_name}</h1>
            {player.is_verified && (
              <span title="Bridge Verified — Steam ID confirmed in-game" className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                <BadgeCheck className="h-5 w-5" />
                Verified
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">{player.discord_id}</p>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Member</span>
          </div>
          <p className="text-xl font-bold text-white/90">{player.stats.member_days}d</p>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <Shield className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Whitelists</span>
          </div>
          <p className="text-xl font-bold text-white/90">{player.stats.active_whitelists}<span className="text-sm text-muted-foreground">/{player.stats.total_whitelists}</span></p>
        </div>
        {player.seeding && (
          <>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Sprout className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Seeding</span>
              </div>
              <p className="text-xl font-bold text-white/90">{player.seeding.seeding_hours}h</p>
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-0.5">
              <div className="flex items-center gap-1.5">
                <Flame className="h-3 w-3 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Streak</span>
              </div>
              <p className="text-xl font-bold text-white/90">{player.seeding.current_streak}<span className="text-sm text-muted-foreground">d</span></p>
            </div>
          </>
        )}
      </div>

      {/* Identifiers */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Identifiers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {player.steam_ids.length === 0 && player.eos_ids.length === 0 && (
            <p className="text-sm text-muted-foreground">No identifiers on file.</p>
          )}
          {player.steam_ids.map((id) => {
            const verified = player.verified_steam_ids?.includes(id);
            return (
              <div key={id} className="flex items-center gap-3">
                <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 shrink-0">Steam64</Badge>
                <code className="text-xs text-white/70 flex-1">{id}</code>
                {verified && (
                  <span title="Confirmed in-game via SquadJS bridge" className="text-emerald-400">
                    <BadgeCheck className="h-3.5 w-3.5" />
                  </span>
                )}
                <a
                  href={`https://steamcommunity.com/profiles/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-white/80 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            );
          })}
          {player.eos_ids.map((id) => (
            <div key={id} className="flex items-center gap-3">
              <Badge variant="outline" className="text-blue-400 border-blue-500/30 shrink-0">EOS</Badge>
              <code className="text-xs text-white/70 flex-1 truncate">{id}</code>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* BattleMetrics hours */}
      {bmData?.player && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              BattleMetrics
              {bmData.player.online && (
                <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[9px]">Online</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Last 30 Days</p>
                <p className="text-xl font-bold text-white/90">{bmData.player.hours30d}h</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">All Time</p>
                <p className="text-xl font-bold text-white/90">{bmData.player.hoursAllTime}h</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">First Seen</p>
                <p className="text-sm text-white/70">
                  {bmData.player.firstSeen ? new Date(bmData.player.firstSeen).toLocaleDateString() : "—"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Last Seen</p>
                <p className="text-sm text-white/70">
                  {bmData.player.lastSeen ? new Date(bmData.player.lastSeen).toLocaleDateString() : "—"}
                </p>
              </div>
            </div>
            {(bmData.player.serverName || bmData.player.bmName) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 pt-3 border-t border-white/[0.06] text-xs text-muted-foreground">
                {bmData.player.serverName && <span>Server: <span className="text-white/70">{bmData.player.serverName}</span></span>}
                {bmData.player.bmName && <span>BM Name: <span className="text-white/70">{bmData.player.bmName}</span></span>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* SquadJS in-game names */}
      {player.squad_players && player.squad_players.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Gamepad2 className="h-4 w-4" />
              In-Game Names
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {player.squad_players.map((sp) => (
              <div key={sp.steam_id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/80 truncate">
                    {sp.last_seen_name ?? <span className="text-muted-foreground italic">Unknown</span>}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">{sp.steam_id}</p>
                </div>
                <div className="text-right shrink-0">
                  {sp.server_name && (
                    <p className="text-xs text-muted-foreground">{sp.server_name}</p>
                  )}
                  <p className="text-xs text-muted-foreground">{relativeTime(sp.last_seen_at)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Whitelist memberships */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Whitelist Memberships</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {player.memberships.length === 0 && (
            <p className="text-sm text-muted-foreground">No whitelist memberships.</p>
          )}
          {player.memberships.map((m, i) => (
            <div key={i}>
              {i > 0 && <Separator className="bg-white/[0.06] mb-3" />}
              <div className="flex flex-wrap items-start gap-2">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  {m.is_manual
                    ? <BookUser className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <Shield className="h-4 w-4 shrink-0 text-muted-foreground" />
                  }
                  <span className="font-medium text-sm text-white/80">{m.whitelist_name}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                    {m.is_manual ? "Manual" : "Discord"}
                  </Badge>
                </div>
                <StatusBadge status={m.status} expiresAt={m.expires_at} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 pl-6">
                {m.category_name && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Tag className="h-3 w-3" />{m.category_name}
                  </span>
                )}
                {m.expires_at && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(m.expires_at).toLocaleDateString()}
                  </span>
                )}
                {m.notes && (
                  <span className="text-xs text-muted-foreground italic">&ldquo;{m.notes}&rdquo;</span>
                )}
                <span className="text-xs text-muted-foreground">
                  Added {new Date(m.created_at).toLocaleDateString()}
                  {m.created_via ? ` via ${m.created_via.replace(/_/g, " ")}` : ""}
                </span>
                {m.role_gained_at && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--accent-primary)" }}>
                    Member for {Math.floor((Date.now() - new Date(m.role_gained_at).getTime()) / 86400000)}d
                  </span>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Audit history */}
      {player.audit_log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {player.audit_log.map((entry) => (
              <div key={entry.id} className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white/80">{formatActionType(entry.action_type)}</p>
                  {entry.details && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{entry.details}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{relativeTime(entry.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
