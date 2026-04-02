"use client";

import { useState, useEffect } from "react";
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
  CalendarClock,
  BookOpen,
  ExternalLink,
  Plus,
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

const DANGEROUS_PERMS = new Set([
  "ban", "kick", "immune", "changemap", "config",
  "cameraman", "canseeadminchat", "manageserver", "cheat",
]);

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

const STATUS_COLORS: Record<string, string> = {
  green: "#10b981",
  yellow: "#eab308",
  red: "#ef4444",
  grey: "#6b7280",
};

const STATUS_LABELS: Record<string, string> = {
  green: "Connected",
  yellow: "Connecting...",
  red: "Error",
  grey: "Not configured",
};

function parseCron(cron: string): {
  frequency: string; hour: number; minute: number; ampm: string;
  dayOfWeek: number; dayOfMonth: number;
} {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { frequency: "custom", hour: 12, minute: 0, ampm: "AM", dayOfWeek: 1, dayOfMonth: 1 };

  const [min, hr, dom, , dow] = parts;
  const hour24 = parseInt(hr, 10);
  const minute = parseInt(min, 10);
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24;

  if (dom !== "*" && dow === "*") {
    return { frequency: "monthly", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: parseInt(dom, 10) || 1 };
  }
  if (dow !== "*" && dom === "*") {
    return { frequency: "weekly", hour, minute, ampm, dayOfWeek: parseInt(dow, 10) || 0, dayOfMonth: 1 };
  }
  if (dom === "*" && dow === "*") {
    return { frequency: "daily", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: 1 };
  }
  return { frequency: "custom", hour, minute, ampm, dayOfWeek: 1, dayOfMonth: 1 };
}

function buildCron(frequency: string, hour: number, minute: number, ampm: string, dayOfWeek: number, dayOfMonth: number, customCron: string): string {
  if (frequency === "custom") return customCron;
  let h24 = hour % 12;
  if (ampm === "PM") h24 += 12;
  if (frequency === "daily") return `${minute} ${h24} * * *`;
  if (frequency === "weekly") return `${minute} ${h24} * * ${dayOfWeek}`;
  if (frequency === "monthly") return `${minute} ${h24} ${dayOfMonth} * *`;
  return `${minute} ${h24} * * *`;
}

function cronToReadable(cron: string): string {
  const p = parseCron(cron);
  const timeStr = `${p.hour}:${String(p.minute).padStart(2, "0")} ${p.ampm}`;
  if (p.frequency === "daily") return `Resets daily at ${timeStr}`;
  if (p.frequency === "weekly") return `Resets every ${DAYS_OF_WEEK[p.dayOfWeek]} at ${timeStr}`;
  if (p.frequency === "monthly") return `Resets on day ${p.dayOfMonth} of each month at ${timeStr}`;
  return `Custom schedule: ${cron}`;
}

// ─── Shared Components ────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
      style={{ background: STATUS_COLORS[status] ?? STATUS_COLORS.grey, boxShadow: `0 0 6px ${STATUS_COLORS[status] ?? STATUS_COLORS.grey}` }}
      title={STATUS_LABELS[status] ?? "Unknown"}
    />
  );
}

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

