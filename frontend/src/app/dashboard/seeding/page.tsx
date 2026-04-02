"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Sprout,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  RefreshCw,
  Clock,
  Trophy,
  Users,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  useSeedingConfig,
  useSaveSeedingConfig,
  useDeleteSeedingConfig,
  useTestSeedingConnection,
  useSeedingLeaderboard,
  useResetSeedingPoints,
} from "@/hooks/use-settings";
import { useWhitelists, useGroups } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

const MASKED = "••••••••";

const DANGEROUS_PERMS = new Set([
  "ban", "kick", "immune", "changemap", "config",
  "cameraman", "canseeadminchat", "manageserver", "cheat",
]);

function StatusBadge({ status, message }: { status: "ok" | "error" | null; message: string | null }) {
  if (!status) return null;
  if (status === "ok") {
    return (
      <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{message}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-red-400 text-xs">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? "var(--accent-primary)" : pct >= 50 ? "#eab308" : "rgba(255,255,255,0.3)";
  return (
    <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }}
      />
    </div>
  );
}

function SetupGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-white/[0.03] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" style={{ color: "var(--accent-primary)" }} />
          <span className="text-sm font-semibold text-white/80">How Seeding Rewards Work</span>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-white/[0.06] px-5 py-4 space-y-3 text-xs text-muted-foreground leading-relaxed">
          <p>
            The seeding module connects to your SquadJS instance via Socket.IO and monitors player counts
            in real-time. When your server is below the configured player threshold, it&apos;s considered
            to be in <strong className="text-white/70">seeding mode</strong>.
          </p>
          <p>
            Every minute during seeding mode, each online player earns <strong className="text-white/70">1 point</strong>.
            Once a player reaches the required points, they automatically receive a reserved slot
            (or other safe permission) via the whitelist system.
          </p>
          <p>
            In <strong className="text-white/70">fixed reset</strong> mode, all points reset on a schedule
            (e.g. daily at midnight). Players must earn their reward again each cycle.
          </p>
        </div>
      )}
    </div>
  );
}

