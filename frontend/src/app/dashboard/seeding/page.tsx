"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
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
  Plug,
  Gift,
  BookOpen,
  ExternalLink,
  Plus,
  Search,
  AlertTriangle,
  HelpCircle,
} from "lucide-react";
import {
  useSeedingConfig,
  useSaveSeedingConfig,
  useDeleteSeedingConfig,
  useTestSeedingConnection,
  useSeedingLeaderboard,
  useResetSeedingPoints,
  useGrantSeedingPoints,
  useWhitelists,
  useGroups,
} from "@/hooks/use-settings";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import type { SeedingConfig } from "@/lib/types";

const MASKED = "••••••••";
const DANGEROUS_PERMS = new Set(["ban", "kick", "immune", "changemap", "config", "cameraman", "canseeadminchat", "manageserver", "cheat"]);
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getConnectionStatus(config: SeedingConfig | null): "green" | "yellow" | "red" | "grey" {
  if (!config) return "grey";
  if (!config.enabled) return "grey";
  if (!config.last_poll_at) return "yellow";
  if (config.last_poll_status === "error") return "red";
  const age = Date.now() - new Date(config.last_poll_at).getTime();
  if (age > 5 * 60 * 1000) return "yellow";
  return "green";
}

function getConnectionDetail(config: SeedingConfig | null): { label: string; description: string; troubleshoot?: string[] } {
  if (!config) return { label: "Not configured", description: "Set up your SquadJS connection to get started." };
  if (!config.enabled) return { label: "Disabled", description: "Enable the seeding tracker to start monitoring." };
  if (!config.squadjs_host) return { label: "Missing host", description: "Enter your SquadJS host address." };
  if (!config.last_poll_at) {
    return {
      label: "Waiting for first poll",
      description: "The seeding service is starting up. First poll should happen within 60 seconds.",
      troubleshoot: [
        "Verify the seeding-service is running on Railway",
        "Check that DATABASE_URL is set on the seeding-service",
        "Check Railway logs for startup errors",
      ],
    };
  }
  if (config.last_poll_status === "error") {
    const msg = config.last_poll_message ?? "Unknown error";
    const tips: string[] = [];
    if (msg.includes("Not connected")) {
      tips.push("Verify SquadJS is running and the Socket.IO port is accessible");
      tips.push("Check that the host and port are correct (default SquadJS port is 3000)");
      tips.push("Ensure no firewall is blocking the connection");
      tips.push("Verify the authentication token is correct");
    } else if (msg.includes("timed out") || msg.includes("timeout")) {
      tips.push("SquadJS may be unreachable — check if it's running");
      tips.push("Network latency or firewall may be blocking the connection");
      tips.push("Try using the IP address instead of hostname");
    } else if (msg.includes("token") || msg.includes("auth")) {
      tips.push("The SquadJS authentication token may be incorrect");
      tips.push("Regenerate the token in your SquadJS config and update it here");
    } else {
      tips.push("Check the seeding-service logs on Railway for more details");
      tips.push("Verify SquadJS is running and accessible");
      tips.push("Try the Test Connection button to diagnose");
    }
    return { label: "Connection error", description: msg, troubleshoot: tips };
  }
  const age = Date.now() - new Date(config.last_poll_at).getTime();
  if (age > 5 * 60 * 1000) {
    const mins = Math.round(age / 60000);
    return {
      label: "Stale connection",
      description: `Last successful poll was ${mins} minute(s) ago. The service may have restarted.`,
      troubleshoot: [
        "Check if the seeding-service is running on Railway",
        "The service may be restarting — wait 1-2 minutes",
        "Check Railway logs for crash or memory errors",
      ],
    };
  }
  return { label: "Connected", description: config.last_poll_message ?? "Polling active" };
}

const STATUS_COLORS: Record<string, string> = { green: "#10b981", yellow: "#eab308", red: "#ef4444", grey: "#6b7280" };

function parseCron(cron: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { frequency: "custom", hour: 12, minute: 0, ampm: "AM", dayOfWeek: 1, dayOfMonth: 1 };
  const [min, hr, dom, , dow] = parts;
  const hour24 = parseInt(hr, 10);
  const minute = parseInt(min, 10);
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 === 0 ? 12 : hour24 > 12 ? (hour24 - 12) : hour24;
  if (dom !== "*" && dow === "*") return { frequency: "monthly", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: parseInt(dom, 10) || 1 };
  if (dow !== "*" && dom === "*") return { frequency: "weekly", hour, minute, ampm, dayOfWeek: parseInt(dow, 10) || 0, dayOfMonth: 1 };
  if (dom === "*" && dow === "*") return { frequency: "daily", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: 1 };
  return { frequency: "custom", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: 1 };
}

