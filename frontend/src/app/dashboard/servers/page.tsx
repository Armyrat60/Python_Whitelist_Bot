"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Radio,
  Users,
  MapPin,
  Megaphone,
  AlertTriangle,
  UserX,
  MessageSquareWarning,
  Loader2,
  ChevronDown,
  ChevronRight,
  Lock,
  ChevronsUp,
  Crown,
  ArrowLeftRight,
  UserMinus,
  ExternalLink,
  Search,
  RefreshCw,
  Gamepad2,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  useGameServers,
  useRconPlayers,
  useKickPlayer,
  useWarnPlayer,
  useBroadcast,
  useForceTeamChange,
  useRemoveFromSquad,
  useDisbandSquad,
  useDemoteCommander,
  type RconServerState,
  type RconPlayer,
} from "@/hooks/use-settings";
import { useHasPermission } from "@/hooks/use-session";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ─── Kit/Role Display ───────────────────────────────────────────────────────

const KIT_MAP: Record<string, string> = {
  SL: "Squad Leader", YOURSL: "Squad Leader",
  FTL: "Fireteam Leader",
  YOURCOMMANDER: "Commander", CMD: "Commander",
  MG: "Machine Gunner", AR: "Auto Rifleman",
  GL: "Grenadier", LAT: "Light Anti-Tank", HAT: "Heavy Anti-Tank",
  MEDIC: "Medic", MED: "Medic",
  MARKSMAN: "Marksman", SNIPER: "Sniper",
  ENGINEER: "Engineer", SAPPER: "Sapper", CE: "Combat Engineer",
  PILOT: "Pilot", CREWMAN: "Crewman", CREW: "Crewman",
  RIFLEMAN: "Rifleman",
  RAIDER: "Raider", SCOUT: "Scout",
}

function parseKit(role: string): string {
  if (!role) return ""
  // Role format: FACTION_KIT_NUMBER e.g. CAF_SL_05, PLA_Rifleman_01
  const parts = role.split("_")
  if (parts.length < 2) return role
  // Try the second part (kit name)
  const kitRaw = parts[1].toUpperCase()
  return KIT_MAP[kitRaw] ?? (parts.slice(1, -1).join(" ").replace(/^\w/, c => c.toUpperCase()) || role)
}

// ─── Faction Colors ─────────────────────────────────────────────────────────

// Team colors: based on typical Squad team assignments (Team 1 = blue-ish, Team 2 = red-ish)
// Individual faction colors just for the team header badge
const FACTION_COLORS: Record<string, string> = {
  USA: "#3b82f6", USMC: "#2563eb",
  RUS: "#3b82f6", RGF: "#3b82f6", VDV: "#3b82f6",
  CAF: "#84cc16",
  GB: "#1e40af", BAF: "#1e40af",
  MEA: "#f59e0b",
  INS: "#a16207", MIL: "#65a30d", IMF: "#65a30d",
  AUS: "#16a34a", ADF: "#16a34a",
  TLF: "#ef4444",
  PLA: "#ef4444", PLANMC: "#b91c1c",
  WPMC: "#8b5cf6",
};

// ─── Player Action Menu ─────────────────────────────────────────────────────

