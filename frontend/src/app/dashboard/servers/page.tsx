"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Radio,
  Users,
  Shield,
  MapPin,
  Megaphone,
  AlertTriangle,
  UserX,
  MessageSquareWarning,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  useGameServers,
  useRconPlayers,
  useKickPlayer,
  useWarnPlayer,
  useBroadcast,
  type RconServerState,
} from "@/hooks/use-settings";
import { useHasPermission } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";

// ─── Player Action Buttons ──────────────────────────────────────────────────

function PlayerActions({
  serverId,
  playerId,
  steamId,
  playerName,
}: {
  serverId: number;
  playerId: string;
  steamId: string;
  playerName: string;
}) {
  const kick = useKickPlayer();
  const warn = useWarnPlayer();
  const [showKick, setShowKick] = useState(false);
  const [showWarn, setShowWarn] = useState(false);
  const [reason, setReason] = useState("");
  const [warnMsg, setWarnMsg] = useState("");

  async function handleKick() {
    try {
      await kick.mutateAsync({ serverId, player_id: playerId, reason: reason || "Kicked by admin" });
      toast.success(`Kicked ${playerName}`);
      setShowKick(false);
      setReason("");
    } catch { toast.error("Kick failed"); }
  }

  async function handleWarn() {
    if (!warnMsg.trim()) return;
    try {
      await warn.mutateAsync({ serverId, target: steamId, message: warnMsg });
      toast.success(`Warned ${playerName}`);
      setShowWarn(false);
      setWarnMsg("");
    } catch { toast.error("Warn failed"); }
  }

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      {!showKick && !showWarn && (
        <>
          <button onClick={() => setShowWarn(true)} title="Warn" className="rounded p-1 text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 transition-colors">
            <MessageSquareWarning className="h-3 w-3" />
          </button>
          <button onClick={() => setShowKick(true)} title="Kick" className="rounded p-1 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <UserX className="h-3 w-3" />
          </button>
        </>
      )}
      {showKick && (
        <div className="flex items-center gap-1">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="h-6 w-28 text-[10px]" onKeyDown={(e) => e.key === "Enter" && handleKick()} />
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-red-400" onClick={handleKick} disabled={kick.isPending}>
            {kick.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Kick"}
          </Button>
          <button onClick={() => setShowKick(false)} className="text-muted-foreground text-[10px]">x</button>
        </div>
      )}
      {showWarn && (
        <div className="flex items-center gap-1">
          <Input value={warnMsg} onChange={(e) => setWarnMsg(e.target.value)} placeholder="Warning message" className="h-6 w-36 text-[10px]" onKeyDown={(e) => e.key === "Enter" && handleWarn()} />
          <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-amber-400" onClick={handleWarn} disabled={warn.isPending}>
            {warn.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Warn"}
          </Button>
          <button onClick={() => setShowWarn(false)} className="text-muted-foreground text-[10px]">x</button>
        </div>
      )}
    </div>
  );
}

// ─── Squad Card ─────────────────────────────────────────────────────────────

function SquadCard({
  squad,
  serverId,
  canExecute,
}: {
  squad: { id: string; name: string; size: number; leader: string; players: Array<{ id: string; steamId: string; name: string }> };
  serverId: number;
  canExecute: boolean;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span className="text-xs font-medium text-white/80">{squad.name}</span>
          <Badge variant="secondary" className="text-[9px]">{squad.players.length}</Badge>
        </div>
        <span className="text-[10px] text-muted-foreground">SL: {squad.leader}</span>
      </button>
      {expanded && (
        <div className="border-t border-white/[0.04] px-3 py-1.5 space-y-0.5">
          {squad.players.map((player) => (
            <div key={player.id} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-muted-foreground/50 w-4 text-right shrink-0">{player.id}</span>
                <span className="text-xs text-white/80 truncate">{player.name}</span>
              </div>
              {canExecute && (
                <PlayerActions serverId={serverId} playerId={player.id} steamId={player.steamId} playerName={player.name} />
              )}
            </div>
          ))}
          {squad.players.length === 0 && (
            <p className="text-[10px] text-muted-foreground/50 py-1">Empty squad</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Team Column ────────────────────────────────────────────────────────────

function TeamColumn({
  team,
  teamLabel,
  serverId,
  canExecute,
}: {
  team: RconServerState["teams"][number];
  teamLabel: string;
  serverId: number;
  canExecute: boolean;
}) {
  const totalPlayers = team.squads.reduce((sum, s) => sum + s.players.length, 0) + team.unassigned.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Shield className="h-4 w-4" style={{ color: team.teamId === "1" ? "#60a5fa" : "#f87171" }} />
        <h3 className="text-sm font-semibold text-white/80">{teamLabel}</h3>
        <Badge variant="secondary" className="text-[9px]">{totalPlayers} players</Badge>
      </div>

      {team.squads.map((squad) => (
        <SquadCard key={`${squad.teamId}-${squad.id}`} squad={squad} serverId={serverId} canExecute={canExecute} />
      ))}

      {team.unassigned.length > 0 && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground mb-1">Unassigned</p>
          {team.unassigned.map((player) => (
            <div key={player.id} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] text-muted-foreground/50 w-4 text-right shrink-0">{player.id}</span>
                <span className="text-xs text-white/80 truncate">{player.name}</span>
              </div>
              {canExecute && (
                <PlayerActions serverId={serverId} playerId={player.id} steamId={player.steamId} playerName={player.name} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function LiveServerPage() {
  const { data: serversData, isLoading: serversLoading } = useGameServers();
  const canExecute = useHasPermission("rcon_execute");
  const bcast = useBroadcast();

  const servers = serversData?.servers?.filter((s) => s.enabled && (s.rcon_host || s.sftp_host)) ?? [];
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);

  // Auto-select first server
  const activeServerId = selectedServerId ?? servers[0]?.id ?? null;
  const { data: serverState, isLoading: stateLoading } = useRconPlayers(activeServerId);

  const [broadcastMsg, setBroadcastMsg] = useState("");

  async function handleBroadcast() {
    if (!activeServerId || !broadcastMsg.trim()) return;
    try {
      await bcast.mutateAsync({ serverId: activeServerId, message: broadcastMsg.trim() });
      toast.success("Broadcast sent");
      setBroadcastMsg("");
    } catch { toast.error("Broadcast failed"); }
  }

  if (serversLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          <h1 className="text-xl font-bold text-white/90">Live Server</h1>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Radio className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No game servers configured with RCON.</p>
            <p className="text-xs text-muted-foreground">
              Add a server with RCON credentials in{" "}
              <a href="/dashboard/settings?tab=connections" className="underline hover:text-white/80" style={{ color: "var(--accent-primary)" }}>
                Settings → Connections
              </a>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasRcon = servers.find((s) => s.id === activeServerId)?.rcon_host;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          <h1 className="text-xl font-bold text-white/90">Live Server</h1>
          {serverState?.info && (
            <Badge variant="secondary" className="text-[10px]">
              {serverState.totalPlayers}/{serverState.info.maxPlayers}
            </Badge>
          )}
        </div>

        {servers.length > 1 && (
          <select
            value={activeServerId ?? ""}
            onChange={(e) => setSelectedServerId(parseInt(e.target.value, 10))}
            className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30"
            style={{ colorScheme: "dark" }}
          >
            {servers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Server Info Bar */}
      {serverState?.info && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/80 font-medium">{serverState.info.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            <span>{serverState.info.map}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>{serverState.totalPlayers}/{serverState.info.maxPlayers}</span>
          </div>
        </div>
      )}

      {/* Broadcast Bar */}
      {canExecute && hasRcon && (
        <div className="flex gap-2">
          <Input
            value={broadcastMsg}
            onChange={(e) => setBroadcastMsg(e.target.value)}
            placeholder="Type a broadcast message..."
            className="h-8 text-xs flex-1"
            onKeyDown={(e) => e.key === "Enter" && handleBroadcast()}
          />
          <Button size="sm" variant="outline" onClick={handleBroadcast} disabled={bcast.isPending || !broadcastMsg.trim()}>
            {bcast.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Megaphone className="mr-1 h-3.5 w-3.5" />}
            Broadcast
          </Button>
        </div>
      )}

      {/* No RCON configured */}
      {!hasRcon && (
        <Card>
          <CardContent className="flex items-center gap-2 py-6">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <p className="text-sm text-muted-foreground">
              RCON is not configured for this server. Add RCON host and password in{" "}
              <a href="/dashboard/settings?tab=connections" className="underline" style={{ color: "var(--accent-primary)" }}>Settings → Connections</a>.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {stateLoading && hasRcon && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      )}

      {/* Error */}
      {serverState?.error && (
        <Card>
          <CardContent className="flex items-center gap-2 py-6">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <p className="text-sm text-red-400">{serverState.error}</p>
          </CardContent>
        </Card>
      )}

      {/* Team Views */}
      {serverState && !serverState.error && serverState.teams.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {serverState.teams.map((team, idx) => (
            <TeamColumn
              key={team.teamId}
              team={team}
              teamLabel={idx === 0 ? "Team 1" : `Team ${team.teamId}`}
              serverId={activeServerId!}
              canExecute={canExecute}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {serverState && !serverState.error && serverState.teams.length === 0 && serverState.totalPlayers === 0 && hasRcon && !stateLoading && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12">
            <Users className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No players online</p>
          </CardContent>
        </Card>
      )}

      <p className="text-[10px] text-muted-foreground/50 text-center">Auto-refreshes every 15 seconds</p>
    </div>
  );
}
