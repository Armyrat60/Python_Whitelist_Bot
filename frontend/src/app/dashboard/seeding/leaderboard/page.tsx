"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Trophy,
  Users,
  RefreshCw,
  Loader2,
  Plus,
  Search,
  ExternalLink,
} from "lucide-react";
import {
  useSeedingConfig,
  useSeedingLeaderboard,
  useResetSeedingPoints,
  useGrantSeedingPoints,
  useSaveSeedingConfig,
} from "@/hooks/use-settings";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
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

// ─── ProgressBar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct }: { pct: number }) {
  const color =
    pct >= 100
      ? "var(--accent-primary)"
      : pct >= 50
        ? "#eab308"
        : "rgba(255,255,255,0.3)";
  return (
    <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${Math.min(pct, 100)}%`, background: color }}
      />
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function SeedingLeaderboardPage() {
  const { data: configData } = useSeedingConfig();
  const { data: leaderboardData, isLoading } = useSeedingLeaderboard();
  const resetPoints = useResetSeedingPoints();
  const grantPoints = useGrantSeedingPoints();
  const save = useSaveSeedingConfig();

  const config = configData?.config ?? null;
  const leaderboard = leaderboardData?.players ?? [];
  const lbRequired = leaderboardData?.points_required ?? 120;

  const [leaderboardSearch, setLeaderboardSearch] = useState("");
  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [grantSteamId, setGrantSteamId] = useState("");
  const [grantPointsVal, setGrantPointsVal] = useState("60");

  const leaderboardPublic = config?.leaderboard_public ?? false;

  const filteredLeaderboard = useMemo(() => {
    if (!leaderboardSearch.trim()) return leaderboard;
    const q = leaderboardSearch.toLowerCase();
    return leaderboard.filter(
      (p) =>
        (p.player_name ?? "").toLowerCase().includes(q) ||
        p.steam_id.includes(q),
    );
  }, [leaderboard, leaderboardSearch]);

  async function handleReset() {
    try {
      const r = await resetPoints.mutateAsync();
      toast.success(`Reset ${r.players_reset} player(s)`);
    } catch {
      toast.error("Failed to reset");
    }
  }

  async function handleGrant() {
    if (!/^[0-9]{17}$/.test(grantSteamId)) {
      toast.error("Enter a valid 17-digit Steam64 ID");
      return;
    }
    try {
      await grantPoints.mutateAsync({
        steam_id: grantSteamId,
        points: parseInt(grantPointsVal, 10) || 0,
      });
      toast.success("Points granted");
      setShowGrantDialog(false);
      setGrantSteamId("");
    } catch {
      toast.error("Failed to grant");
    }
  }

  async function handleTogglePublic(v: boolean) {
    if (!config) return;
    try {
      await save.mutateAsync({ leaderboard_public: v });
      toast.success(v ? "Leaderboard public" : "Leaderboard private");
    } catch {
      toast.error("Failed");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Trophy
            className="h-4 w-4"
            style={{ color: "var(--accent-primary)" }}
          />
          <h2 className="text-sm font-semibold text-white/80">
            Seeding Leaderboard
          </h2>
          <span className="text-xs text-muted-foreground">
            <Users className="h-3 w-3 inline mr-1" />
            {leaderboard.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowGrantDialog(true)}
          >
            <Plus className="mr-1 h-3 w-3" /> Grant
          </Button>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={resetPoints.isPending}
                />
              }
            >
              {resetPoints.isPending ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}{" "}
              Reset All
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset all seeding points?</AlertDialogTitle>
                <AlertDialogDescription>
                  All points set to zero. Existing whitelist rewards remain until
                  they expire.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleReset}
                  className="bg-red-600 hover:bg-red-700"
                >
                  Reset All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={leaderboardSearch}
          onChange={(e) => setLeaderboardSearch(e.target.value)}
          placeholder="Search by player name or Steam ID..."
          className="h-8 text-xs pl-9"
        />
      </div>

      {/* Grant dialog */}
      {showGrantDialog && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
          <h3 className="text-sm font-semibold text-white/80">Grant Points</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Steam64 ID
              </Label>
              <Input
                value={grantSteamId}
                onChange={(e) => setGrantSteamId(e.target.value)}
                placeholder="76561198012345678"
                className="h-8 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Points</Label>
              <Input
                type="number"
                min={1}
                max={10000}
                value={grantPointsVal}
                onChange={(e) => setGrantPointsVal(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleGrant}
              disabled={grantPoints.isPending}
              style={{ background: "var(--accent-primary)" }}
              className="text-black font-semibold text-xs"
            >
              {grantPoints.isPending && (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              )}{" "}
              Grant
            </Button>
            <Button
              variant="outline"
              className="text-xs"
              onClick={() => setShowGrantDialog(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Leaderboard list */}
      {filteredLeaderboard.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">
          {leaderboardSearch
            ? "No players match your search."
            : "No seeding data yet. Points appear once players start seeding."}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredLeaderboard.map((player, idx) => (
            <div
              key={player.steam_id}
              className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.10] px-3 py-2.5"
            >
              <span className={`text-xs font-bold w-6 text-right shrink-0 ${idx === 0 ? "text-amber-400" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-700" : "text-white/50"}`}>
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-white/80 truncate">
                    {player.player_name ?? player.steam_id}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-mono">
                    {player.steam_id}
                  </span>
                  {player.tier_label && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                      player.tier_label.toLowerCase().includes("gold") ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                      player.tier_label.toLowerCase().includes("silver") ? "bg-gray-400/20 text-gray-300 border border-gray-400/30" :
                      player.tier_label.toLowerCase().includes("bronze") ? "bg-orange-500/20 text-orange-400 border border-orange-500/30" :
                      "bg-white/[0.08] text-white/60 border border-white/[0.12]"
                    }`}>
                      {player.tier_label}
                    </span>
                  )}
                  {player.rewarded && (
                    <Badge variant="default" className="text-[9px] px-1.5 py-0" style={{ background: "#10b981", color: "white" }}>
                      Rewarded
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/60">
                  <span>{player.seeding_hours ?? (Math.round(player.points / 60 * 10) / 10)}h seeded</span>
                  {player.last_award_at && (
                    <span>Last active: {new Date(player.last_award_at).toLocaleDateString()}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="w-20">
                  <ProgressBar pct={player.progress_pct} />
                </div>
                <div className="text-right w-16">
                  <span className="text-xs font-semibold text-white/70">
                    {player.points}<span className="text-muted-foreground/60">/{lbRequired}</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