function SelectInput({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`flex h-8 w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-3 text-xs text-white/80 ${className ?? ""}`}
    >
      {children}
    </select>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SeedingPage() {
  const { data, isLoading } = useSeedingConfig();
  const save = useSaveSeedingConfig();
  const remove = useDeleteSeedingConfig();
  const test = useTestSeedingConnection();
  const { data: leaderboardData } = useSeedingLeaderboard();
  const resetPoints = useResetSeedingPoints();
  const grantPoints = useGrantSeedingPoints();

  const { data: whitelistsList } = useWhitelists();
  const { data: groupsList } = useGroups();

  const existing = data?.config ?? null;
  const connStatus = getConnectionStatus(existing);

  // ── Connection form state ──
  const [host, setHost] = useState("");
  const [port, setPort] = useState("3000");
  const [token, setToken] = useState("");
  const [enabled, setEnabled] = useState(false);

  // ── Reward form state ──
  const [seedingHours, setSeedingHours] = useState("2");
  const [seedingMinutes, setSeedingMinutes] = useState("0");
  const [startCount, setStartCount] = useState("2");
  const [threshold, setThreshold] = useState("50");
  const [rewardWhitelistId, setRewardWhitelistId] = useState<string>("");
  const [rewardGroupName, setRewardGroupName] = useState("reserve");
  const [rewardDurationHours, setRewardDurationHours] = useState("168");

  // ── Schedule form state ──
  const [resetFrequency, setResetFrequency] = useState("daily");
  const [resetHour, setResetHour] = useState("12");
  const [resetMinute, setResetMinute] = useState("0");
  const [resetAmPm, setResetAmPm] = useState("AM");
  const [resetDayOfWeek, setResetDayOfWeek] = useState("1");
  const [resetDayOfMonth, setResetDayOfMonth] = useState("1");
  const [customCron, setCustomCron] = useState("0 0 * * *");

  // ── Leaderboard state ──
  const [leaderboardPublic, setLeaderboardPublic] = useState(false);
  const [grantSteamId, setGrantSteamId] = useState("");
  const [grantPointsVal, setGrantPointsVal] = useState("60");
  const [showGrantDialog, setShowGrantDialog] = useState(false);

  // ── Sync form from fetched config ──
  useEffect(() => {
    if (!existing) return;
    setHost(existing.squadjs_host);
    setPort(String(existing.squadjs_port));
    setToken(MASKED);
    setEnabled(existing.enabled);

    const pts = existing.points_required;
    setSeedingHours(String(Math.floor(pts / 60)));
    setSeedingMinutes(String(pts % 60));
    setStartCount(String(existing.seeding_start_player_count));
    setThreshold(String(existing.seeding_player_threshold));
    setRewardWhitelistId(existing.reward_whitelist_id ? String(existing.reward_whitelist_id) : "");
    setRewardGroupName(existing.reward_group_name);
    setRewardDurationHours(String(existing.reward_duration_hours));

    const parsed = parseCron(existing.reset_cron);
    setResetFrequency(parsed.frequency);
    setResetHour(String(parsed.hour));
    setResetMinute(String(parsed.minute));
    setResetAmPm(parsed.ampm);
    setResetDayOfWeek(String(parsed.dayOfWeek));
    setResetDayOfMonth(String(parsed.dayOfMonth));
    if (parsed.frequency === "custom") setCustomCron(existing.reset_cron);

    setLeaderboardPublic(existing.leaderboard_public);
  }, [existing?.id]);

  const safeGroups = (groupsList ?? []).filter((g) => {
    const perms = g.permissions.split(",").map((p) => p.trim().toLowerCase());
    return !perms.some((p) => DANGEROUS_PERMS.has(p));
  });
  const whitelists = whitelistsList ?? [];

  function buildPayload() {
    const pts = (parseInt(seedingHours, 10) || 0) * 60 + (parseInt(seedingMinutes, 10) || 0);
    const cron = buildCron(
      resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinute, 10) || 0,
      resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron,
    );
    return {
      squadjs_host: host.trim(),
      squadjs_port: parseInt(port, 10) || 3000,
      squadjs_token: token === MASKED ? MASKED : token,
      seeding_start_player_count: parseInt(startCount, 10) || 2,
      seeding_player_threshold: parseInt(threshold, 10) || 50,
      points_required: pts || 120,
      reward_whitelist_id: rewardWhitelistId ? parseInt(rewardWhitelistId, 10) : null,
      reward_group_name: rewardGroupName,
      reward_duration_hours: parseInt(rewardDurationHours, 10) || 168,
      tracking_mode: "fixed_reset" as const,
      reset_cron: cron,
      enabled,
      leaderboard_public: leaderboardPublic,
    };
  }

  async function handleSave() {
    if (!host) { toast.error("SquadJS host is required"); return; }
    if (!existing && (!token || token === MASKED)) { toast.error("SquadJS token is required for a new config"); return; }
    try {
      await save.mutateAsync(buildPayload());
      toast.success("Seeding configuration saved");
    } catch { toast.error("Failed to save configuration"); }
  }

  async function handleTest() {
    if (!host) { toast.error("Fill in the SquadJS host first"); return; }
    const payload = buildPayload();
    if (payload.squadjs_token === MASKED) delete (payload as Record<string, unknown>).squadjs_token;
    try {
      const result = await test.mutateAsync(payload);
      if (result.ok) toast.success(result.message); else toast.error(result.message);
    } catch { toast.error("Test request failed"); }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync();
      toast.success("Seeding configuration removed");
      setHost(""); setPort("3000"); setToken(""); setEnabled(false);
    } catch { toast.error("Failed to remove configuration"); }
  }

  async function handleReset() {
    try {
      const result = await resetPoints.mutateAsync();
      toast.success(`Reset points for ${result.players_reset} player(s)`);
    } catch { toast.error("Failed to reset points"); }
  }

  async function handleGrant() {
    if (!/^[0-9]{17}$/.test(grantSteamId)) { toast.error("Enter a valid 17-digit Steam64 ID"); return; }
    try {
      await grantPoints.mutateAsync({ steam_id: grantSteamId, points: parseInt(grantPointsVal, 10) || 0 });
      toast.success("Points granted");
      setShowGrantDialog(false);
      setGrantSteamId("");
      setGrantPointsVal("60");
    } catch { toast.error("Failed to grant points"); }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  const leaderboard = leaderboardData?.players ?? [];
  const leaderboardPointsRequired = leaderboardData?.points_required ?? ((parseInt(seedingHours, 10) || 0) * 60 + (parseInt(seedingMinutes, 10) || 0) || 120);
  const currentCron = buildCron(
    resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinute, 10) || 0,
    resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron,
  );

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Sprout className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white/90">Seeding Module</h1>
            <StatusDot status={connStatus} />
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[connStatus]}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Reward players who help seed your server with whitelist access
          </p>
        </div>
        {existing && (
          <Badge variant={existing.enabled ? "default" : "secondary"} className="text-[10px] shrink-0">
            {existing.enabled ? "Enabled" : "Disabled"}
          </Badge>
        )}
      </div>

      {/* Tabs */}
      <Tabs orientation="horizontal" defaultValue="connection">
        <TabsList variant="line" className="mb-4">
          <TabsTrigger value="connection"><Plug className="h-3.5 w-3.5" /> Connection</TabsTrigger>
          <TabsTrigger value="rewards"><Gift className="h-3.5 w-3.5" /> Rewards</TabsTrigger>
          <TabsTrigger value="schedule"><CalendarClock className="h-3.5 w-3.5" /> Schedule</TabsTrigger>
          <TabsTrigger value="leaderboard"><Trophy className="h-3.5 w-3.5" /> Leaderboard</TabsTrigger>
          <TabsTrigger value="guide"><BookOpen className="h-3.5 w-3.5" /> How It Works</TabsTrigger>
        </TabsList>

        {/* ── Connection Tab ─────────────────────────────────────────────── */}
        <TabsContent value="connection" className="space-y-4">
          {existing && (
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Poll</span>
                <StatusDot status={connStatus} />
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
            <Button variant="outline" onClick={handleTest} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
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
                    <AlertDialogDescription>This will remove your SquadJS connection and stop tracking seeding points. Existing rewards and points are kept.</AlertDialogDescription>
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

        {/* ── Rewards Tab ────────────────────────────────────────────────── */}
        <TabsContent value="rewards" className="space-y-4">
          <Card title="Seeding Time Required">
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
              <span className="text-xs text-muted-foreground pb-2">m</span>
            </div>
            <p className="text-[10px] text-muted-foreground/70">
              Players must seed for {parseInt(seedingHours, 10) || 0} hour(s) {parseInt(seedingMinutes, 10) || 0} minute(s) to earn a reward
            </p>
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
            <p className="text-[10px] text-muted-foreground/70">
              Seeding mode is active when server has between {startCount} and {threshold} players
            </p>
          </Card>

          <Card title="Reward Configuration">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Reward Whitelist</Label>
                <SelectInput value={rewardWhitelistId} onChange={setRewardWhitelistId}>
                  <option value="">Default whitelist</option>
                  {whitelists.map((wl) => (
                    <option key={wl.id} value={String(wl.id)}>{wl.name}{wl.is_default ? " (default)" : ""}</option>
                  ))}
                </SelectInput>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Permission Group</Label>
                <SelectInput value={rewardGroupName} onChange={setRewardGroupName}>
                  {safeGroups.map((g) => (
                    <option key={g.group_name} value={g.group_name}>{g.group_name} ({g.permissions})</option>
                  ))}
                  {safeGroups.length === 0 && <option value="reserve">reserve (default)</option>}
                </SelectInput>
                <p className="text-[10px] text-muted-foreground/70">Only safe permission groups are shown</p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Reward Duration (hours)</Label>
              <Input type="number" min={1} max={8760} value={rewardDurationHours} onChange={(e) => setRewardDurationHours(e.target.value)} className="h-8 text-xs w-32" />
              <p className="text-[10px] text-muted-foreground/70">
                = {Math.round((parseInt(rewardDurationHours, 10) || 0) / 24 * 10) / 10} days
              </p>
            </div>
          </Card>

          <Button onClick={handleSave} disabled={save.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Reward Settings
          </Button>
        </TabsContent>

        {/* ── Schedule Tab ───────────────────────────────────────────────── */}
        <TabsContent value="schedule" className="space-y-4">
          <Card title="Point Reset Schedule">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Reset Frequency</Label>
                <SelectInput value={resetFrequency} onChange={setResetFrequency}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom (advanced)</option>
                </SelectInput>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Reset Time</Label>
                <div className="flex gap-1.5">
                  <Input type="number" min={1} max={12} value={resetHour} onChange={(e) => setResetHour(e.target.value)} className="h-8 text-xs w-16" />
                  <span className="text-muted-foreground text-xs self-center">:</span>
                  <Input type="number" min={0} max={59} value={resetMinute} onChange={(e) => setResetMinute(e.target.value)} className="h-8 text-xs w-16" />
                  <SelectInput value={resetAmPm} onChange={setResetAmPm} className="w-20">
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </SelectInput>
                </div>
              </div>
            </div>

            {resetFrequency === "weekly" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Day of Week</Label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS_OF_WEEK.map((day, idx) => (
                    <button
                      key={day}
                      onClick={() => setResetDayOfWeek(String(idx))}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        String(idx) === resetDayOfWeek
                          ? "text-black"
                          : "bg-white/[0.04] border border-white/[0.08] text-white/60 hover:bg-white/[0.08]"
                      }`}
                      style={String(idx) === resetDayOfWeek ? { background: "var(--accent-primary)" } : undefined}
                    >
                      {day.slice(0, 3)}
                    </button>
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
                <p className="text-[10px] text-muted-foreground/70">Format: minute hour day-of-month month day-of-week</p>
              </div>
            )}

            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
              <p className="text-xs text-white/70">{cronToReadable(currentCron)}</p>
            </div>
          </Card>

          <Card title="Tracking Mode">
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2 space-y-1">
              <p className="text-xs font-medium text-white/70">Fixed Reset (Active)</p>
              <p className="text-[10px] text-muted-foreground">Points accumulate until the scheduled reset, then all points are set to zero. Players must earn their reward again each cycle.</p>
            </div>
            <p className="text-[10px] text-muted-foreground/50">Incremental decay mode coming soon — points gradually decrease when players stop seeding.</p>
          </Card>

          <Button onClick={handleSave} disabled={save.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Schedule
          </Button>
        </TabsContent>

        {/* ── Leaderboard Tab ────────────────────────────────────────────── */}
        <TabsContent value="leaderboard" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
              <h2 className="text-sm font-semibold text-white/80">Seeding Leaderboard</h2>
              <span className="text-xs text-muted-foreground">
                <Users className="h-3 w-3 inline mr-1" />{leaderboard.length} seeder(s)
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowGrantDialog(true)}>
                <Plus className="mr-1 h-3 w-3" /> Grant Points
              </Button>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="outline" size="sm" className="h-7 text-xs" disabled={resetPoints.isPending} />}>
                  {resetPoints.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                  Reset All
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset all seeding points?</AlertDialogTitle>
                    <AlertDialogDescription>This will reset all player seeding points to zero. Existing whitelist rewards remain until they expire.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleReset} className="bg-red-600 hover:bg-red-700">Reset All Points</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Public toggle */}
          <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-white/80">Make leaderboard public</p>
              <p className="text-[10px] text-muted-foreground">Allow non-admin users to view the seeding leaderboard</p>
            </div>
            <div className="flex items-center gap-3">
              {leaderboardPublic && (
                <Link href="/seeding/leaderboard" className="text-xs flex items-center gap-1 hover:underline" style={{ color: "var(--accent-primary)" }}>
                  View public page <ExternalLink className="h-3 w-3" />
                </Link>
              )}
              <Switch checked={leaderboardPublic} onCheckedChange={(v) => { setLeaderboardPublic(v); save.mutateAsync({ ...buildPayload(), leaderboard_public: v }).then(() => toast.success(v ? "Leaderboard is now public" : "Leaderboard is now private")).catch(() => toast.error("Failed to update")); }} />
            </div>
          </div>

          {/* Grant Points Dialog */}
          {showGrantDialog && (
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
              <h3 className="text-sm font-semibold text-white/80">Grant Points</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Steam64 ID</Label>
                  <Input value={grantSteamId} onChange={(e) => setGrantSteamId(e.target.value)} placeholder="76561198012345678" className="h-8 text-xs font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Points to grant</Label>
                  <Input type="number" min={1} max={10000} value={grantPointsVal} onChange={(e) => setGrantPointsVal(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleGrant} disabled={grantPoints.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold text-xs">
                  {grantPoints.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                  Grant
                </Button>
                <Button variant="outline" className="text-xs" onClick={() => setShowGrantDialog(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Leaderboard table */}
          {leaderboard.length === 0 ? (
            <p className="text-xs text-muted-foreground py-8 text-center">No seeding data yet. Points will appear once players start seeding.</p>
          ) : (
            <div className="space-y-2">
              {leaderboard.map((player, idx) => (
                <div key={player.steam_id} className="flex items-center gap-3 rounded-lg bg-white/[0.02] border border-white/[0.05] px-3 py-2">
                  <span className="text-xs font-bold text-white/40 w-6 text-right">{idx + 1}</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-white/80 truncate">{player.player_name ?? player.steam_id}</span>
                      <span className="text-[10px] text-muted-foreground/50 font-mono">{player.steam_id}</span>
                      {player.rewarded && (
                        <Badge variant="default" className="text-[9px] px-1.5 py-0" style={{ background: "var(--accent-primary)", color: "black" }}>Rewarded</Badge>
                      )}
                    </div>
                    <ProgressBar pct={player.progress_pct} />
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-semibold text-white/70">{player.points}/{leaderboardPointsRequired}</span>
                    <span className="block text-[10px] text-muted-foreground">{player.progress_pct}%</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── How It Works Tab ───────────────────────────────────────────── */}
        <TabsContent value="guide" className="space-y-4">
          <Card title="What is Seeding?">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Seeding is when players join a game server during low-population periods to help it fill up. Without seeders, servers stay empty. The seeding module rewards players who contribute to server population growth by automatically granting them whitelist access (reserved slots).
            </p>
          </Card>

          <Card title="How Points Accumulate">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>The seeding service connects to your SquadJS instance and monitors player counts in real-time. Every <strong className="text-white/70">60 seconds</strong>, it checks:</p>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li>Is the server population between the <strong className="text-white/70">minimum</strong> and <strong className="text-white/70">maximum</strong> player thresholds?</li>
                <li>If yes, the server is in <strong className="text-white/70">seeding mode</strong></li>
                <li>Each online player earns <strong className="text-white/70">1 point per minute</strong> while seeding mode is active</li>
              </ul>
              <p>Points stop accumulating when the server goes above the threshold (meaning seeding was successful and the server is now populated).</p>
            </div>
          </Card>

          <Card title="When Rewards Are Granted">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p>Once a player reaches the required number of points, they <strong className="text-white/70">automatically</strong> receive:</p>
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li>A whitelist entry on the configured whitelist</li>
                <li>The configured permission group (e.g., reserved slot)</li>
                <li>Access for the configured duration (e.g., 7 days)</li>
              </ul>
              <p>The reward appears in the Squad server&apos;s whitelist file on the next refresh cycle. No manual intervention needed.</p>
            </div>
          </Card>

          <Card title="How Resets Work">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <p><strong className="text-white/70">Fixed Reset</strong> (current mode): All player points are reset to zero on a schedule you configure (daily, weekly, or monthly). After a reset, players need to seed again to earn a new reward.</p>
              <p>Existing whitelist rewards are <strong className="text-white/70">not affected</strong> by point resets. They remain active until their expiry date.</p>
              <p className="text-muted-foreground/50"><em>Incremental decay mode coming soon — points gradually decrease when a player stops seeding, rewarding consistent seeders.</em></p>
            </div>
          </Card>

          <Card title="Safety Protections">
            <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
              <ul className="list-disc list-inside space-y-1 pl-2">
                <li>Reward groups are validated to only contain <strong className="text-white/70">safe permissions</strong> (reserve, balance, teamchange)</li>
                <li>Dangerous permissions (ban, kick, admin) are <strong className="text-white/70">blocked</strong> from being auto-granted</li>
                <li>All reward grants are logged in the <strong className="text-white/70">audit log</strong></li>
                <li>The seeding service runs in <strong className="text-white/70">isolation</strong> — if it crashes, whitelist management continues working</li>
              </ul>
            </div>
          </Card>

          <Card title="Frequently Asked Questions">
            <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
              <div>
                <p className="font-medium text-white/70">What if a player disconnects and reconnects?</p>
                <p>Points are tied to Steam ID. When a player reconnects, they continue accumulating from where they left off.</p>
              </div>
              <div>
                <p className="font-medium text-white/70">Do AFK players earn points?</p>
                <p>Yes — the system tracks presence on the server, not activity. If SquadJS auto-kicks AFK players, they will stop earning points.</p>
              </div>
              <div>
                <p className="font-medium text-white/70">Can I manually grant or reset points?</p>
                <p>Yes — use the Grant Points button and Reset All on the Leaderboard tab. Both actions are logged.</p>
              </div>
              <div>
                <p className="font-medium text-white/70">What happens when a reward expires?</p>
                <p>The whitelist entry is automatically set to &apos;expired&apos; and removed from the server&apos;s whitelist file. The player can earn a new reward by seeding again.</p>
              </div>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