function PlayerActionMenu({ serverId, player, canExecute }: { serverId: number; player: RconPlayer; canExecute: boolean }) {
  const kick = useKickPlayer();
  const warn = useWarnPlayer();
  const forceTeam = useForceTeamChange();
  const removeSquad = useRemoveFromSquad();
  const [mode, setMode] = useState<"idle" | "kick" | "warn">("idle");
  const [inputVal, setInputVal] = useState("");

  async function handleKick() {
    try {
      await kick.mutateAsync({ serverId, player_id: player.id, player_name: player.name, reason: inputVal || "Kicked by admin" });
      toast.success(`Kicked ${player.name}`);
      setMode("idle"); setInputVal("");
    } catch { toast.error("Kick failed"); }
  }

  async function handleWarn() {
    if (!inputVal.trim()) { toast.error("Message required"); return; }
    try {
      await warn.mutateAsync({ serverId, target: player.steamId, player_name: player.name, message: inputVal });
      toast.success(`Warned ${player.name}`);
      setMode("idle"); setInputVal("");
    } catch { toast.error("Warn failed"); }
  }

  if (mode !== "idle") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Input value={inputVal} onChange={(e) => setInputVal(e.target.value)}
          placeholder={mode === "kick" ? "Reason..." : "Warning message..."}
          className="h-6 w-36 text-[10px]" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") mode === "kick" ? handleKick() : handleWarn(); if (e.key === "Escape") { setMode("idle"); setInputVal(""); } }}
        />
        <Button size="sm" variant="ghost" className={`h-6 px-1.5 text-[10px] ${mode === "kick" ? "text-red-400" : "text-amber-400"}`}
          onClick={mode === "kick" ? handleKick : handleWarn} disabled={kick.isPending || warn.isPending}>
          {(kick.isPending || warn.isPending) ? <Loader2 className="h-3 w-3 animate-spin" /> : mode === "kick" ? "Kick" : "Warn"}
        </Button>
        <button onClick={() => { setMode("idle"); setInputVal(""); }} className="text-muted-foreground/50 text-xs px-1">x</button>
      </div>
    );
  }

  if (!canExecute) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-white hover:bg-white/[0.08] transition-colors border border-white/[0.08] bg-white/[0.03]" />}>
        Actions <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="start">
        <DropdownMenuItem onClick={() => setMode("warn")}>
          <MessageSquareWarning className="h-3.5 w-3.5 mr-2 text-amber-400" /> Warn
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setMode("kick")} className="text-red-400">
          <UserX className="h-3.5 w-3.5 mr-2" /> Kick
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={async () => {
          try { await forceTeam.mutateAsync({ serverId, player_id: player.id, player_name: player.name }); toast.success(`Moved ${player.name}`); } catch { toast.error("Failed"); }
        }}>
          <ArrowLeftRight className="h-3.5 w-3.5 mr-2" /> Force Team Change
        </DropdownMenuItem>
        <DropdownMenuItem onClick={async () => {
          try { await removeSquad.mutateAsync({ serverId, player_id: player.id, player_name: player.name }); toast.success(`Removed ${player.name} from squad`); } catch { toast.error("Failed"); }
        }}>
          <UserMinus className="h-3.5 w-3.5 mr-2" /> Remove from Squad
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open(`https://www.battlemetrics.com/rcon/players?filter[search]=${player.steamId}`, "_blank")}>
          <ExternalLink className="h-3.5 w-3.5 mr-2" /> BattleMetrics
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Squad Card ─────────────────────────────────────────────────────────────