function buildCron(freq: string, hour: number, minute: number, ampm: string, dow: number, dom: number, custom: string): string {
  if (freq === "custom") return custom;
  let h24 = hour % 12;
  if (ampm === "PM") h24 += 12;
  if (freq === "daily") return `${minute} ${h24} * * *`;
  if (freq === "weekly") return `${minute} ${h24} * * ${dow}`;
  if (freq === "monthly") return `${minute} ${h24} ${dom} * *`;
  return `${minute} ${h24} * * *`;
}

function cronToReadable(cron: string): string {
  const p = parseCron(cron);
  const t = `${p.hour}:${String(p.minute).padStart(2, "0")} ${p.ampm}`;
  if (p.frequency === "daily") return `Resets daily at ${t}`;
  if (p.frequency === "weekly") return `Resets every ${DAYS_OF_WEEK[p.dayOfWeek]} at ${t}`;
  if (p.frequency === "monthly") return `Resets on day ${p.dayOfMonth} of each month at ${t}`;
  return `Custom schedule: ${cron}`;
}

// ─── Shared Components ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full shrink-0 animate-pulse"
      style={{ background: STATUS_COLORS[status] ?? STATUS_COLORS.grey, boxShadow: `0 0 6px ${STATUS_COLORS[status] ?? STATUS_COLORS.grey}` }}
    />
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 100 ? "var(--accent-primary)" : pct >= 50 ? "#eab308" : "rgba(255,255,255,0.3)";
  return (
    <div className="h-2 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
      <h2 className="text-sm font-semibold text-white/80">{title}</h2>
      {children}
    </div>
  );
}

