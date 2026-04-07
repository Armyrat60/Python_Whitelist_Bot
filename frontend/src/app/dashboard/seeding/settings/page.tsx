"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Settings2,
  Clock,
  Loader2,
  RefreshCw,
  Trash2,
  HelpCircle,
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
import { SeedingCard as Card, Sel } from "@/components/seeding/settings-helpers";
import {
  RewardTiersCard,
  SeedingThresholdsCard,
  TimeWindowCard,
  PointManagementCard,
} from "@/components/seeding/reward-config-section";
import {
  RconBroadcastCard,
  RconWarningsCard,
  DiscordChannelCard,
  CustomEmbedCard,
} from "@/components/seeding/notifications-section";
import {
  DiscordRoleRewardCard,
  AutoSeedAlertCard,
  WebhookCard,
} from "@/components/seeding/discord-integration-section";

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

  // ── Webhooks ──
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");

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
    setWebhookEnabled(existing.webhook_enabled);
    if (existing.webhook_url) setWebhookUrl(existing.webhook_url);

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
      webhook_enabled: webhookEnabled,
      webhook_url: webhookUrl.trim() || null,
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
    <div className="max-w-6xl space-y-6">
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
          <div className="rounded-lg bg-black/20 border border-white/[0.10] px-4 py-3 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-400">
              <HelpCircle className="h-3.5 w-3.5" /> Troubleshooting
            </div>
            <ul className="space-y-1">
              {connDetail.troubleshoot.map((tip, i) => (
                <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-2">
                  <span className="text-white/50 shrink-0">{i + 1}.</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── ① Core + ② Connection ──────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Core">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Toggle the seeding tracker and set the player-count range that defines seeding mode.
          </p>
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Label className="text-sm">
              {enabled ? "Seeding tracker enabled" : "Seeding tracker disabled"}
            </Label>
          </div>
          <div className="pt-2 border-t border-white/[0.06]">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Min players</Label>
                <Input type="number" min={1} max={100} value={startCount} onChange={(e) => setStartCount(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Max players</Label>
                <Input type="number" min={2} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/70 pt-1.5">Seeding mode active between {startCount} – {threshold} players.</p>
          </div>
        </Card>

        <Card title="SquadJS Connection">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Read-only Socket.IO link to your SquadJS instance. Points and player data are pulled from here every minute.
          </p>
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
        </Card>
      </div>

      {/* ── ③ Rewards (full width) ─────────────────────────────────────── */}
      <RewardTiersCard
        tiersEnabled={tiersEnabled} setTiersEnabled={setTiersEnabled}
        tiers={tiers} setTiers={setTiers}
        seedingHours={seedingHours} setSeedingHours={setSeedingHours}
        seedingMinutes={seedingMinutes} setSeedingMinutes={setSeedingMinutes}
        rewardDurationDays={rewardDurationDays} setRewardDurationDays={setRewardDurationDays}
        rewardDurationHoursR={rewardDurationHoursR} setRewardDurationHoursR={setRewardDurationHoursR}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Reward Cooldown">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            How long players must wait between earning rewards. Set to 0 to allow immediate re-earning.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cooldown (hours)</Label>
            <Input type="number" min={0} max={720} value={rewardCooldownHours} onChange={(e) => setRewardCooldownHours(e.target.value)} className="h-8 text-xs w-32" />
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {parseInt(rewardCooldownHours, 10) > 0
              ? `After earning a reward, players must wait ${rewardCooldownHours} hours before earning again.`
              : "No cooldown — players can earn again immediately after being rewarded."}
          </p>
        </Card>

        <Card title="Discord Link Requirement">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Require players to link Discord ↔ Steam before receiving any whitelist reward.
          </p>
          <div className="flex items-center gap-3">
            <Switch checked={requireDiscordLink} onCheckedChange={setRequireDiscordLink} />
            <Label className="text-sm">
              {requireDiscordLink ? "Discord link required" : "Discord link not required"}
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            {requireDiscordLink
              ? "Points still accumulate normally. Players can link via the /whitelist command, web dashboard, or a Discord panel button."
              : "Rewards are granted automatically by Steam ID. Players do not need to join Discord."}
          </p>
        </Card>
      </div>

      {/* ── ④ Point Management + Time Window ──────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PointManagementCard
          trackingMode={trackingMode} setTrackingMode={setTrackingMode}
          resetFrequency={resetFrequency} setResetFrequency={setResetFrequency}
          resetHour={resetHour} setResetHour={setResetHour}
          resetMinuteVal={resetMinuteVal} setResetMinuteVal={setResetMinuteVal}
          resetAmPm={resetAmPm} setResetAmPm={setResetAmPm}
          resetDayOfWeek={resetDayOfWeek} setResetDayOfWeek={setResetDayOfWeek}
          resetDayOfMonth={resetDayOfMonth} setResetDayOfMonth={setResetDayOfMonth}
          customCron={customCron} setCustomCron={setCustomCron}
          decayDaysThreshold={decayDaysThreshold} setDecayDaysThreshold={setDecayDaysThreshold}
          decayPointsPerDay={decayPointsPerDay} setDecayPointsPerDay={setDecayPointsPerDay}
          buildCron={buildCron} cronToReadable={cronToReadable}
        />
        <TimeWindowCard
          windowEnabled={windowEnabled} setWindowEnabled={setWindowEnabled}
          windowStart={windowStart} setWindowStart={setWindowStart}
          windowEnd={windowEnd} setWindowEnd={setWindowEnd}
        />
      </div>

      {/* ── ⑤ Bonuses ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Streak Bonuses">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Reward players who seed multiple days in a row with a points multiplier.
          </p>
          <div className="flex items-center gap-3">
            <Switch checked={streakEnabled} onCheckedChange={setStreakEnabled} />
            <Label className="text-sm">{streakEnabled ? "Streak bonuses enabled" : "Streak bonuses disabled"}</Label>
          </div>
          {streakEnabled && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Days required</Label>
                  <Input type="number" min={2} max={30} value={streakDaysRequired} onChange={(e) => setStreakDaysRequired(e.target.value)} className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Point multiplier</Label>
                  <Input type="number" min={1.1} max={5} step={0.1} value={streakMultiplier} onChange={(e) => setStreakMultiplier(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/70">
                Players who seed {streakDaysRequired} days in a row earn {streakMultiplier}x points
                {Number.isInteger(parseFloat(streakMultiplier)) ? "." : " on average (fractional multipliers round probabilistically each poll)."}
              </p>
            </>
          )}
        </Card>

        <Card title="Bonus Multiplier Event">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Temporarily boost point earn rates for events or server launches.
          </p>
          <div className="flex items-center gap-3">
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
                All seeding points are multiplied by {bonusMultiplierValue}x during this period.
                {!Number.isInteger(parseFloat(bonusMultiplierValue)) && " Fractional multipliers round probabilistically each poll, averaging to the listed rate over time."}
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* ── ⑥ In-Game Messages + ⑦ Discord ─────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <RconBroadcastCard
            rconBroadcastEnabled={rconBroadcastEnabled} setRconBroadcastEnabled={setRconBroadcastEnabled}
            rconBroadcastMessage={rconBroadcastMessage} setRconBroadcastMessage={setRconBroadcastMessage}
            rconBroadcastInterval={rconBroadcastInterval} setRconBroadcastInterval={setRconBroadcastInterval}
          />
          <RconWarningsCard
            rconWarningsEnabled={rconWarningsEnabled} setRconWarningsEnabled={setRconWarningsEnabled}
            rconWarningMessage={rconWarningMessage} setRconWarningMessage={setRconWarningMessage}
          />
        </div>
        <div className="space-y-4">
          <DiscordChannelCard
            discordNotifyChannelId={discordNotifyChannelId} setDiscordNotifyChannelId={setDiscordNotifyChannelId}
          />
          <DiscordRoleRewardCard
            discordRoleRewardEnabled={discordRoleRewardEnabled} setDiscordRoleRewardEnabled={setDiscordRoleRewardEnabled}
            discordRoleRewardId={discordRoleRewardId} setDiscordRoleRewardId={setDiscordRoleRewardId}
            discordRemoveRoleOnExpiry={discordRemoveRoleOnExpiry} setDiscordRemoveRoleOnExpiry={setDiscordRemoveRoleOnExpiry}
          />
          <AutoSeedAlertCard
            autoSeedAlertEnabled={autoSeedAlertEnabled} setAutoSeedAlertEnabled={setAutoSeedAlertEnabled}
            autoSeedAlertRoleId={autoSeedAlertRoleId} setAutoSeedAlertRoleId={setAutoSeedAlertRoleId}
            autoSeedAlertCooldownMin={autoSeedAlertCooldownMin} setAutoSeedAlertCooldownMin={setAutoSeedAlertCooldownMin}
          />
          <CustomEmbedCard
            customEmbedTitle={customEmbedTitle} setCustomEmbedTitle={setCustomEmbedTitle}
            customEmbedDescription={customEmbedDescription} setCustomEmbedDescription={setCustomEmbedDescription}
            customEmbedImageUrl={customEmbedImageUrl} setCustomEmbedImageUrl={setCustomEmbedImageUrl}
            customEmbedColor={customEmbedColor} setCustomEmbedColor={setCustomEmbedColor}
          />
          <WebhookCard
            webhookEnabled={webhookEnabled} setWebhookEnabled={setWebhookEnabled}
            webhookUrl={webhookUrl} setWebhookUrl={setWebhookUrl}
          />
        </div>
      </div>

      {/* ── ⑧ Public & Analytics ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Public Leaderboard">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Expose a read-only leaderboard page at /seeding/leaderboard for players to see their rank.
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Switch checked={leaderboardPublic} onCheckedChange={setLeaderboardPublic} />
              <Label className="text-sm">
                {leaderboardPublic ? "Public leaderboard visible" : "Public leaderboard hidden"}
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

        <Card title="Population Tracking">
          <p className="text-[11px] text-muted-foreground/80 leading-relaxed -mt-2">
            Records server player count on every poll for analytics and future population graphs.
          </p>
          <div className="flex items-center gap-3">
            <Switch checked={populationTrackingEnabled} onCheckedChange={setPopulationTrackingEnabled} />
            <Label className="text-sm">{populationTrackingEnabled ? "Tracking player counts" : "Population tracking disabled"}</Label>
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            Data is kept for 7 days and will power population graphs in a future update.
          </p>
        </Card>
      </div>

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