function SquadCard({
  squad, serverId, canExecute, searchQuery,
}: {
  squad: RconServerState["teams"][number]["squads"][number];
  serverId: number; canExecute: boolean; searchQuery: string;
}) {
  const [expanded, setExpanded] = useState(true);
  const disband = useDisbandSquad();

  const filteredPlayers = searchQuery
    ? squad.players.filter((p) => p.name.toLowerCase().includes(searchQuery))
    : squad.players;

  if (searchQuery && filteredPlayers.length === 0) return null;

  return (
    <div className="rounded-lg border border-white/[0.06] overflow-hidden">
      {/* Squad header — colored accent bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
        style={{ borderLeft: "3px solid rgba(255,255,255,0.15)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
          <span className="text-sm font-semibold text-white/90">
            {squad.id}. {squad.name}
          </span>
          {squad.locked && <span title="Locked"><Lock className="h-3.5 w-3.5 text-amber-400/80 shrink-0" /></span>}
          <span className="text-[10px] text-muted-foreground/50">{filteredPlayers.length}/{squad.size}</span>
        </div>
        <span className="text-[11px] text-muted-foreground/60 truncate ml-2">
          {squad.leader}
        </span>
      </button>

      {expanded && (
        <div className="bg-white/[0.01]">
          {filteredPlayers.map((player) => {
            const kit = parseKit(player.role);
            return (
              <div key={player.id} className="flex items-center gap-2 py-1 px-3 border-t border-white/[0.03] hover:bg-white/[0.025]">
                {/* Action button — left side like BM */}
                <PlayerActionMenu serverId={serverId} player={player} canExecute={canExecute} />
                {/* Role icon */}
                {player.role.toUpperCase().includes("COMMANDER") || player.role.toUpperCase().includes("CMD") ? (
                  <span title="Commander"><Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>
                ) : player.isLeader ? (
                  <span title="Squad Leader"><ChevronsUp className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className={`text-xs truncate ${player.isLeader ? "text-white font-medium" : "text-white/70"}`}>
                  {player.name}
                </span>
                {kit && (
                  <span className="text-[10px] text-muted-foreground/40 truncate hidden sm:inline ml-auto">
                    {kit}
                  </span>
                )}
              </div>
            );
          })}
          {filteredPlayers.length === 0 && (
            <p className="text-[10px] text-muted-foreground/30 py-2 px-3">Empty</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Team Column ────────────────────────────────────────────────────────────

function TeamColumn({
  team, serverId, canExecute, searchQuery,
}: {
  team: RconServerState["teams"][number];
  serverId: number; canExecute: boolean; searchQuery: string;
}) {
  const totalPlayers = team.squads.reduce((sum, s) => sum + s.players.length, 0) + team.unassigned.length;
  const factionColor = FACTION_COLORS[team.factionTag] ?? (team.teamId === "1" ? "#60a5fa" : "#f87171");
  const teamLabel = team.factionName || `Team ${team.teamId}`;

  const filteredUnassigned = searchQuery
    ? team.unassigned.filter((p) => p.name.toLowerCase().includes(searchQuery))
    : team.unassigned;

  return (
    <div className="space-y-2">
      {/* Team header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 font-bold text-sm text-white" style={{ backgroundColor: factionColor }}>
          {team.teamId}
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white/90 truncate">{teamLabel}</h3>
          <p className="text-[10px] text-muted-foreground/50">{totalPlayers} players · {team.squads.length} squads</p>
        </div>
      </div>

      {/* Squads */}
      {team.squads.map((squad) => (
        <SquadCard key={`${squad.teamId}-${squad.id}`} squad={squad} serverId={serverId} canExecute={canExecute} searchQuery={searchQuery} />
      ))}

      {/* Unassigned */}
      {filteredUnassigned.length > 0 && (
        <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground/40 mb-1">Unassigned</p>
          {filteredUnassigned.map((player) => (
            <div key={player.id} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-3.5 shrink-0" />
                <span className="text-xs text-white/60 truncate">{player.name}</span>
              </div>
              <PlayerActionMenu serverId={serverId} player={player} canExecute={canExecute} />
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
  const queryClient = useQueryClient();

  const servers = serversData?.servers?.filter((s) => s.enabled && s.rcon_host) ?? [];
  const [selectedServerId, setSelectedServerId] = useState<number | null>(null);
  const activeServerId = selectedServerId ?? servers[0]?.id ?? null;
  const { data: serverState, isLoading: stateLoading } = useRconPlayers(activeServerId);

  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearch = searchQuery.toLowerCase().trim();

  async function handleBroadcast() {
    if (!activeServerId || !broadcastMsg.trim()) return;
    try {
      await bcast.mutateAsync({ serverId: activeServerId, message: broadcastMsg.trim() });
      toast.success("Broadcast sent");
      setBroadcastMsg("");
    } catch { toast.error("Broadcast failed"); }
  }

  if (serversLoading) {
    return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>;
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
            <a href="/dashboard/settings?tab=connections" className="text-xs underline" style={{ color: "var(--accent-primary)" }}>Settings → Connections</a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Radio className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          <h1 className="text-xl font-bold text-white/90">Live Server</h1>
        </div>
        <div className="flex items-center gap-2">
          {servers.length > 1 && (
            <select value={activeServerId ?? ""} onChange={(e) => setSelectedServerId(parseInt(e.target.value, 10))}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30" style={{ colorScheme: "dark" }}>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["rcon-players", activeServerId] })}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Server Info */}
      {serverState?.info && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-white/80 font-medium">{serverState.info.name}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />{serverState.info.map}
          </div>
          {serverState.info.gameMode && (
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Gamepad2 className="h-3.5 w-3.5" />{serverState.info.gameMode}
            </div>
          )}
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users className="h-3.5 w-3.5" />{serverState.totalPlayers}/{serverState.info.maxPlayers}
          </div>
          {serverState.responseTime !== undefined && (
            <span className="text-[10px] text-muted-foreground/40 ml-auto">{serverState.responseTime}ms</span>
          )}
        </div>
      )}

      {/* Search + Broadcast */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search players..." className="h-8 text-xs pl-8" />
          {searchQuery && <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-white/70 text-xs">x</button>}
        </div>
        {canExecute && (
          <>
            <Input value={broadcastMsg} onChange={(e) => setBroadcastMsg(e.target.value)} placeholder="Broadcast..."
              className="h-8 text-xs flex-1 max-w-xs" onKeyDown={(e) => e.key === "Enter" && handleBroadcast()} />
            <Button size="sm" variant="outline" onClick={handleBroadcast} disabled={bcast.isPending || !broadcastMsg.trim()} className="h-8">
              {bcast.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Megaphone className="h-3.5 w-3.5" />}
            </Button>
          </>
        )}
      </div>

      {/* Error */}
      {serverState?.error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{serverState.error}</p>
        </div>
      )}

      {/* Loading */}
      {stateLoading && !serverState && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>
      )}

      {/* Teams */}
      {serverState && !serverState.error && serverState.teams.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {serverState.teams.map((team) => (
            <TeamColumn key={team.teamId} team={team} serverId={activeServerId!} canExecute={canExecute} searchQuery={normalizedSearch} />
          ))}
        </div>
      )}

      {/* Empty */}
      {serverState && !serverState.error && serverState.totalPlayers === 0 && !stateLoading && (
        <Card><CardContent className="flex flex-col items-center gap-2 py-12">
          <Users className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No players online</p>
        </CardContent></Card>
      )}

      <p className="text-[10px] text-muted-foreground/30 text-center">Auto-refreshes every 5 seconds</p>
    </div>
  );
}