function Sel({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className={`flex h-8 w-full rounded-md border border-white/[0.08] px-3 text-xs text-white/80 appearance-none cursor-pointer ${className ?? ""}`}
      style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
    >{children}</select>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SeedingPage() {
  const { data, isLoading } = useSeedingConfig();
  const save = useSaveSeedingConfig();
  const remove = useDeleteSeedingConfig();
  const testConn = useTestSeedingConnection();
  const { data: leaderboardData } = useSeedingLeaderboard();
  const resetPoints = useResetSeedingPoints();
  const grantPoints = useGrantSeedingPoints();
  const { data: whitelistsList } = useWhitelists();
  const { data: groupsList } = useGroups();

  const existing = data?.config ?? null;
  const connStatus = getConnectionStatus(existing);
  const connDetail = getConnectionDetail(existing);

  // ── Form state ──
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3000");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [seedingHours, setSeedingHours] = useState("2");
  const [seedingMinutes, setSeedingMinutes] = useState("0");
  const [startCount, setStartCount] = useState("2");
  const [threshold, setThreshold] = useState("50");
  const [rewardWhitelistId, setRewardWhitelistId] = useState<string>("");
  const [rewardGroupName, setRewardGroupName] = useState("SeedReserve");
  const [rewardDurationHours, setRewardDurationHours] = useState("168");
  const [resetFrequency, setResetFrequency] = useState("monthly");
  const [resetHour, setResetHour] = useState("12");
  const [resetMinute, setResetMinute] = useState("0");
  const [resetAmPm, setResetAmPm] = useState("AM");
  const [resetDayOfWeek, setResetDayOfWeek] = useState("1");
  const [resetDayOfMonth, setResetDayOfMonth] = useState("1");
  const [customCron, setCustomCron] = useState("0 0 * * *");
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowStart, setWindowStart] = useState("07:00");
  const [windowEnd, setWindowEnd] = useState("22:00");
  const [tiersEnabled, setTiersEnabled] = useState(false);
  const [tiers, setTiers] = useState([
    { label: "Bronze", hours: "1", minutes: "0", durationHours: "24" },
    { label: "Silver", hours: "4", minutes: "0", durationHours: "168" },
    { label: "Gold", hours: "8", minutes: "0", durationHours: "720" },
  ]);
  const [rconWarningsEnabled, setRconWarningsEnabled] = useState(false);
  const [rconWarningMessage, setRconWarningMessage] = useState("Seeding Progress: {progress}% ({points}/{required}). Keep seeding!");
  const [trackingMode, setTrackingMode] = useState<"fixed_reset" | "daily_decay">("fixed_reset");
  const [decayDaysThreshold, setDecayDaysThreshold] = useState("3");
  const [decayPointsPerDay, setDecayPointsPerDay] = useState("10");
  const [leaderboardPublic, setLeaderboardPublic] = useState(false);
  const [grantSteamId, setGrantSteamId] = useState("");
  const [grantPointsVal, setGrantPointsVal] = useState("60");
  const [showGrantDialog, setShowGrantDialog] = useState(false);
  const [leaderboardSearch, setLeaderboardSearch] = useState("");

  useEffect(() => {
    if (!existing) return;
    setHost(existing.squadjs_host); setPort(String(existing.squadjs_port)); setToken(MASKED); setEnabled(existing.enabled);
    const pts = existing.points_required;
    setSeedingHours(String(Math.floor(pts / 60))); setSeedingMinutes(String(pts % 60));
    setStartCount(String(existing.seeding_start_player_count)); setThreshold(String(existing.seeding_player_threshold));
    setRewardWhitelistId(existing.reward_whitelist_id ? String(existing.reward_whitelist_id) : "");
    setRewardGroupName(existing.reward_group_name); setRewardDurationHours(String(existing.reward_duration_hours));
    const p = parseCron(existing.reset_cron);
    setResetFrequency(p.frequency); setResetHour(String(p.hour)); setResetMinute(String(p.minute));
    setResetAmPm(p.ampm); setResetDayOfWeek(String(p.dayOfWeek)); setResetDayOfMonth(String(p.dayOfMonth));
    if (p.frequency === "custom") setCustomCron(existing.reset_cron);
    setWindowEnabled(existing.seeding_window_enabled);
    setWindowStart(existing.seeding_window_start);
    setWindowEnd(existing.seeding_window_end);
    if (existing.reward_tiers?.length) {
      setTiersEnabled(true);
      setTiers(existing.reward_tiers.map((t) => ({
        label: t.label, hours: String(Math.floor(t.points / 60)),
        minutes: String(t.points % 60), durationHours: String(t.duration_hours),
      })));
    } else { setTiersEnabled(false); }
    setRconWarningsEnabled(existing.rcon_warnings_enabled);
    setRconWarningMessage(existing.rcon_warning_message);
    setTrackingMode(existing.tracking_mode);
    setDecayDaysThreshold(String(existing.decay_days_threshold));
    setDecayPointsPerDay(String(existing.decay_points_per_day));
    setLeaderboardPublic(existing.leaderboard_public);
  }, [existing?.id]);

  const safeGroups = (groupsList ?? []).filter((g) => !g.permissions.split(",").some((p) => DANGEROUS_PERMS.has(p.trim().toLowerCase())));
  const whitelists = whitelistsList ?? [];

  function buildPayload() {
    const pts = (parseInt(seedingHours, 10) || 0) * 60 + (parseInt(seedingMinutes, 10) || 0);
    const cron = buildCron(resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinute, 10) || 0, resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron);
    return {
      squadjs_host: host.trim(), squadjs_port: parseInt(port, 10) || 3000,
      squadjs_token: token === MASKED ? MASKED : token,
      seeding_start_player_count: parseInt(startCount, 10) || 2, seeding_player_threshold: parseInt(threshold, 10) || 50,
      points_required: pts || 120, reward_whitelist_id: rewardWhitelistId ? parseInt(rewardWhitelistId, 10) : null,
      reward_group_name: rewardGroupName, reward_duration_hours: parseInt(rewardDurationHours, 10) || 168,
      tracking_mode: trackingMode, reset_cron: cron,
      seeding_window_enabled: windowEnabled, seeding_window_start: windowStart, seeding_window_end: windowEnd,
      reward_tiers: tiersEnabled ? tiers.map((t) => ({
        points: (parseInt(t.hours, 10) || 0) * 60 + (parseInt(t.minutes, 10) || 0),
        duration_hours: parseInt(t.durationHours, 10) || 24,
        label: t.label.trim() || "Tier",
      })) : null,
      rcon_warnings_enabled: rconWarningsEnabled, rcon_warning_message: rconWarningMessage,
      decay_days_threshold: parseInt(decayDaysThreshold, 10) || 3,
      decay_points_per_day: parseInt(decayPointsPerDay, 10) || 10,
      enabled, leaderboard_public: leaderboardPublic,
    };
  }

  async function handleSave() {
    if (!host) { toast.error("SquadJS host is required"); return; }
    if (!existing && (!token || token === MASKED)) { toast.error("SquadJS token is required"); return; }
    try { await save.mutateAsync(buildPayload()); toast.success("Configuration saved"); } catch { toast.error("Failed to save"); }
  }
  async function handleTest() {
    if (!host) { toast.error("Enter SquadJS host first"); return; }
    const p = buildPayload();
    if (p.squadjs_token === MASKED) delete (p as Record<string, unknown>).squadjs_token;
    try { const r = await testConn.mutateAsync(p); r.ok ? toast.success(r.message) : toast.error(r.message); } catch { toast.error("Test failed"); }
  }
  async function handleDelete() {
    try { await remove.mutateAsync(); toast.success("Configuration removed"); setHost(""); setPort("3000"); setToken(""); setEnabled(false); } catch { toast.error("Failed to remove"); }
  }
  async function handleReset() {
    try { const r = await resetPoints.mutateAsync(); toast.success(`Reset ${r.players_reset} player(s)`); } catch { toast.error("Failed to reset"); }
  }
  async function handleGrant() {
    if (!/^[0-9]{17}$/.test(grantSteamId)) { toast.error("Enter a valid 17-digit Steam64 ID"); return; }
    try { await grantPoints.mutateAsync({ steam_id: grantSteamId, points: parseInt(grantPointsVal, 10) || 0 }); toast.success("Points granted"); setShowGrantDialog(false); setGrantSteamId(""); } catch { toast.error("Failed to grant"); }
  }

  const leaderboard = leaderboardData?.players ?? [];
  const lbRequired = leaderboardData?.points_required ?? ((parseInt(seedingHours, 10) || 0) * 60 + (parseInt(seedingMinutes, 10) || 0) || 120);
  const currentCron = buildCron(resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinute, 10) || 0, resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron);

  const filteredLeaderboard = useMemo(() => {
    if (!leaderboardSearch.trim()) return leaderboard;
    const q = leaderboardSearch.toLowerCase();
    return leaderboard.filter((p) =>
      (p.player_name?.toLowerCase().includes(q)) || p.steam_id.includes(q)
    );
  }, [leaderboard, leaderboardSearch]);

  if (isLoading) return <div className="space-y-4 max-w-3xl"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}>
          <Sprout className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white/90">Seeding Module</h1>
            <StatusDot status={connStatus} />
            <span className="text-xs text-muted-foreground">{connDetail.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">Reward players who help seed your server</p>
        </div>
        {existing && <Badge variant={existing.enabled ? "default" : "secondary"} className="text-[10px] shrink-0">{existing.enabled ? "Enabled" : "Disabled"}</Badge>}
      </div>

      {/* Tabs — 4 tabs: Connection, Reward Settings, Leaderboard, How It Works */}
      <Tabs orientation="horizontal" defaultValue="connection">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="connection"><Plug className="h-3.5 w-3.5" /> Connection</TabsTrigger>
          <TabsTrigger value="rewards"><Gift className="h-3.5 w-3.5" /> Reward Settings</TabsTrigger>
          <TabsTrigger value="leaderboard"><Trophy className="h-3.5 w-3.5" /> Leaderboard</TabsTrigger>
          <TabsTrigger value="guide"><BookOpen className="h-3.5 w-3.5" /> How It Works</TabsTrigger>
        </TabsList>

        {/* ── Connection Tab ─────────────────────────────────────────── */}
        <TabsContent value="connection" className="space-y-4">
          {/* Status card with detailed info */}
          <div className={`rounded-xl border px-5 py-4 space-y-3 ${
            connStatus === "red" ? "border-red-500/20 bg-red-500/5" :
            connStatus === "yellow" ? "border-yellow-500/20 bg-yellow-500/5" :
            connStatus === "green" ? "border-emerald-500/20 bg-emerald-500/5" :
            "border-white/[0.08] bg-white/[0.02]"
          }`}>
            <div className="flex items-center gap-2">
              <StatusDot status={connStatus} />
              <span className="text-sm font-medium text-white/80">{connDetail.label}</span>
              {existing?.last_poll_at && (
                <span className="text-[10px] text-muted-foreground ml-auto flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {new Date(existing.last_poll_at).toLocaleString()}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{connDetail.description}</p>

            {connDetail.troubleshoot && (
              <div className="rounded-lg bg-black/20 border border-white/[0.06] px-4 py-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
                  <HelpCircle className="h-3.5 w-3.5" /> Troubleshooting
                </div>
                <ul className="space-y-1">
                  {connDetail.troubleshoot.map((tip, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-2">
                      <span className="text-white/30 shrink-0">{i + 1}.</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <Card title="SquadJS Connection">
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
            <div className="flex items-center gap-3">
              <Switch checked={enabled} onCheckedChange={setEnabled} />
              <Label className="text-sm">{enabled ? "Seeding tracker enabled" : "Seeding tracker disabled"}</Label>
            </div>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={save.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
              {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {existing ? "Save Changes" : "Connect"}
            </Button>
            <Button variant="outline" onClick={handleTest} disabled={testConn.isPending}>
              {testConn.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Test Connection
            </Button>
            {existing && (
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" className="ml-auto text-red-400 hover:text-red-300 hover:bg-red-500/10" disabled={remove.isPending} />}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove seeding configuration?</AlertDialogTitle>
                    <AlertDialogDescription>This removes your SquadJS connection and stops tracking. Existing rewards and points are kept.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </TabsContent>

        {/* ── Reward Settings Tab ──────────────────────────────────── */}
        <TabsContent value="rewards" className="space-y-4">
          {/* Tiered Rewards toggle + table */}
          <Card title="Reward Tiers">
            <div className="flex items-center gap-3 mb-2">
              <Switch checked={tiersEnabled} onCheckedChange={setTiersEnabled} />
              <Label className="text-sm">{tiersEnabled ? "Tiered rewards enabled — multiple reward levels" : "Single reward — one threshold for all players"}</Label>
            </div>

            {tiersEnabled ? (
              <div className="space-y-3">
                <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wide px-1">
                  <span>Label</span><span>Hours</span><span>Min</span><span>Duration (h)</span><span></span>
                </div>
                {tiers.map((tier, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                    <Input value={tier.label} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], label: e.target.value }; setTiers(t); }} className="h-8 text-xs" placeholder="Tier name" />
                    <Input type="number" min={0} max={166} value={tier.hours} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], hours: e.target.value }; setTiers(t); }} className="h-8 text-xs w-16" />
                    <Input type="number" min={0} max={59} value={tier.minutes} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], minutes: e.target.value }; setTiers(t); }} className="h-8 text-xs w-16" />
                    <Input type="number" min={1} max={8760} value={tier.durationHours} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], durationHours: e.target.value }; setTiers(t); }} className="h-8 text-xs w-20" />
                    {tiers.length > 2 && (
                      <button onClick={() => setTiers(tiers.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 text-xs px-1">x</button>
                    )}
                  </div>
                ))}
                {tiers.length < 5 && (
                  <button onClick={() => setTiers([...tiers, { label: `Tier ${tiers.length + 1}`, hours: "0", minutes: "0", durationHours: "24" }])} className="text-xs hover:underline" style={{ color: "var(--accent-primary)" }}>
                    + Add tier
                  </button>
                )}
                <p className="text-[10px] text-muted-foreground/70">Players earn the highest tier they qualify for. Duration is how long the whitelist reward lasts.</p>
              </div>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Hours</Label>
                    <Input type="number" min={0} max={166} value={seedingHours} onChange={(e) => setSeedingHours(e.target.value)} className="h-8 text-xs w-20" />
                  </div>
                  <span className="text-xs text-muted-foreground pb-2">h</span>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Minutes</Label>
                    <Input type="number" min={0} max={59} value={seedingMinutes} onChange={(e) => setSeedingMinutes(e.target.value)} className="h-8 text-xs w-20" />
                  </div>
                  <span className="text-xs text-muted-foreground pb-2">m required</span>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Reward Duration (hours)</Label>
                  <Input type="number" min={1} max={8760} value={rewardDurationHours} onChange={(e) => setRewardDurationHours(e.target.value)} className="h-8 text-xs w-32" />
                  <p className="text-[10px] text-muted-foreground/70">= {Math.round((parseInt(rewardDurationHours, 10) || 0) / 24 * 10) / 10} days</p>
                </div>
              </>
            )}
          </Card>

          <Card title="Seeding Thresholds">
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
            <p className="text-[10px] text-muted-foreground/70">Seeding mode active when server has {startCount} to {threshold} players</p>
          </Card>

          <Card title="Seeding Time Window">
            <div className="flex items-center gap-3 mb-2">
              <Switch checked={windowEnabled} onCheckedChange={setWindowEnabled} />
              <Label className="text-sm">{windowEnabled ? "Time window enabled — only track during set hours" : "Time window disabled — track 24/7"}</Label>
            </div>
            {windowEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Start Time</Label>
                  <Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className="h-8 text-xs" style={{ colorScheme: "dark" }} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">End Time</Label>
                  <Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className="h-8 text-xs" style={{ colorScheme: "dark" }} />
                </div>
              </div>
            )}
            {windowEnabled && (
              <p className="text-[10px] text-muted-foreground/70">Points only accumulate between {windowStart} and {windowEnd} (server time).</p>
            )}
          </Card>

          <Card title="Reward Whitelist & Permissions">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Reward Whitelist</Label>
                <Sel value={rewardWhitelistId} onChange={setRewardWhitelistId}>
                  <option value="">Auto-created (Seeding Rewards)</option>
                  {whitelists.map((wl) => <option key={wl.id} value={String(wl.id)}>{wl.name}{wl.is_default ? " (default)" : ""}</option>)}
                </Sel>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Permission Group</Label>
                <Sel value={rewardGroupName} onChange={setRewardGroupName}>
                  {safeGroups.map((g) => <option key={g.group_name} value={g.group_name}>{g.group_name} ({g.permissions})</option>)}
                  {safeGroups.length === 0 && <option value="reserve">reserve (default)</option>}
                </Sel>
                <p className="text-[10px] text-muted-foreground/70">Only safe permission groups shown</p>
              </div>
            </div>
          </Card>

          {/* In-Game RCON Warnings */}
          <Card title="In-Game Notifications">
            <div className="flex items-center gap-3 mb-2">
              <Switch checked={rconWarningsEnabled} onCheckedChange={setRconWarningsEnabled} />
              <Label className="text-sm">{rconWarningsEnabled ? "RCON warnings enabled — players see progress in-game" : "RCON warnings disabled"}</Label>
            </div>
            {rconWarningsEnabled && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Message Template</Label>
                  <textarea
                    value={rconWarningMessage}
                    onChange={(e) => setRconWarningMessage(e.target.value)}
                    rows={2}
                    className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80"
                    style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
                  />
                  <p className="text-[10px] text-muted-foreground/70">
                    Variables: {"{progress}"} {"{points}"} {"{required}"} {"{player_name}"}
                  </p>
                </div>
                <p className="text-[10px] text-muted-foreground/70">Players receive in-game warnings at 10%, 25%, 50%, 75%, and 100% milestones.</p>
              </>
            )}
          </Card>

          {/* Tracking Mode */}
          <Card title="Point Management">
            <div className="space-y-3">
              <div className="flex gap-2">
                <button
                  onClick={() => setTrackingMode("fixed_reset")}
                  className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "fixed_reset" ? "border-white/20" : "border-white/[0.06] bg-white/[0.01] opacity-60"}`}
                  style={trackingMode === "fixed_reset" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}
                >
                  <p className="text-xs font-medium text-white/80">Fixed Reset</p>
                  <p className="text-[10px] text-muted-foreground">Points reset on a schedule (daily, weekly, monthly)</p>
                </button>
                <button
                  onClick={() => setTrackingMode("daily_decay")}
                  className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "daily_decay" ? "border-white/20" : "border-white/[0.06] bg-white/[0.01] opacity-60"}`}
                  style={trackingMode === "daily_decay" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}
                >
                  <p className="text-xs font-medium text-white/80">Daily Decay</p>
                  <p className="text-[10px] text-muted-foreground">Points decrease when players stop seeding</p>
                </button>
              </div>

              {trackingMode === "fixed_reset" && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Reset Frequency</Label>
                      <Sel value={resetFrequency} onChange={setResetFrequency}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="custom">Custom (advanced)</option>
                      </Sel>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Reset Time</Label>
                      <div className="flex gap-1.5">
                        <Input type="number" min={1} max={12} value={resetHour} onChange={(e) => setResetHour(e.target.value)} className="h-8 text-xs w-16" />
                        <span className="text-muted-foreground text-xs self-center">:</span>
                        <Input type="number" min={0} max={59} value={resetMinute} onChange={(e) => setResetMinute(e.target.value)} className="h-8 text-xs w-16" />
                        <Sel value={resetAmPm} onChange={setResetAmPm} className="w-20"><option value="AM">AM</option><option value="PM">PM</option></Sel>
                      </div>
                    </div>
                  </div>
                  {resetFrequency === "weekly" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Day of Week</Label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAYS_OF_WEEK.map((day, idx) => (
                          <button key={day} onClick={() => setResetDayOfWeek(String(idx))}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${String(idx) === resetDayOfWeek ? "text-black" : "bg-white/[0.04] border border-white/[0.08] text-white/60 hover:bg-white/[0.08]"}`}
                            style={String(idx) === resetDayOfWeek ? { background: "var(--accent-primary)" } : undefined}
                          >{day.slice(0, 3)}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {resetFrequency === "monthly" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Day of Month</Label>
                      <Input type="number" min={1} max={28} value={resetDayOfMonth} onChange={(e) => setResetDayOfMonth(e.target.value)} className="h-8 text-xs w-20" />
                    </div>
                  )}
                  {resetFrequency === "custom" && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Cron Expression</Label>
                      <Input value={customCron} onChange={(e) => setCustomCron(e.target.value)} placeholder="0 0 * * *" className="h-8 text-xs font-mono" />
                    </div>
                  )}
                  <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                    <p className="text-xs text-white/70">{cronToReadable(currentCron)}</p>
                  </div>
                </div>
              )}

              {trackingMode === "daily_decay" && (
                <div className="space-y-3 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Days before decay starts</Label>
                      <Input type="number" min={1} max={30} value={decayDaysThreshold} onChange={(e) => setDecayDaysThreshold(e.target.value)} className="h-8 text-xs" />
                      <p className="text-[10px] text-muted-foreground/70">After this many days without seeding, points start decaying</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Points lost per day</Label>
                      <Input type="number" min={1} max={1000} value={decayPointsPerDay} onChange={(e) => setDecayPointsPerDay(e.target.value)} className="h-8 text-xs" />
                      <p className="text-[10px] text-muted-foreground/70">Points removed each day of inactivity (floor: 0)</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>

          <Button onClick={handleSave} disabled={save.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Reward Settings
          </Button>
        </TabsContent>

        {/* ── Leaderboard Tab ────────────────────────────────────────── */}
        <TabsContent value="leaderboard" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
              <h2 className="text-sm font-semibold text-white/80">Seeding Leaderboard</h2>
              <span className="text-xs text-muted-foreground"><Users className="h-3 w-3 inline mr-1" />{leaderboard.length}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowGrantDialog(true)}><Plus className="mr-1 h-3 w-3" /> Grant</Button>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" size="sm" className="h-7 text-xs" disabled={resetPoints.isPending} />}>
                  {resetPoints.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />} Reset All
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader><AlertDialogTitle>Reset all seeding points?</AlertDialogTitle><AlertDialogDescription>All points set to zero. Existing whitelist rewards remain until they expire.</AlertDialogDescription></AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleReset} className="bg-red-600 hover:bg-red-700">Reset All</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Public toggle */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white/80">Make leaderboard public</p>
              <p className="text-[10px] text-muted-foreground">Non-admin users can view at /seeding/leaderboard</p>
            </div>
            <div className="flex items-center gap-3">
              {leaderboardPublic && <Link href="/seeding/leaderboard" className="text-xs flex items-center gap-1 hover:underline" style={{ color: "var(--accent-primary)" }}>View <ExternalLink className="h-3 w-3" /></Link>}
              <Switch checked={leaderboardPublic} onCheckedChange={(v) => { setLeaderboardPublic(v); save.mutateAsync({ ...buildPayload(), leaderboard_public: v }).then(() => toast.success(v ? "Leaderboard public" : "Leaderboard private")).catch(() => toast.error("Failed")); }} />
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={leaderboardSearch} onChange={(e) => setLeaderboardSearch(e.target.value)} placeholder="Search by player name or Steam ID..." className="h-8 text-xs pl-9" />
          </div>

          {/* Grant dialog */}
          {showGrantDialog && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white/80">Grant Points</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Steam64 ID</Label>
                  <Input value={grantSteamId} onChange={(e) => setGrantSteamId(e.target.value)} placeholder="76561198012345678" className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Points</Label>
                  <Input type="number" min={1} max={10000} value={grantPointsVal} onChange={(e) => setGrantPointsVal(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleGrant} disabled={grantPoints.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold text-xs">
                  {grantPoints.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />} Grant
                </Button>
                <Button variant="outline" className="text-xs" onClick={() => setShowGrantDialog(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Leaderboard list */}
          {filteredLeaderboard.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">
              {leaderboardSearch ? "No players match your search." : "No seeding data yet. Points appear once players start seeding."}
            </p>
          ) : (
            <div className="space-y-2">
              {filteredLeaderboard.map((player, idx) => (
                <div key={player.steam_id} className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                  <span className="text-xs font-bold text-white/40 w-6 text-right">{idx + 1}</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white/80 truncate">{player.player_name ?? player.steam_id}</span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono">{player.steam_id}</span>
                      {player.rewarded && <Badge variant="default" className="text-[9px] px-1.5 py-0" style={{ background: "var(--accent-primary)", color: "black" }}>Rewarded</Badge>}
                    </div>
                    <ProgressBar pct={player.progress_pct} />
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-semibold text-white/70">{player.points}/{lbRequired}</span>
                    <span className="block text-[10px] text-muted-foreground">{player.progress_pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── How It Works Tab ───────────────────────────────────────── */}
        <TabsContent value="guide" className="space-y-4">
          <Card title="What is Seeding?">
            <p className="text-xs text-muted-foreground leading-relaxed">Seeding is when players join a game server during low-population periods to help it fill up. Without seeders, servers stay empty. This module rewards players who contribute to server population growth by automatically granting them whitelist access (reserved slots).</p>
          </Card>
          <Card title="How Points Accumulate">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>The seeding service connects to SquadJS and monitors player counts in real-time. Every <strong className="text-white/70">60 seconds</strong> it checks:</p>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li>Is the player count between the <strong className="text-white/70">min</strong> and <strong className="text-white/70">max</strong> thresholds?</li>
                <li>If yes, the server is in <strong className="text-white/70">seeding mode</strong></li>
                <li>Each online player earns <strong className="text-white/70">1 point per minute</strong></li>
              </ul>
              <p>Points stop when the server goes above the threshold (seeding was successful).</p>
            </div>
          </Card>
          <Card title="When Rewards Are Granted">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>When a player reaches the required points, they <strong className="text-white/70">automatically</strong> receive:</p>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li>A whitelist entry on the configured whitelist</li>
                <li>The configured permission group (e.g., reserved slot)</li>
                <li>Access for the configured duration</li>
              </ul>
              <p>No manual intervention needed. The reward appears on the next whitelist refresh.</p>
            </div>
          </Card>
          <Card title="How Resets Work">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p><strong className="text-white/70">Fixed Reset</strong> (current mode): All points reset to zero on the configured schedule (daily, weekly, or monthly). Players earn fresh rewards each cycle.</p>
              <p>Existing whitelist rewards are <strong className="text-white/70">not affected</strong> by resets. They remain until their expiry date.</p>
              <p className="text-muted-foreground/50"><em>Incremental decay mode coming soon — points gradually decrease when not seeding.</em></p>
            </div>
          </Card>
          <Card title="Safety Protections">
            <ul className="list-disc list-inside space-y-1 pl-2 text-xs text-muted-foreground leading-relaxed">
              <li>Reward groups validated to only contain <strong className="text-white/70">safe permissions</strong> (reserve, balance, teamchange)</li>
              <li>Dangerous permissions (ban, kick, admin) are <strong className="text-white/70">blocked</strong></li>
              <li>All reward grants logged in the <strong className="text-white/70">audit log</strong></li>
              <li>Service runs in <strong className="text-white/70">isolation</strong> — crashes don&apos;t affect whitelist management</li>
            </ul>
          </Card>
          <Card title="FAQ">
            <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
              <div><p className="font-medium text-white/70">What if a player disconnects?</p><p>Points are tied to Steam ID. Reconnecting resumes accumulation from where they left off.</p></div>
              <div><p className="font-medium text-white/70">Do AFK players earn points?</p><p>Yes — the system tracks server presence, not activity. SquadJS auto-kick for AFK will stop point earning.</p></div>
              <div><p className="font-medium text-white/70">Can I manually grant or reset points?</p><p>Yes — use Grant and Reset All on the Leaderboard tab. Both are logged in the audit trail.</p></div>
              <div><p className="font-medium text-white/70">What happens when a reward expires?</p><p>The whitelist entry is set to expired and removed from the server file. The player can earn a new reward by seeding again.</p></div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
