"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
  Copy,
  ChevronsDownUp,
  ChevronsUpDown,
  ShieldMinus,
  Trash2,
  Settings2,
  Map,
  SkipForward,
  Square,
  RotateCcw,
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
  useChangeLayer,
  useSetNextLayer,
  useEndMatch,
  useRestartMatch,
  useRconLayers,
  useRefreshLayers,
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
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";

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
  const parts = role.split("_")
  if (parts.length < 2) return role
  const kitRaw = parts[1].toUpperCase()
  return KIT_MAP[kitRaw] ?? (parts.slice(1, -1).join(" ").replace(/^\w/, c => c.toUpperCase()) || role)
}

function isCommanderRole(role: string): boolean {
  const upper = role.toUpperCase()
  return upper.includes("COMMANDER") || upper.includes("CMD")
}

function isCommandSquad(squad: RconServerState["teams"][number]["squads"][number]): boolean {
  return squad.name.toLowerCase() === "command" || squad.name.toLowerCase() === "cmd" ||
    squad.players.some(p => isCommanderRole(p.role))
}

/** Parse layer name like "Yehorivka_RAAS_v1" into { map, mode, version } */
function parseLayerName(layer: string): { map: string; mode: string; version: string; factions: string } {
  const parts = layer.split("_")
  if (parts.length < 2) return { map: layer, mode: "", version: "", factions: "" }

  // Known factions that appear in layer names
  const FACTION_TAGS = new Set(["CAF", "USA", "USMC", "RUS", "GB", "BAF", "MEA", "INS", "MIL", "AUS", "ADF", "PLA", "PLANMC", "TLF", "IMF", "WPMC"])
  const MODES = new Set(["RAAS", "AAS", "Invasion", "Insurgency", "TC", "Skirmish", "Seed", "Training", "Destruction"])

  let map = parts[0]
  let mode = ""
  let version = ""
  const factions: string[] = []

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p.match(/^v\d+$/i)) { version = p; continue }
    if (MODES.has(p)) { mode = p; continue }
    if (FACTION_TAGS.has(p.toUpperCase())) { factions.push(p); continue }
    // Could be part of map name or mode
    if (!mode) mode = p
  }

  return { map, mode, version, factions: factions.join(" vs ") }
}

// ─── Faction Colors (for badge text) ────────────────────────────────────────

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

// Team badge always: Team 1 = blue, Team 2 = red
const TEAM_COLORS: Record<string, string> = {
  "1": "#3b82f6",
  "2": "#ef4444",
};

// ─── Layer Search Picker ────────────────────────────────────────────────────

