"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Settings2,
  Plug,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Trash2,
  HelpCircle,
  Bell,
  Users,
  ExternalLink,
} from "lucide-react";
import {
  useSeedingConfig,
  useSaveSeedingConfig,
  useDeleteSeedingConfig,
  useTestSeedingConnection,
} from "@/hooks/use-settings";
import { useSession } from "@/hooks/use-session";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import type { SeedingConfig } from "@/lib/types";

const MASKED = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

const STATUS_COLORS: Record<string, string> = {
  green: "#10b981",
  yellow: "#eab308",
  red: "#ef4444",
  grey: "#6b7280",
};

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
        "Verify the seeding service is running and healthy",
        "Check that the database connection is configured correctly",
        "Contact your server administrator if this persists",
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
      tips.push("Check the seeding service logs for more details");
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
        "The seeding service may be restarting after a deployment — wait 1-2 minutes",
        "If this persists, check that the seeding service is running and healthy",
        "Contact your server administrator if the issue continues",
      ],
    };
  }
  return { label: "Connected", description: config.last_poll_message ?? "Polling active" };
}

// ─── Shared Components ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full shrink-0 animate-pulse"
      style={{
        background: STATUS_COLORS[status] ?? STATUS_COLORS.grey,
        boxShadow: `0 0 6px ${STATUS_COLORS[status] ?? STATUS_COLORS.grey}`,
      }}
    />
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4 ${className ?? ""}`}>
      <h2 className="text-sm font-semibold text-white/80">{title}</h2>
      {children}
    </div>
  );
}

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseCron(cron: string) {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { frequency: "custom", hour: 12, minute: 0, ampm: "AM", dayOfWeek: 1, dayOfMonth: 1 };
  const [min, hr, dom, , dow] = parts;
  const hour24 = parseInt(hr, 10); const minute = parseInt(min, 10);
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 === 0 ? 12 : hour24 > 12 ? (hour24 - 12) : hour24;
  if (dom !== "*" && dow === "*") return { frequency: "monthly", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: parseInt(dom, 10) || 1 };
  if (dow !== "*" && dom === "*") return { frequency: "weekly", hour, minute, ampm, dayOfWeek: parseInt(dow, 10) || 0, dayOfMonth: 1 };
  if (dom === "*" && dow === "*") return { frequency: "daily", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: 1 };
  return { frequency: "custom", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: 1 };
}
function buildCron(freq: string, hour: number, minute: number, ampm: string, dow: number, dom: number, custom: string): string {
  if (freq === "custom") return custom;
  let h24 = hour % 12; if (ampm === "PM") h24 += 12;
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

function Sel({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={`flex h-8 w-full rounded-md border border-white/[0.08] px-3 text-xs text-white/80 appearance-none cursor-pointer ${className ?? ""}`} style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}>{children}</select>;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SeedingSettingsPage() {
  const { data, isLoading } = useSeedingConfig();
  const save = useSaveSeedingConfig();
  const remove = useDeleteSeedingConfig();
  const testConn = useTestSeedingConnection();

  const existing = data?.config ?? null;
  const connStatus = getConnectionStatus(existing);
  const connDetail = getConnectionDetail(existing);

  // ── Connection form state ──
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3000");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);

  // ── In-Game Notifications ──
  const [rconWarningsEnabled, setRconWarningsEnabled] = useState(false);
  const [rconWarningMessage, setRconWarningMessage] = useState(
    "Seeding Progress: {progress}% ({points}/{required}). Keep seeding!"
  );

  // ── Discord Notifications ──
  const [discordNotifyChannelId, setDiscordNotifyChannelId] = useState("");

  // ── Discord Role Rewards ──
  const [discordRoleRewardEnabled, setDiscordRoleRewardEnabled] = useState(false);
  const [discordRoleRewardId, setDiscordRoleRewardId] = useState("");
  const [discordRemoveRoleOnExpiry, setDiscordRemoveRoleOnExpiry] = useState(true);

  // ── Auto-Seed Alerts ──
  const [autoSeedAlertEnabled, setAutoSeedAlertEnabled] = useState(false);
  const [autoSeedAlertRoleId, setAutoSeedAlertRoleId] = useState("");
  const [autoSeedAlertCooldownMin, setAutoSeedAlertCooldownMin] = useState("30");

  // ── Reward Config ──
  const [seedingHours, setSeedingHours] = useState("2");
  const [seedingMinutes, setSeedingMinutes] = useState("0");
  const [startCount, setStartCount] = useState("2");
  const [threshold, setThreshold] = useState("50");
  const [rewardDurationDays, setRewardDurationDays] = useState("7");
  const [rewardDurationHoursR, setRewardDurationHoursR] = useState("0");
  const [resetFrequency, setResetFrequency] = useState("monthly");
  const [resetHour, setResetHour] = useState("12");
  const [resetMinuteVal, setResetMinuteVal] = useState("0");
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
  const [trackingMode, setTrackingMode] = useState<"fixed_reset" | "daily_decay">("fixed_reset");
  const [decayDaysThreshold, setDecayDaysThreshold] = useState("3");
  const [decayPointsPerDay, setDecayPointsPerDay] = useState("10");

  // ── In-Game Broadcasts ──
  const [rconBroadcastEnabled, setRconBroadcastEnabled] = useState(false);
  const [rconBroadcastMessage, setRconBroadcastMessage] = useState("This server is in seeding mode! Earn whitelist rewards by staying online.");
  const [rconBroadcastInterval, setRconBroadcastInterval] = useState("10");

  // ── Cooldown ──
  const [rewardCooldownHours, setRewardCooldownHours] = useState("0");

  // ── Discord link requirement ──
  const [requireDiscordLink, setRequireDiscordLink] = useState(false);

  // ── Streaks ──
  const [streakEnabled, setStreakEnabled] = useState(false);
  const [streakDaysRequired, setStreakDaysRequired] = useState("3");
  const [streakMultiplier, setStreakMultiplier] = useState("1.5");

  // ── Bonus Multiplier Events ──
  const [bonusMultiplierEnabled, setBonusMultiplierEnabled] = useState(false);
  const [bonusMultiplierValue, setBonusMultiplierValue] = useState("2.0");
  const [bonusMultiplierStart, setBonusMultiplierStart] = useState("");
  const [bonusMultiplierEnd, setBonusMultiplierEnd] = useState("");

  // ── Custom Embeds ──
  const [customEmbedTitle, setCustomEmbedTitle] = useState("");
  const [customEmbedDescription, setCustomEmbedDescription] = useState("");
  const [customEmbedImageUrl, setCustomEmbedImageUrl] = useState("");
  const [customEmbedColor, setCustomEmbedColor] = useState("#10b981");

  // ── Population ──
  const [populationTrackingEnabled, setPopulationTrackingEnabled] = useState(false);

  // ── Public Leaderboard ──
  const [leaderboardPublic, setLeaderboardPublic] = useState(false);

  // ── Load existing config ──
  useEffect(() => {
    if (!existing) return;
    setHost(existing.squadjs_host);
    setPort(String(existing.squadjs_port));
    setToken(MASKED);
    setEnabled(existing.enabled);
    setRconWarningsEnabled(existing.rcon_warnings_enabled);
    setRconWarningMessage(existing.rcon_warning_message);
    setLeaderboardPublic(existing.leaderboard_public);

    // Reward config
    const pts = existing.points_required;
    setSeedingHours(String(Math.floor(pts / 60))); setSeedingMinutes(String(pts % 60));
    setStartCount(String(existing.seeding_start_player_count)); setThreshold(String(existing.seeding_player_threshold));
    const durH = existing.reward_duration_hours;
    setRewardDurationDays(String(Math.floor(durH / 24))); setRewardDurationHoursR(String(durH % 24));
    setWindowEnabled(existing.seeding_window_enabled);
    setWindowStart(existing.seeding_window_start); setWindowEnd(existing.seeding_window_end);
    if (existing.reward_tiers?.length) {
      setTiersEnabled(true);
      setTiers(existing.reward_tiers.map((t) => ({ label: t.label, hours: String(Math.floor(t.points / 60)), minutes: String(t.points % 60), durationHours: String(t.duration_hours) })));
    }
    setTrackingMode(existing.tracking_mode);
    setDecayDaysThreshold(String(existing.decay_days_threshold)); setDecayPointsPerDay(String(existing.decay_points_per_day));
    const p = parseCron(existing.reset_cron);
    setResetFrequency(p.frequency); setResetHour(String(p.hour)); setResetMinuteVal(String(p.minute));
    setResetAmPm(p.ampm); setResetDayOfWeek(String(p.dayOfWeek)); setResetDayOfMonth(String(p.dayOfMonth));
    if (p.frequency === "custom") setCustomCron(existing.reset_cron);

    // New features
    setRconBroadcastEnabled(existing.rcon_broadcast_enabled);
    setRconBroadcastMessage(existing.rcon_broadcast_message);
    setRconBroadcastInterval(String(existing.rcon_broadcast_interval_min));
    setRewardCooldownHours(String(existing.reward_cooldown_hours));
    setRequireDiscordLink(existing.require_discord_link);
    setStreakEnabled(existing.streak_enabled);
    setStreakDaysRequired(String(existing.streak_days_required));
    setStreakMultiplier(String(existing.streak_multiplier));
    setBonusMultiplierEnabled(existing.bonus_multiplier_enabled);
    setBonusMultiplierValue(String(existing.bonus_multiplier_value));
    if (existing.bonus_multiplier_start) setBonusMultiplierStart(existing.bonus_multiplier_start.slice(0, 16));
    if (existing.bonus_multiplier_end) setBonusMultiplierEnd(existing.bonus_multiplier_end.slice(0, 16));
    if (existing.custom_embed_title) setCustomEmbedTitle(existing.custom_embed_title);
    if (existing.custom_embed_description) setCustomEmbedDescription(existing.custom_embed_description);
    if (existing.custom_embed_image_url) setCustomEmbedImageUrl(existing.custom_embed_image_url);
    if (existing.custom_embed_color) setCustomEmbedColor(existing.custom_embed_color);
    setPopulationTrackingEnabled(existing.population_tracking_enabled);

    if (existing.discord_notify_channel_id) setDiscordNotifyChannelId(existing.discord_notify_channel_id);
    setDiscordRoleRewardEnabled(existing.discord_role_reward_enabled);
    if (existing.discord_role_reward_id) setDiscordRoleRewardId(existing.discord_role_reward_id);
    setDiscordRemoveRoleOnExpiry(existing.discord_remove_role_on_expiry);
    setAutoSeedAlertEnabled(existing.auto_seed_alert_enabled);
    if (existing.auto_seed_alert_role_id) setAutoSeedAlertRoleId(existing.auto_seed_alert_role_id);
    setAutoSeedAlertCooldownMin(String(existing.auto_seed_alert_cooldown_min));
  }, [existing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build payload ──
  function buildPayload() {
    const pts = (parseInt(seedingHours, 10) || 0) * 60 + (parseInt(seedingMinutes, 10) || 0);
    const cron = buildCron(resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinuteVal, 10) || 0, resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron);
    return {
      squadjs_host: host.trim(),
      squadjs_port: parseInt(port, 10) || 3000,
      squadjs_token: token === MASKED ? MASKED : token,
      enabled,
      // Reward config
      seeding_start_player_count: parseInt(startCount, 10) || 2,
      seeding_player_threshold: parseInt(threshold, 10) || 50,
      points_required: pts || 120,
      reward_duration_hours: (parseInt(rewardDurationDays, 10) || 0) * 24 + (parseInt(rewardDurationHoursR, 10) || 0),
      seeding_window_enabled: windowEnabled,
      seeding_window_start: windowStart,
      seeding_window_end: windowEnd,
      reward_tiers: tiersEnabled ? tiers.map((t) => ({ points: (parseInt(t.hours, 10) || 0) * 60 + (parseInt(t.minutes, 10) || 0), duration_hours: parseInt(t.durationHours, 10) || 24, label: t.label.trim() || "Tier" })) : null,
      tracking_mode: trackingMode,
      reset_cron: cron,
      decay_days_threshold: parseInt(decayDaysThreshold, 10) || 3,
      decay_points_per_day: parseInt(decayPointsPerDay, 10) || 10,
      // Cooldown + streaks + multipliers
      reward_cooldown_hours: parseInt(rewardCooldownHours, 10) || 0,
      require_discord_link: requireDiscordLink,
      streak_enabled: streakEnabled,
      streak_days_required: parseInt(streakDaysRequired, 10) || 3,
      streak_multiplier: parseFloat(streakMultiplier) || 1.5,
      bonus_multiplier_enabled: bonusMultiplierEnabled,
      bonus_multiplier_value: parseFloat(bonusMultiplierValue) || 2.0,
      bonus_multiplier_start: bonusMultiplierStart ? new Date(bonusMultiplierStart).toISOString() : null,
      bonus_multiplier_end: bonusMultiplierEnd ? new Date(bonusMultiplierEnd).toISOString() : null,
      // Notifications
      rcon_broadcast_enabled: rconBroadcastEnabled,
      rcon_broadcast_message: rconBroadcastMessage,
      rcon_broadcast_interval_min: parseInt(rconBroadcastInterval, 10) || 10,
      rcon_warnings_enabled: rconWarningsEnabled,
      rcon_warning_message: rconWarningMessage,
      leaderboard_public: leaderboardPublic,
      discord_notify_channel_id: discordNotifyChannelId.trim() || null,
      discord_role_reward_enabled: discordRoleRewardEnabled,
      discord_role_reward_id: discordRoleRewardId.trim() || null,
      discord_remove_role_on_expiry: discordRemoveRoleOnExpiry,
      auto_seed_alert_enabled: autoSeedAlertEnabled,
      auto_seed_alert_role_id: autoSeedAlertRoleId.trim() || null,
      auto_seed_alert_cooldown_min: parseInt(autoSeedAlertCooldownMin, 10) || 30,
      // Custom embeds + population
      custom_embed_title: customEmbedTitle.trim() || null,
      custom_embed_description: customEmbedDescription.trim() || null,
      custom_embed_image_url: customEmbedImageUrl.trim() || null,
      custom_embed_color: customEmbedColor.trim() || null,
      population_tracking_enabled: populationTrackingEnabled,
    };
  }

  async function handleSave() {
    if (!host) {
      toast.error("SquadJS host is required");
      return;
    }
    if (!existing && (!token || token === MASKED)) {
      toast.error("SquadJS token is required");
      return;
    }
    try {
      await save.mutateAsync(buildPayload());
      toast.success("Configuration saved");
    } catch {
      toast.error("Failed to save");
    }
  }

  async function handleTest() {
    if (!host) {
      toast.error("Enter SquadJS host first");
      return;
    }
    const p = buildPayload();
    if (p.squadjs_token === MASKED) delete (p as Record<string, unknown>).squadjs_token;
    try {
      const r = await testConn.mutateAsync(p);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch {
      toast.error("Test failed");
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync();
      toast.success("Configuration removed");
      setHost("");
      setPort("3000");
      setToken("");
      setEnabled(false);
    } catch {
      toast.error("Failed to remove");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Settings2 className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white/90">Seeding Settings</h1>
            <StatusDot status={connStatus} />
            <span className="text-xs text-muted-foreground">{connDetail.label}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Connection, notifications, and Discord integration
          </p>
        </div>
        {existing && (
          <Badge
            variant={existing.enabled ? "default" : "secondary"}
            className="text-[10px] shrink-0"
          >
            {existing.enabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      {/* A. Connection Status */}
      <div
        className={`rounded-xl border px-5 py-4 space-y-3 ${
          connStatus === "red"
            ? "border-red-500/20 bg-red-500/5"
            : connStatus === "yellow"
              ? "border-yellow-500/20 bg-yellow-500/5"
              : connStatus === "green"
                ? "border-emerald-500/20 bg-emerald-500/5"
                : "border-white/[0.08] bg-white/[0.02]"
        }`}
      >
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

      {/* B. SquadJS Connection */}
      <Card title="SquadJS Connection">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Host</Label>
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="your-squadjs-host.com"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="3000"
              className="h-8 text-xs"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Token</Label>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={existing ? "Leave blank to keep current" : "SquadJS auth token"}
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label className="text-sm">
            {enabled ? "Seeding tracker enabled" : "Seeding tracker disabled"}
          </Label>
        </div>
      </Card>

      {/* ── Reward Configuration ───────────────────────────────────────── */}

      <Card title="Reward Tiers">
        <div className="flex items-center gap-3 mb-2">
          <Switch checked={tiersEnabled} onCheckedChange={setTiersEnabled} />
          <Label className="text-sm">{tiersEnabled ? "Tiered rewards — multiple levels" : "Single reward — one threshold"}</Label>
        </div>
        {tiersEnabled ? (
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 text-[10px] text-muted-foreground font-medium uppercase tracking-wide px-1">
              <span>Label</span><span>Hours</span><span>Min</span><span>Duration (h)</span><span></span>
            </div>
            {tiers.map((tier, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 items-center">
                <Input value={tier.label} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], label: e.target.value }; setTiers(t); }} className="h-8 text-xs" />
                <Input type="number" min={0} max={166} value={tier.hours} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], hours: e.target.value }; setTiers(t); }} className="h-8 text-xs w-16" />
                <Input type="number" min={0} max={59} value={tier.minutes} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], minutes: e.target.value }; setTiers(t); }} className="h-8 text-xs w-16" />
                <Input type="number" min={1} max={8760} value={tier.durationHours} onChange={(e) => { const t = [...tiers]; t[idx] = { ...t[idx], durationHours: e.target.value }; setTiers(t); }} className="h-8 text-xs w-20" />
                {tiers.length > 2 && <button onClick={() => setTiers(tiers.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 text-xs px-1">x</button>}
              </div>
            ))}
            {tiers.length < 5 && <button onClick={() => setTiers([...tiers, { label: `Tier ${tiers.length + 1}`, hours: "0", minutes: "0", durationHours: "24" }])} className="text-xs hover:underline" style={{ color: "var(--accent-primary)" }}>+ Add tier</button>}
          </div>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Hours</Label><Input type="number" min={0} max={166} value={seedingHours} onChange={(e) => setSeedingHours(e.target.value)} className="h-8 text-xs w-20" /></div>
              <span className="text-xs text-muted-foreground pb-2">h</span>
              <div className="space-y-1"><Label className="text-xs text-muted-foreground">Minutes</Label><Input type="number" min={0} max={59} value={seedingMinutes} onChange={(e) => setSeedingMinutes(e.target.value)} className="h-8 text-xs w-20" /></div>
              <span className="text-xs text-muted-foreground pb-2">m required</span>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reward Duration</Label>
              <div className="flex items-end gap-2">
                <div className="space-y-1"><Label className="text-[10px] text-muted-foreground/70">Days</Label><Input type="number" min={0} max={365} value={rewardDurationDays} onChange={(e) => setRewardDurationDays(e.target.value)} className="h-8 text-xs w-20" /></div>
                <div className="space-y-1"><Label className="text-[10px] text-muted-foreground/70">Hours</Label><Input type="number" min={0} max={23} value={rewardDurationHoursR} onChange={(e) => setRewardDurationHoursR(e.target.value)} className="h-8 text-xs w-20" /></div>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card title="Seeding Thresholds">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Min Players</Label><Input type="number" min={1} max={100} value={startCount} onChange={(e) => setStartCount(e.target.value)} className="h-8 text-xs" /></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Max Players</Label><Input type="number" min={2} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-xs" /></div>
        </div>
        <p className="text-[10px] text-muted-foreground/70">Seeding mode active when server has {startCount} to {threshold} players</p>
      </Card>

      <Card title="Seeding Time Window">
        <div className="flex items-center gap-3 mb-2">
          <Switch checked={windowEnabled} onCheckedChange={setWindowEnabled} />
          <Label className="text-sm">{windowEnabled ? "Only track during set hours" : "Track 24/7"}</Label>
        </div>
        {windowEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Start</Label><Input type="time" value={windowStart} onChange={(e) => setWindowStart(e.target.value)} className="h-8 text-xs" style={{ colorScheme: "dark" }} /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">End</Label><Input type="time" value={windowEnd} onChange={(e) => setWindowEnd(e.target.value)} className="h-8 text-xs" style={{ colorScheme: "dark" }} /></div>
          </div>
        )}
      </Card>

      <Card title="Point Management">
        <div className="flex gap-2">
          <button onClick={() => setTrackingMode("fixed_reset")} className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "fixed_reset" ? "border-white/20" : "border-white/[0.06] opacity-60"}`} style={trackingMode === "fixed_reset" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}>
            <p className="text-xs font-medium text-white/80">Fixed Reset</p><p className="text-[10px] text-muted-foreground">Reset on schedule</p>
          </button>
          <button onClick={() => setTrackingMode("daily_decay")} className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "daily_decay" ? "border-white/20" : "border-white/[0.06] opacity-60"}`} style={trackingMode === "daily_decay" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}>
            <p className="text-xs font-medium text-white/80">Daily Decay</p><p className="text-[10px] text-muted-foreground">Points decrease when inactive</p>
          </button>
        </div>
        {trackingMode === "fixed_reset" && (() => { const currentCron = buildCron(resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinuteVal, 10) || 0, resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron); return (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Frequency</Label><Sel value={resetFrequency} onChange={setResetFrequency}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></Sel></div>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Time</Label><div className="flex gap-1.5"><Input type="number" min={1} max={12} value={resetHour} onChange={(e) => setResetHour(e.target.value)} className="h-8 text-xs w-16" /><span className="text-muted-foreground text-xs self-center">:</span><Input type="number" min={0} max={59} value={resetMinuteVal} onChange={(e) => setResetMinuteVal(e.target.value)} className="h-8 text-xs w-16" /><Sel value={resetAmPm} onChange={setResetAmPm} className="w-20"><option value="AM">AM</option><option value="PM">PM</option></Sel></div></div>
            </div>
            {resetFrequency === "weekly" && <div className="flex gap-1.5 flex-wrap">{DAYS_OF_WEEK.map((day, idx) => <button key={day} onClick={() => setResetDayOfWeek(String(idx))} className={`px-3 py-1.5 rounded-md text-xs font-medium ${String(idx) === resetDayOfWeek ? "text-black" : "bg-white/[0.04] border border-white/[0.08] text-white/60"}`} style={String(idx) === resetDayOfWeek ? { background: "var(--accent-primary)" } : undefined}>{day.slice(0, 3)}</button>)}</div>}
            {resetFrequency === "monthly" && <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Day</Label><Input type="number" min={1} max={28} value={resetDayOfMonth} onChange={(e) => setResetDayOfMonth(e.target.value)} className="h-8 text-xs w-20" /></div>}
            {resetFrequency === "custom" && <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Cron</Label><Input value={customCron} onChange={(e) => setCustomCron(e.target.value)} className="h-8 text-xs font-mono" /></div>}
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2"><p className="text-xs text-white/70">{cronToReadable(currentCron)}</p></div>
          </div>
        ); })()}
        {trackingMode === "daily_decay" && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Days before decay</Label><Input type="number" min={1} max={30} value={decayDaysThreshold} onChange={(e) => setDecayDaysThreshold(e.target.value)} className="h-8 text-xs" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Points lost per day</Label><Input type="number" min={1} max={1000} value={decayPointsPerDay} onChange={(e) => setDecayPointsPerDay(e.target.value)} className="h-8 text-xs" /></div>
          </div>
        )}
      </Card>

      {/* ── Advanced Reward Features ─────────────────────────────────── */}

      <Card title="Reward Cooldown">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cooldown (hours)</Label>
            <Input type="number" min={0} max={720} value={rewardCooldownHours} onChange={(e) => setRewardCooldownHours(e.target.value)} className="h-8 text-xs" />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          {parseInt(rewardCooldownHours, 10) > 0
            ? `After earning a reward, players must wait ${rewardCooldownHours} hours before earning again.`
            : "No cooldown — players can earn again immediately after being rewarded."}
        </p>
      </Card>

      <Card title="Discord Link Requirement">
        <div className="flex items-center gap-3 mb-2">
          <Switch checked={requireDiscordLink} onCheckedChange={setRequireDiscordLink} />
          <Label className="text-sm">
            {requireDiscordLink ? "Discord link required for rewards" : "Discord link not required"}
          </Label>
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          {requireDiscordLink
            ? "Players must link their Discord to their Steam ID before receiving seeding rewards. Points still accumulate normally. Players can link via the bot /whitelist command, the web dashboard, or a Discord panel button."
            : "Rewards are granted automatically by Steam ID. Players do not need to join Discord or link accounts."}
        </p>
      </Card>

      <Card title="Streak Bonuses">
        <div className="flex items-center gap-3 mb-2">
          <Switch checked={streakEnabled} onCheckedChange={setStreakEnabled} />
          <Label className="text-sm">{streakEnabled ? "Streak bonuses enabled" : "Streak bonuses disabled"}</Label>
        </div>
        {streakEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Days required for streak</Label>
              <Input type="number" min={2} max={30} value={streakDaysRequired} onChange={(e) => setStreakDaysRequired(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Point multiplier</Label>
              <Input type="number" min={1.1} max={5} step={0.1} value={streakMultiplier} onChange={(e) => setStreakMultiplier(e.target.value)} className="h-8 text-xs" />
            </div>
          </div>
        )}
        {streakEnabled && (
          <p className="text-[10px] text-muted-foreground/70">
            Players who seed {streakDaysRequired} days in a row earn {streakMultiplier}x points.
          </p>
        )}
      </Card>

      <Card title="Bonus Multiplier Event">
        <div className="flex items-center gap-3 mb-2">
          <Switch checked={bonusMultiplierEnabled} onCheckedChange={setBonusMultiplierEnabled} />
          <Label className="text-sm">{bonusMultiplierEnabled ? "Event active — bonus points!" : "No active event"}</Label>
        </div>
        {bonusMultiplierEnabled && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Multiplier</Label>
              <Sel value={bonusMultiplierValue} onChange={setBonusMultiplierValue}>
                <option value="1.5">1.5x</option>
                <option value="2">2x (Double)</option>
                <option value="3">3x (Triple)</option>
                <option value="5">5x</option>
              </Sel>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Start</Label>
                <Input type="datetime-local" value={bonusMultiplierStart} onChange={(e) => setBonusMultiplierStart(e.target.value)} className="h-8 text-xs" style={{ colorScheme: "dark" }} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">End</Label>
                <Input type="datetime-local" value={bonusMultiplierEnd} onChange={(e) => setBonusMultiplierEnd(e.target.value)} className="h-8 text-xs" style={{ colorScheme: "dark" }} />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              All seeding points are multiplied by {bonusMultiplierValue}x during this period. Great for events and server launches.
            </p>
          </div>
        )}
      </Card>

      <Card title="Population Tracking">
        <div className="flex items-center gap-3">
          <Switch checked={populationTrackingEnabled} onCheckedChange={setPopulationTrackingEnabled} />
          <Label className="text-sm">{populationTrackingEnabled ? "Tracking player counts for analytics" : "Population tracking disabled"}</Label>
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          Stores server player count on every poll. Data is kept for 7 days and will power population graphs in a future update.
        </p>
      </Card>

      {/* ── Notifications ──────────────────────────────────────────────── */}

      <Card title="In-Game Seeding Broadcasts">
        <div className="flex items-center gap-3 mb-2">
          <Switch checked={rconBroadcastEnabled} onCheckedChange={setRconBroadcastEnabled} />
          <Label className="text-sm">{rconBroadcastEnabled ? "Broadcasts enabled" : "Broadcasts disabled"}</Label>
        </div>
        {rconBroadcastEnabled && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Broadcast message</Label>
              <textarea
                value={rconBroadcastMessage}
                onChange={(e) => setRconBroadcastMessage(e.target.value)}
                rows={2}
                className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80 resize-none"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
              />
              <p className="text-[10px] text-muted-foreground/70">Variables: {"{player_count}"} {"{threshold}"}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Interval (minutes)</Label>
              <Input type="number" min={5} max={60} value={rconBroadcastInterval} onChange={(e) => setRconBroadcastInterval(e.target.value)} className="h-8 text-xs w-20" />
              <p className="text-[10px] text-muted-foreground/70">How often to send the broadcast to all online players during seeding mode.</p>
            </div>
          </div>
        )}
      </Card>

      {/* C. In-Game Milestone Notifications */}
      <Card title="In-Game Notifications">
        <div className="flex items-center gap-3">
          <Switch checked={rconWarningsEnabled} onCheckedChange={setRconWarningsEnabled} />
          <Label className="text-sm">
            {rconWarningsEnabled ? "RCON warnings enabled" : "RCON warnings disabled"}
          </Label>
        </div>

        {rconWarningsEnabled && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Message template</Label>
              <textarea
                value={rconWarningMessage}
                onChange={(e) => setRconWarningMessage(e.target.value)}
                rows={3}
                className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none"
                style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
                placeholder="Seeding Progress: {progress}% ({points}/{required}). Keep seeding!"
              />
            </div>
            <div className="rounded-lg bg-black/20 border border-white/[0.06] px-4 py-3 space-y-1.5">
              <p className="text-[10px] font-medium text-white/50 uppercase tracking-wide">
                Available variables
              </p>
              <div className="flex flex-wrap gap-1.5">
                {["{progress}", "{points}", "{required}", "{player_name}"].map((v) => (
                  <code
                    key={v}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60 font-mono"
                  >
                    {v}
                  </code>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">
                Warnings are sent at milestones: 10%, 25%, 50%, 75%, and 100%
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* D. Discord Notifications */}
      <Card title="Discord Notifications">
        <div className="flex items-center gap-2 mb-1">
          <Bell className="h-4 w-4 text-white/40" />
          <span className="text-xs text-white/60">
            Seeding events will be posted to this channel
          </span>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Notification channel ID</Label>
          <Input
            value={discordNotifyChannelId}
            onChange={(e) => setDiscordNotifyChannelId(e.target.value)}
            placeholder="Discord channel ID"
            className="h-8 text-xs"
          />
        </div>
        <p className="text-[10px] text-muted-foreground/60">
          Enable Developer Mode in Discord, right-click a channel, and select "Copy Channel ID"
        </p>
      </Card>

      {/* Custom Discord Embeds */}
      <Card title="Custom Discord Embeds">
        <p className="text-[10px] text-muted-foreground/70 mb-2">
          Customize the Discord notification for &quot;Server Is Live&quot; events. Leave blank for defaults.
        </p>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Embed Title</Label>
            <Input value={customEmbedTitle} onChange={(e) => setCustomEmbedTitle(e.target.value)} placeholder="Server Is Live!" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Embed Description</Label>
            <textarea
              value={customEmbedDescription}
              onChange={(e) => setCustomEmbedDescription(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80 resize-none"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
              placeholder="Server has reached {player_count} players!"
            />
            <p className="text-[10px] text-muted-foreground/70">Variables: {"{player_count}"} {"{threshold}"}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Image URL</Label>
              <Input value={customEmbedImageUrl} onChange={(e) => setCustomEmbedImageUrl(e.target.value)} placeholder="https://..." className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Color</Label>
              <div className="flex gap-2 items-center">
                <input type="color" value={customEmbedColor} onChange={(e) => setCustomEmbedColor(e.target.value)} className="h-8 w-10 rounded border border-white/[0.08] cursor-pointer" style={{ backgroundColor: "transparent" }} />
                <Input value={customEmbedColor} onChange={(e) => setCustomEmbedColor(e.target.value)} placeholder="#10b981" className="h-8 text-xs font-mono flex-1" />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* E. Discord Role Rewards */}
      <Card title="Discord Role Rewards">
        <div className="flex items-center gap-3">
          <Switch checked={discordRoleRewardEnabled} onCheckedChange={setDiscordRoleRewardEnabled} />
          <Label className="text-sm">
            {discordRoleRewardEnabled
              ? "Role rewards enabled"
              : "Role rewards disabled"}
          </Label>
        </div>

        {discordRoleRewardEnabled && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reward role ID</Label>
              <Input
                value={discordRoleRewardId}
                onChange={(e) => setDiscordRoleRewardId(e.target.value)}
                placeholder="Discord role ID"
                className="h-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                checked={discordRemoveRoleOnExpiry}
                onCheckedChange={setDiscordRemoveRoleOnExpiry}
              />
              <Label className="text-sm">
                Remove role when reward expires
              </Label>
            </div>

            <div className="rounded-lg bg-black/20 border border-white/[0.06] px-4 py-3">
              <p className="text-[10px] text-muted-foreground/60">
                When a player reaches the seeding point threshold, they are automatically assigned
                this Discord role. If "remove on expiry" is enabled, the role will be removed once
                their whitelist reward expires.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* F. Auto-Seed Alerts */}
      <Card title="Auto-Seed Alerts">
        <div className="flex items-center gap-3">
          <Switch checked={autoSeedAlertEnabled} onCheckedChange={setAutoSeedAlertEnabled} />
          <Label className="text-sm">
            {autoSeedAlertEnabled
              ? "Auto-seed alerts enabled"
              : "Auto-seed alerts disabled"}
          </Label>
        </div>

        {autoSeedAlertEnabled && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Alert role ID</Label>
              <Input
                value={autoSeedAlertRoleId}
                onChange={(e) => setAutoSeedAlertRoleId(e.target.value)}
                placeholder="Discord role ID to ping"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Cooldown (minutes)</Label>
              <Input
                type="number"
                min={5}
                max={120}
                value={autoSeedAlertCooldownMin}
                onChange={(e) => setAutoSeedAlertCooldownMin(e.target.value)}
                placeholder="30"
                className="h-8 text-xs w-32"
              />
            </div>

            <p className="text-[10px] text-muted-foreground/60">
              Pings this role when server drops below the seeding threshold. Cooldown prevents
              alert spam (min 5 minutes, max 120 minutes).
            </p>
          </div>
        )}
      </Card>

      {/* G. Public Leaderboard */}
      <Card title="Public Leaderboard">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Switch checked={leaderboardPublic} onCheckedChange={setLeaderboardPublic} />
            <Label className="text-sm">
              {leaderboardPublic
                ? "Public leaderboard visible"
                : "Public leaderboard hidden"}
            </Label>
          </div>
          {leaderboardPublic && (
            <Link
              href="/seeding/leaderboard"
              target="_blank"
              className="flex items-center gap-1 text-xs hover:underline"
              style={{ color: "var(--accent-primary)" }}
            >
              View leaderboard <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </Card>

      {/* Save + Test buttons */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={save.isPending}
          style={{ background: "var(--accent-primary)" }}
          className="text-black font-semibold"
        >
          {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {existing ? "Save Changes" : "Connect"}
        </Button>
        <Button variant="outline" onClick={handleTest} disabled={testConn.isPending}>
          {testConn.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Test Connection
        </Button>
      </div>

      {/* H. Danger Zone */}
      {existing && (
        <Card title="Danger Zone" className="border-red-500/20">
          <p className="text-xs text-muted-foreground">
            Removing the configuration will disconnect from SquadJS and stop all seeding tracking.
            Existing rewards and player points are preserved.
          </p>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  disabled={remove.isPending}
                />
              }
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove Configuration
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove seeding configuration?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes your SquadJS connection and stops tracking. Existing rewards and
                  points are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </Card>
      )}
    </div>
  );
}