export default function SeedingPage() {
  const { data, isLoading } = useSeedingConfig();
  const save = useSaveSeedingConfig();
  const remove = useDeleteSeedingConfig();
  const test = useTestSeedingConnection();
  const { data: leaderboardData } = useSeedingLeaderboard();
  const resetPoints = useResetSeedingPoints();

  const { data: whitelistsList } = useWhitelists();
  const { data: groupsList } = useGroups();

  const existing = data?.config ?? null;

  // Form state
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3000");
  const [token, setToken] = useState("");
  const [startCount, setStartCount] = useState("2");
  const [threshold, setThreshold] = useState("50");
  const [pointsRequired, setPointsRequired] = useState("120");
  const [rewardWhitelistId, setRewardWhitelistId] = useState<string>("");
  const [rewardGroupName, setRewardGroupName] = useState("reserve");
  const [rewardDurationHours, setRewardDurationHours] = useState("168");
  const [resetCron, setResetCron] = useState("0 0 * * *");
  const [enabled, setEnabled] = useState(false);

  // Sync form from fetched config
  useEffect(() => {
    if (!existing) return;
    setHost(existing.squadjs_host);
    setPort(String(existing.squadjs_port));
    setToken(MASKED);
    setStartCount(String(existing.seeding_start_player_count));
    setThreshold(String(existing.seeding_player_threshold));
    setPointsRequired(String(existing.points_required));
    setRewardWhitelistId(existing.reward_whitelist_id ? String(existing.reward_whitelist_id) : "");
    setRewardGroupName(existing.reward_group_name);
    setRewardDurationHours(String(existing.reward_duration_hours));
    setResetCron(existing.reset_cron);
    setEnabled(existing.enabled);
  }, [existing?.id]);

  // Filter groups to safe-only
  const safeGroups = (groupsList ?? []).filter((g) => {
    const perms = g.permissions.split(",").map((p) => p.trim().toLowerCase());
    return !perms.some((p) => DANGEROUS_PERMS.has(p));
  });

  const whitelists = whitelistsList ?? [];

  function buildPayload() {
    return {
      squadjs_host: host.trim(),
      squadjs_port: parseInt(port, 10) || 3000,
      squadjs_token: token === MASKED ? MASKED : token,
      seeding_start_player_count: parseInt(startCount, 10) || 2,
      seeding_player_threshold: parseInt(threshold, 10) || 50,
      points_required: parseInt(pointsRequired, 10) || 120,
      reward_whitelist_id: rewardWhitelistId ? parseInt(rewardWhitelistId, 10) : null,
      reward_group_name: rewardGroupName,
      reward_duration_hours: parseInt(rewardDurationHours, 10) || 168,
      tracking_mode: "fixed_reset" as const,
      reset_cron: resetCron.trim() || "0 0 * * *",
      enabled,
    };
  }

  async function handleSave() {
    if (!host) {
      toast.error("SquadJS host is required");
      return;
    }
    if (!existing && (!token || token === MASKED)) {
      toast.error("SquadJS token is required for a new config");
      return;
    }
    try {
      await save.mutateAsync(buildPayload());
      toast.success("Seeding configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    }
  }

  async function handleTest() {
    if (!host) {
      toast.error("Fill in the SquadJS host first");
      return;
    }
    const payload = buildPayload();
    if (payload.squadjs_token === MASKED) delete (payload as Record<string, unknown>).squadjs_token;
    try {
      const result = await test.mutateAsync(payload);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch {
      toast.error("Test request failed");
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync();
      toast.success("Seeding configuration removed");
      setHost(""); setPort("3000"); setToken(""); setStartCount("2");
      setThreshold("50"); setPointsRequired("120"); setRewardWhitelistId("");
      setRewardGroupName("reserve"); setRewardDurationHours("168");
      setResetCron("0 0 * * *"); setEnabled(false);
    } catch {
      toast.error("Failed to remove configuration");
    }
  }

  async function handleReset() {
    try {
      const result = await resetPoints.mutateAsync();
      toast.success(`Reset points for ${result.players_reset} player(s)`);
    } catch {
      toast.error("Failed to reset points");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const leaderboard = leaderboardData?.players ?? [];
  const leaderboardPointsRequired = leaderboardData?.points_required ?? parseInt(pointsRequired, 10) || 120;

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Sprout className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white/90">Seeding Module</h1>
          <p className="text-xs text-muted-foreground">
            Reward players who help seed your server with whitelist access
          </p>
        </div>
      </div>

      <SetupGuide />

      {/* Last poll status */}
      {existing && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Poll</span>
            <Badge variant={existing.enabled ? "default" : "secondary"} className="text-[10px]">
              {existing.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          {existing.last_poll_at ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                {new Date(existing.last_poll_at).toLocaleString()}
              </div>
              <StatusBadge status={existing.last_poll_status} message={existing.last_poll_message} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No poll run yet</p>
          )}
        </div>
      )}

      {/* SquadJS Connection */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white/80">SquadJS Connection</h2>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Host</Label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="your-squadjs-host.com" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="3000" className="h-8 text-xs" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Token</Label>
          <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={existing ? "Leave blank to keep current" : "SquadJS auth token"} className="h-8 text-xs" />
        </div>
      </div>

      {/* Seeding Thresholds */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white/80">Seeding Thresholds</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Min Players (start tracking)</Label>
            <Input type="number" min={1} max={100} value={startCount} onChange={(e) => setStartCount(e.target.value)} className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Max Players (seeding threshold)</Label>
            <Input type="number" min={2} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Points Required (1 point = 1 minute seeding)</Label>
          <Input type="number" min={1} max={10000} value={pointsRequired} onChange={(e) => setPointsRequired(e.target.value)} className="h-8 text-xs" />
          <p className="text-[10px] text-muted-foreground/70">
            {parseInt(pointsRequired, 10) || 0} points = {Math.round((parseInt(pointsRequired, 10) || 0) / 60 * 10) / 10} hours of seeding
          </p>
        </div>
      </div>

      {/* Reward Settings */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white/80">Reward Settings</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reward Whitelist</Label>
            <select
              value={rewardWhitelistId}
              onChange={(e) => setRewardWhitelistId(e.target.value)}
              className="flex h-8 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-white/80"
            >
              <option value="">Default whitelist</option>
              {whitelists.map((wl) => (
                <option key={wl.id} value={String(wl.id)}>{wl.name}{wl.is_default ? " (default)" : ""}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Permission Group</Label>
            <select
              value={rewardGroupName}
              onChange={(e) => setRewardGroupName(e.target.value)}
              className="flex h-8 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-white/80"
            >
              {safeGroups.map((g) => (
                <option key={g.group_name} value={g.group_name}>{g.group_name} ({g.permissions})</option>
              ))}
              {safeGroups.length === 0 && <option value="reserve">reserve (default)</option>}
            </select>
            <p className="text-[10px] text-muted-foreground/70">
              Only groups with safe permissions (reserve, balance, teamchange) are shown
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reward Duration (hours)</Label>
            <Input type="number" min={1} max={8760} value={rewardDurationHours} onChange={(e) => setRewardDurationHours(e.target.value)} className="h-8 text-xs" />
            <p className="text-[10px] text-muted-foreground/70">
              {Math.round((parseInt(rewardDurationHours, 10) || 0) / 24 * 10) / 10} days
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Point Reset Schedule (cron)</Label>
            <Input value={resetCron} onChange={(e) => setResetCron(e.target.value)} placeholder="0 0 * * *" className="h-8 text-xs font-mono" />
            <p className="text-[10px] text-muted-foreground/70">
              Default: daily at midnight (0 0 * * *)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label className="text-sm">
            {enabled ? "Seeding tracker enabled" : "Seeding tracker disabled"}
          </Label>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={save.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
          {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {existing ? "Save Changes" : "Connect"}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={test.isPending}>
          {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Test Connection
        </Button>
        {existing && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" className="ml-auto text-red-400 hover:text-red-300 hover:bg-red-500/10" disabled={remove.isPending} />}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove seeding configuration?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove your SquadJS connection and stop tracking seeding points. Existing rewards and points are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Remove</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Leaderboard */}
      {existing && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
              <h2 className="text-sm font-semibold text-white/80">Seeding Leaderboard</h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                <Users className="h-3 w-3 inline mr-1" />
                {leaderboard.length} seeder(s)
              </span>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" size="sm" className="h-7 text-xs" disabled={resetPoints.isPending} />}>
                  {resetPoints.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  Reset All
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all seeding points?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will reset all player seeding points to zero. Existing whitelist rewards will remain until they expire.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} className="bg-red-600 hover:bg-red-700">Reset All Points</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {leaderboard.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              No seeding data yet. Points will appear once players start seeding.
            </p>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((player, idx) => (
                <div key={player.steam_id} className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                  <span className="text-xs font-bold text-white/40 w-6 text-right">{idx + 1}</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white/80 truncate">
                        {player.player_name ?? player.steam_id}
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
                    <span className="text-xs font-semibold text-white/70">
                      {player.points}/{leaderboardPointsRequired}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {player.progress_pct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info footer */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        The seeding service connects to your SquadJS instance via Socket.IO and awards 1 point per minute
        to players online during seeding mode. When a player reaches the required points, they automatically
        receive whitelist access for the configured duration. Points reset on the configured schedule.
      </p>
    </div>
  );
}