function LayerPicker({
  serverId, onSelect, onCancel,
}: {
  serverId: number;
  onSelect: (layer: string) => void;
  onCancel: () => void;
}) {
  const { data: layersData, isLoading } = useRconLayers(serverId);
  const refreshLayers = useRefreshLayers();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus() }, []);

  const filtered = useMemo(() => {
    if (!layersData?.layers) return [];
    const q = search.toLowerCase();
    return layersData.layers.filter(l => l.toLowerCase().includes(q));
  }, [layersData?.layers, search]);

  // Group by map name
  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const layer of filtered) {
      const { map } = parseLayerName(layer);
      if (!groups[map]) groups[map] = [];
      groups[map].push(layer);
    }
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="rounded-lg border border-white/[0.1] bg-[var(--bg-primary)] shadow-xl w-80 max-h-80 flex flex-col">
      <div className="flex items-center gap-2 p-2 border-b border-white/[0.06]">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search layers..."
          className="flex-1 bg-transparent text-xs text-white/90 outline-none placeholder:text-muted-foreground/40"
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && filtered.length === 1) onSelect(filtered[0]);
          }}
        />
        <button
          onClick={async () => {
            try {
              await refreshLayers.mutateAsync(serverId);
              queryClient.invalidateQueries({ queryKey: ["rcon-layers", serverId] });
              toast.success("Layers refreshed");
            } catch { toast.error("Failed to refresh layers"); }
          }}
          className="text-muted-foreground/50 hover:text-white/70 p-0.5"
          title="Refresh layers from server"
        >
          <RefreshCw className={`h-3 w-3 ${refreshLayers.isPending ? "animate-spin" : ""}`} />
        </button>
        <button onClick={onCancel} className="text-muted-foreground/50 hover:text-white/70 text-xs px-1">x</button>
      </div>
      <div className="overflow-y-auto flex-1 p-1">
        {isLoading && <p className="text-[10px] text-muted-foreground/40 p-2">Loading layers...</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="text-[10px] text-muted-foreground/40 p-2">
            {layersData?.layers?.length === 0 ? "No layers cached. Click refresh to fetch from server." : "No matching layers."}
          </p>
        )}
        {grouped.map(([mapName, layers]) => (
          <div key={mapName}>
            <p className="text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider px-2 pt-1.5 pb-0.5">{mapName}</p>
            {layers.map((layer) => {
              const { mode, version, factions } = parseLayerName(layer);
              return (
                <button
                  key={layer}
                  onClick={() => onSelect(layer)}
                  className="w-full text-left px-2 py-1 rounded text-xs text-white/70 hover:text-white hover:bg-white/[0.06] transition-colors flex items-center gap-2"
                >
                  <span className="truncate flex-1">{mode}{version ? ` ${version}` : ""}</span>
                  {factions && <span className="text-[9px] text-muted-foreground/40 shrink-0">{factions}</span>}
                </button>
              );
            })}
          </div>
        ))}
        {layersData?.fromCache && layersData.cachedAt && (
          <p className="text-[9px] text-muted-foreground/30 px-2 py-1 border-t border-white/[0.04]">
            Cached {new Date(layersData.cachedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Server Commands Dropdown ───────────────────────────────────────────────

function ServerCommandsMenu({ serverId }: { serverId: number }) {
  const changeLayerMut = useChangeLayer();
  const setNextLayerMut = useSetNextLayer();
  const endMatchMut = useEndMatch();
  const restartMatchMut = useRestartMatch();

  const [mode, setMode] = useState<"idle" | "change-map" | "set-next-map">("idle");
  const [confirm, setConfirm] = useState<{ action: "change-map" | "set-next-map" | "end-match" | "restart-match"; layer?: string } | null>(null);

  if (mode === "change-map" || mode === "set-next-map") {
    return (
      <LayerPicker
        serverId={serverId}
        onCancel={() => setMode("idle")}
        onSelect={(layer) => {
          setConfirm({ action: mode, layer });
          setMode("idle");
        }}
      />
    );
  }

  async function executeConfirmed() {
    if (!confirm) return;
    try {
      switch (confirm.action) {
        case "change-map":
          await changeLayerMut.mutateAsync({ serverId, layer: confirm.layer! });
          toast.success(`Changing map to ${confirm.layer}`);
          break;
        case "set-next-map":
          await setNextLayerMut.mutateAsync({ serverId, layer: confirm.layer! });
          toast.success(`Next map set to ${confirm.layer}`);
          break;
        case "end-match":
          await endMatchMut.mutateAsync({ serverId });
          toast.success("Match ended");
          break;
        case "restart-match":
          await restartMatchMut.mutateAsync({ serverId });
          toast.success("Match restarting");
          break;
      }
    } catch { toast.error("Command failed"); }
    setConfirm(null);
  }

  const confirmTitle = confirm?.action === "change-map" ? "Change Map"
    : confirm?.action === "set-next-map" ? "Set Next Map"
    : confirm?.action === "end-match" ? "End Match"
    : "Restart Match";

  const confirmDesc = confirm?.action === "change-map" ? `Change the map to ${confirm.layer}? This will end the current match immediately.`
    : confirm?.action === "set-next-map" ? `Set the next map to ${confirm.layer}? This takes effect after the current match ends.`
    : confirm?.action === "end-match" ? "End the current match? Players will be returned to staging."
    : "Restart the current match from the beginning?";

  const isPending = changeLayerMut.isPending || setNextLayerMut.isPending || endMatchMut.isPending || restartMatchMut.isPending;
  const isDestructive = confirm?.action === "end-match" || confirm?.action === "change-map";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <button className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-white hover:bg-white/[0.06] transition-colors border border-white/[0.08] bg-white/[0.02]">
            <Settings2 className="h-3.5 w-3.5" /> Server <ChevronDown className="h-3 w-3" />
          </button>
        } />
        <DropdownMenuContent side="bottom" align="end">
          <DropdownMenuItem onClick={() => setMode("change-map")}>
            <Map className="h-3.5 w-3.5 mr-2" /> Change Map
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setMode("set-next-map")}>
            <SkipForward className="h-3.5 w-3.5 mr-2" /> Set Next Map
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setConfirm({ action: "end-match" })} className="text-red-400">
            <Square className="h-3.5 w-3.5 mr-2" /> End Match
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setConfirm({ action: "restart-match" })} className="text-amber-400">
            <RotateCcw className="h-3.5 w-3.5 mr-2" /> Restart Match
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmation dialog */}
      <AlertDialog open={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDesc}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirm(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={executeConfirmed}
              disabled={isPending}
              className={isDestructive ? "bg-red-600 hover:bg-red-700" : ""}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              {confirmTitle}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Player Action Menu ─────────────────────────────────────────────────────

interface PlayerPerms {
  canWarn: boolean;
  canKick: boolean;
  canTeamChange: boolean;
  canDemote: boolean;
  hasAny: boolean;
}

function PlayerActionMenu({
  serverId, player, perms, teamId,
}: {
  serverId: number; player: RconPlayer; perms: PlayerPerms; teamId?: string;
}) {
  const kick = useKickPlayer();
  const warn = useWarnPlayer();
  const forceTeam = useForceTeamChange();
  const removeSquad = useRemoveFromSquad();
  const demoteCmd = useDemoteCommander();
  const [mode, setMode] = useState<"idle" | "kick" | "warn">("idle");
  const [inputVal, setInputVal] = useState("");
  const [confirmAction, setConfirmAction] = useState<"kick" | "demote" | "team-change" | null>(null);

  async function executeKick() {
    try {
      await kick.mutateAsync({ serverId, player_id: player.id, player_name: player.name, reason: inputVal || "Kicked by admin" });
      toast.success(`Kicked ${player.name}`);
      setMode("idle"); setInputVal(""); setConfirmAction(null);
    } catch { toast.error("Kick failed"); setConfirmAction(null); }
  }

  async function handleWarn() {
    if (!inputVal.trim()) { toast.error("Message required"); return; }
    try {
      await warn.mutateAsync({ serverId, target: player.steamId, player_name: player.name, message: inputVal });
      toast.success(`Warned ${player.name}`);
      setMode("idle"); setInputVal("");
    } catch { toast.error("Warn failed"); }
  }

  async function executeDemote() {
    if (!teamId) return;
    try {
      await demoteCmd.mutateAsync({ serverId, team_id: teamId });
      toast.success("Commander demoted");
    } catch { toast.error("Demote failed"); }
    setConfirmAction(null);
  }

  async function executeTeamChange() {
    try {
      await forceTeam.mutateAsync({ serverId, player_id: player.id, player_name: player.name });
      toast.success(`Moved ${player.name}`);
    } catch { toast.error("Failed"); }
    setConfirmAction(null);
  }

  if (mode !== "idle") {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <Input value={inputVal} onChange={(e) => setInputVal(e.target.value)}
          placeholder={mode === "kick" ? "Reason..." : "Warning message..."}
          className="h-6 w-36 text-[10px]" autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              if (mode === "kick") setConfirmAction("kick");
              else handleWarn();
            }
            if (e.key === "Escape") { setMode("idle"); setInputVal(""); }
          }}
        />
        <Button size="sm" variant="ghost" className={`h-6 px-1.5 text-[10px] ${mode === "kick" ? "text-red-400" : "text-amber-400"}`}
          onClick={() => { if (mode === "kick") setConfirmAction("kick"); else handleWarn(); }}
          disabled={kick.isPending || warn.isPending}>
          {(kick.isPending || warn.isPending) ? <Loader2 className="h-3 w-3 animate-spin" /> : mode === "kick" ? "Kick" : "Warn"}
        </Button>
        <button onClick={() => { setMode("idle"); setInputVal(""); }} className="text-muted-foreground/50 text-xs px-1">x</button>

        {/* Kick confirmation dialog */}
        <AlertDialog open={confirmAction === "kick"} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogTitle>Kick {player.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {inputVal ? `Reason: "${inputVal}"` : "No reason provided."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmAction(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={executeKick} disabled={kick.isPending} className="bg-red-600 hover:bg-red-700">
                {kick.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Kick
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (!perms.hasAny) return null;

  const showDemote = isCommanderRole(player.role) && teamId && perms.canDemote;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-white hover:bg-white/[0.08] transition-colors border border-white/[0.08] bg-white/[0.03]" />}>
          Actions <ChevronDown className="h-3 w-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="left" align="start">
          {perms.canWarn && (
            <DropdownMenuItem onClick={() => setMode("warn")}>
              <MessageSquareWarning className="h-3.5 w-3.5 mr-2 text-amber-400" /> Warn
            </DropdownMenuItem>
          )}
          {perms.canKick && (
            <DropdownMenuItem onClick={() => setMode("kick")} className="text-red-400">
              <UserX className="h-3.5 w-3.5 mr-2" /> Kick
            </DropdownMenuItem>
          )}
          {(perms.canWarn || perms.canKick) && perms.canTeamChange && <DropdownMenuSeparator />}
          {perms.canTeamChange && (
            <>
              <DropdownMenuItem onClick={() => setConfirmAction("team-change")}>
                <ArrowLeftRight className="h-3.5 w-3.5 mr-2" /> Force Team Change
              </DropdownMenuItem>
              <DropdownMenuItem onClick={async () => {
                try { await removeSquad.mutateAsync({ serverId, player_id: player.id, player_name: player.name }); toast.success(`Removed ${player.name} from squad`); } catch { toast.error("Failed"); }
              }}>
                <UserMinus className="h-3.5 w-3.5 mr-2" /> Remove from Squad
              </DropdownMenuItem>
            </>
          )}
          {showDemote && (
            <DropdownMenuItem onClick={() => setConfirmAction("demote")} className="text-amber-400">
              <ShieldMinus className="h-3.5 w-3.5 mr-2" /> Demote Commander
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(player.steamId); toast.success("Steam ID copied"); }}>
            <Copy className="h-3.5 w-3.5 mr-2" /> Copy Steam ID
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => window.open(`https://www.battlemetrics.com/rcon/players?filter[search]=${player.steamId}`, "_blank")}>
            <ExternalLink className="h-3.5 w-3.5 mr-2" /> BattleMetrics
          </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

      {/* Demote Commander confirmation */}
      <AlertDialog open={confirmAction === "demote"} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Demote Commander</AlertDialogTitle>
            <AlertDialogDescription>Demote the commander on Team {teamId}? They will lose commander abilities.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAction(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDemote} disabled={demoteCmd.isPending} className="bg-amber-600 hover:bg-amber-700">
              {demoteCmd.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Demote
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Force Team Change confirmation */}
      <AlertDialog open={confirmAction === "team-change"} onOpenChange={(open) => { if (!open) setConfirmAction(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Force Team Change</AlertDialogTitle>
            <AlertDialogDescription>Move {player.name} to the other team?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setConfirmAction(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeTeamChange} disabled={forceTeam.isPending}>
              {forceTeam.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Move
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Squad Card ─────────────────────────────────────────────────────────────

function SquadCard({
  squad, serverId, playerPerms, canTeamChange, searchQuery, teamId, forceExpanded,
}: {
  squad: RconServerState["teams"][number]["squads"][number];
  serverId: number; playerPerms: PlayerPerms; canTeamChange: boolean; searchQuery: string;
  teamId: string; forceExpanded?: boolean | null;
}) {
  const [localExpanded, setLocalExpanded] = useState(true);
  const expanded = forceExpanded ?? localExpanded;
  const disband = useDisbandSquad();

  const filteredPlayers = searchQuery
    ? squad.players.filter((p) => p.name.toLowerCase().includes(searchQuery))
    : squad.players;

  if (searchQuery && filteredPlayers.length === 0) return null;

  // Sort: squad leader first, then FTL, then rest
  const sortedPlayers = [...filteredPlayers].sort((a, b) => {
    if (a.isLeader && !b.isLeader) return -1;
    if (!a.isLeader && b.isLeader) return 1;
    const aFTL = a.role.toUpperCase().includes("FTL");
    const bFTL = b.role.toUpperCase().includes("FTL");
    if (aFTL && !bFTL) return -1;
    if (!aFTL && bFTL) return 1;
    return 0;
  });

  const isCmdSquad = isCommandSquad(squad);
  const teamColor = TEAM_COLORS[teamId] ?? "#60a5fa";

  return (
    <div className={`rounded-lg border overflow-hidden ${isCmdSquad ? "border-amber-500/30 bg-amber-500/[0.02]" : "border-white/[0.06]"}`}>
      {/* Squad header */}
      <button
        onClick={() => setLocalExpanded(!localExpanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-white/[0.03]"
        style={{ borderLeft: `3px solid ${isCmdSquad ? "#f59e0b" : teamColor}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {expanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
          {/* Squad number badge */}
          <span className="flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: `${teamColor}40`, color: teamColor }}>
            {squad.id}
          </span>
          <span className="text-sm font-semibold text-white/90">
            {squad.name}
          </span>
          {isCmdSquad && <span title="Command Squad"><Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>}
          {squad.locked && <span title="Locked"><Lock className="h-3.5 w-3.5 text-red-500 fill-red-500/30 shrink-0" /></span>}
          <span className="text-[10px] text-muted-foreground/50">{filteredPlayers.length}/{squad.size}</span>
        </div>
        <div className="flex items-center gap-2 ml-2">
          <span className="text-[11px] text-white/50 truncate">
            {squad.leader}
          </span>
          {canTeamChange && (
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <button
                  className="rounded p-0.5 text-muted-foreground/40 hover:text-red-400 hover:bg-white/[0.05] transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              } />
              <DropdownMenuContent side="left" align="start">
                <DropdownMenuItem
                  className="text-red-400"
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await disband.mutateAsync({ serverId, team_id: squad.teamId, squad_id: squad.id, squad_name: squad.name });
                      toast.success(`Disbanded ${squad.name}`);
                    } catch { toast.error("Disband failed"); }
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Confirm Disband
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </button>

      {expanded && (
        <div className="bg-white/[0.01]">
          {sortedPlayers.map((player) => {
            const kit = parseKit(player.role);
            const isCmd = isCommanderRole(player.role);
            return (
              <div key={player.id} className="flex items-center gap-2 py-1 px-3 border-t border-white/[0.03] hover:bg-white/[0.025]">
                {/* Action button — left side */}
                <PlayerActionMenu serverId={serverId} player={player} perms={playerPerms} teamId={teamId} />
                {/* Role icon */}
                {isCmd ? (
                  <span title="Commander"><Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>
                ) : player.isLeader ? (
                  <span title="Squad Leader"><ChevronsUp className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className={`text-xs truncate ${player.isLeader || isCmd ? "text-white font-medium" : "text-white/70"}`}>
                  {player.name}
                </span>
                {kit && (
                  <span className="text-[10px] text-muted-foreground/60 truncate hidden sm:inline ml-auto">
                    {kit}
                  </span>
                )}
              </div>
            );
          })}
          {sortedPlayers.length === 0 && (
            <p className="text-[10px] text-muted-foreground/30 py-2 px-3">Empty</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Team Column ────────────────────────────────────────────────────────────

function TeamColumn({
  team, serverId, playerPerms, canTeamChange, searchQuery,
}: {
  team: RconServerState["teams"][number];
  serverId: number; playerPerms: PlayerPerms; canTeamChange: boolean; searchQuery: string;
}) {
  const [allExpanded, setAllExpanded] = useState<boolean | null>(null);
  const totalPlayers = team.squads.reduce((sum, s) => sum + s.players.length, 0) + team.unassigned.length;
  const teamColor = TEAM_COLORS[team.teamId] ?? (team.teamId === "1" ? "#60a5fa" : "#f87171");
  const factionColor = FACTION_COLORS[team.factionTag] ?? teamColor;
  const teamLabel = team.factionName || `Team ${team.teamId}`;

  const toggleAll = useCallback(() => {
    setAllExpanded(prev => prev === false ? true : prev === true ? null : false);
  }, []);

  const forceExpanded = allExpanded;

  const filteredUnassigned = searchQuery
    ? team.unassigned.filter((p) => p.name.toLowerCase().includes(searchQuery))
    : team.unassigned;

  // Check if team has a commander
  const hasCommander = team.squads.some(s => s.players.some(p => isCommanderRole(p.role)));

  return (
    <div className="space-y-2">
      {/* Team header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg shrink-0 font-bold text-sm text-white" style={{ backgroundColor: teamColor }}>
            {team.teamId}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white/90 truncate">{teamLabel}</h3>
              {hasCommander && <span title="Has Commander"><Crown className="h-3.5 w-3.5 text-amber-400 shrink-0" /></span>}
              {team.factionTag && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: factionColor, backgroundColor: `${factionColor}15` }}>
                  {team.factionTag}
                </span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground/50">{totalPlayers} players · {team.squads.length} squads</p>
          </div>
        </div>
        <button
          onClick={toggleAll}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground/50 hover:text-white/70 hover:bg-white/[0.05] transition-colors"
          title={allExpanded === false ? "Expand All" : "Collapse All"}
        >
          {allExpanded === false ? (
            <><ChevronsUpDown className="h-3 w-3" /> Expand</>
          ) : (
            <><ChevronsDownUp className="h-3 w-3" /> Collapse</>
          )}
        </button>
      </div>

      {/* Squads */}
      {team.squads.map((squad) => (
        <SquadCard
          key={`${squad.teamId}-${squad.id}`}
          squad={squad} serverId={serverId} playerPerms={playerPerms}
          canTeamChange={canTeamChange}
          searchQuery={searchQuery} teamId={team.teamId}
          forceExpanded={forceExpanded}
        />
      ))}

      {/* Unassigned */}
      {filteredUnassigned.length > 0 && (
        <div className="rounded-lg border border-white/[0.04] bg-white/[0.01] px-3 py-2">
          <p className="text-[10px] font-medium text-muted-foreground/40 mb-1">Unassigned</p>
          {filteredUnassigned.map((player) => (
            <div key={player.id} className="flex items-center gap-2 py-0.5">
              {/* Action button on LEFT — same as squad players */}
              <PlayerActionMenu serverId={serverId} player={player} perms={playerPerms} teamId={team.teamId} />
              <span className="w-3.5 shrink-0" />
              <span className="text-xs text-white/60 truncate">{player.name}</span>
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
  const queryClient = useQueryClient();

  // Granular permissions
  const canWarn = useHasPermission("rcon_warn");
  const canKick = useHasPermission("rcon_kick");
  const canBroadcast = useHasPermission("rcon_broadcast");
  const canTeamChange = useHasPermission("rcon_team_change");
  const canDemote = useHasPermission("rcon_demote");
  const canMapChange = useHasPermission("rcon_map_change");

  const playerPerms: PlayerPerms = {
    canWarn,
    canKick,
    canTeamChange,
    canDemote,
    hasAny: canWarn || canKick || canTeamChange || canDemote,
  };

  const bcast = useBroadcast();

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
          <span className="text-[10px] text-muted-foreground/30">Auto-refreshes every 5s</span>
        </div>
        <div className="flex items-center gap-2">
          {servers.length > 1 && (
            <select value={activeServerId ?? ""} onChange={(e) => setSelectedServerId(parseInt(e.target.value, 10))}
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm dark:bg-input/30" style={{ colorScheme: "dark" }}>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {canMapChange && activeServerId && <ServerCommandsMenu serverId={activeServerId} />}
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
        {canBroadcast && (
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
            <TeamColumn key={team.teamId} team={team} serverId={activeServerId!} playerPerms={playerPerms} canTeamChange={canTeamChange} searchQuery={normalizedSearch} />
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
    </div>
  );
}
