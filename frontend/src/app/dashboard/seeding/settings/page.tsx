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
      tips.push("SquadJS may be unreachable \u2014 check if it\u2019s running");
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
        "The service may be restarting \u2014 wait 1-2 minutes",
        "Check Railway logs for crash or memory errors",
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
    return {
      squadjs_host: host.trim(),
      squadjs_port: parseInt(port, 10) || 3000,
      squadjs_token: token === MASKED ? MASKED : token,
      enabled,
      rcon_warnings_enabled: rconWarningsEnabled,
      rcon_warning_message: rconWarningMessage,
      leaderboard_public: leaderboardPublic,
      // New Batch 2 fields
      discord_notify_channel_id: discordNotifyChannelId.trim() || null,
      discord_role_reward_enabled: discordRoleRewardEnabled,
      discord_role_reward_id: discordRoleRewardId.trim() || null,
      discord_remove_role_on_expiry: discordRemoveRoleOnExpiry,
      auto_seed_alert_enabled: autoSeedAlertEnabled,
      auto_seed_alert_role_id: autoSeedAlertRoleId.trim() || null,
      auto_seed_alert_cooldown_min: parseInt(autoSeedAlertCooldownMin, 10) || 30,
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

      {/* C. In-Game Notifications */}
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
