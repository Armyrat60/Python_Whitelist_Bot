"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Sprout,
  Loader2,
  Clock,
  BookOpen,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import {
  useSeedingConfig,
  useSaveSeedingConfig,
  useWhitelists,
  useGroups,
} from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { SeedingConfig } from "@/lib/types";

const DANGEROUS_PERMS = new Set(["ban", "kick", "immune", "changemap", "config", "cameraman", "canseeadminchat", "manageserver", "cheat"]);
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getConnectionStatus(config: SeedingConfig | null): "green" | "yellow" | "red" | "grey" {
  if (!config) return "grey";
  if (!config.enabled) return "grey";
  if (!config.last_poll_at) return "yellow";
  if (config.last_poll_status === "error") return "red";
  const age = Date.now() - new Date(config.last_poll_at).getTime();
  if (age > 5 * 60 * 1000) return "yellow";
  return "green";
}
const STATUS_COLORS: Record<string, string> = { green: "#10b981", yellow: "#eab308", red: "#ef4444", grey: "#6b7280" };
const STATUS_LABELS: Record<string, string> = { green: "Connected", yellow: "Connecting...", red: "Error", grey: "Not configured" };

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

function StatusDot({ status }: { status: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0 animate-pulse" style={{ background: STATUS_COLORS[status] ?? STATUS_COLORS.grey, boxShadow: `0 0 6px ${STATUS_COLORS[status] ?? STATUS_COLORS.grey}` }} />;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4"><h2 className="text-sm font-semibold text-white/80">{title}</h2>{children}</div>;
}

function Sel({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={`flex h-8 w-full rounded-md border border-white/[0.08] px-3 text-xs text-white/80 appearance-none cursor-pointer ${className ?? ""}`} style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}>{children}</select>;
}

export default function SeedingDashboard() {
  const { data, isLoading } = useSeedingConfig();
  const save = useSaveSeedingConfig();
  const { data: whitelistsList } = useWhitelists();
  const { data: groupsList } = useGroups();

  const existing = data?.config ?? null;
  const connStatus = getConnectionStatus(existing);

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
  const [trackingMode, setTrackingMode] = useState<"fixed_reset" | "daily_decay">("fixed_reset");
  const [decayDaysThreshold, setDecayDaysThreshold] = useState("3");
  const [decayPointsPerDay, setDecayPointsPerDay] = useState("10");
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => {
    if (!existing) return;
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
    setWindowStart(existing.seeding_window_start); setWindowEnd(existing.seeding_window_end);
    if (existing.reward_tiers?.length) {
      setTiersEnabled(true);
      setTiers(existing.reward_tiers.map((t) => ({ label: t.label, hours: String(Math.floor(t.points / 60)), minutes: String(t.points % 60), durationHours: String(t.duration_hours) })));
    } else { setTiersEnabled(false); }
    setTrackingMode(existing.tracking_mode);
    setDecayDaysThreshold(String(existing.decay_days_threshold));
    setDecayPointsPerDay(String(existing.decay_points_per_day));
  }, [existing?.id]);

  const safeGroups = (groupsList ?? []).filter((g) => !g.permissions.split(",").some((p) => DANGEROUS_PERMS.has(p.trim().toLowerCase())));
  const whitelists = whitelistsList ?? [];

  function buildPayload() {
    const pts = (parseInt(seedingHours, 10) || 0) * 60 + (parseInt(seedingMinutes, 10) || 0);
    const cron = buildCron(resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinute, 10) || 0, resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron);
    return {
      seeding_start_player_count: parseInt(startCount, 10) || 2, seeding_player_threshold: parseInt(threshold, 10) || 50,
      points_required: pts || 120, reward_whitelist_id: rewardWhitelistId ? parseInt(rewardWhitelistId, 10) : null,
      reward_group_name: rewardGroupName, reward_duration_hours: parseInt(rewardDurationHours, 10) || 168,
      tracking_mode: trackingMode, reset_cron: cron,
      seeding_window_enabled: windowEnabled, seeding_window_start: windowStart, seeding_window_end: windowEnd,
      reward_tiers: tiersEnabled ? tiers.map((t) => ({ points: (parseInt(t.hours, 10) || 0) * 60 + (parseInt(t.minutes, 10) || 0), duration_hours: parseInt(t.durationHours, 10) || 24, label: t.label.trim() || "Tier" })) : null,
      decay_days_threshold: parseInt(decayDaysThreshold, 10) || 3,
      decay_points_per_day: parseInt(decayPointsPerDay, 10) || 10,
    };
  }

  async function handleSave() {
    try { await save.mutateAsync(buildPayload()); toast.success("Reward settings saved"); } catch { toast.error("Failed to save"); }
  }

  if (isLoading) return <div className="space-y-4 max-w-3xl"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>;

  const currentCron = buildCron(resetFrequency, parseInt(resetHour, 10) || 12, parseInt(resetMinute, 10) || 0, resetAmPm, parseInt(resetDayOfWeek, 10) || 1, parseInt(resetDayOfMonth, 10) || 1, customCron);

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0" style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}>
          <Sprout className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white/90">Seeding Dashboard</h1>
            <StatusDot status={connStatus} />
            <span className="text-xs text-muted-foreground">{STATUS_LABELS[connStatus]}</span>
          </div>
          <p className="text-xs text-muted-foreground">Configure how players earn whitelist rewards by seeding</p>
        </div>
        {existing && <Badge variant={existing.enabled ? "default" : "secondary"} className="text-[10px] shrink-0">{existing.enabled ? "Enabled" : "Disabled"}</Badge>}
      </div>

      {/* Last poll quick status */}
      {existing?.last_poll_at && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" /> Last poll: {new Date(existing.last_poll_at).toLocaleString()}
          {existing.last_poll_status === "ok" && <span className="text-emerald-400 ml-1">{existing.last_poll_message}</span>}
          {existing.last_poll_status === "error" && <span className="text-red-400 ml-1">{existing.last_poll_message}</span>}
        </div>
      )}

      {/* Reward Tiers */}
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
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Hours</Label><Input type="number" min={0} max={166} value={seedingHours} onChange={(e) => setSeedingHours(e.target.value)} className="h-8 text-xs w-20" /></div>
              <span className="text-xs text-muted-foreground pb-2">h</span>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Minutes</Label><Input type="number" min={0} max={59} value={seedingMinutes} onChange={(e) => setSeedingMinutes(e.target.value)} className="h-8 text-xs w-20" /></div>
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

      {/* Thresholds */}
      <Card title="Seeding Thresholds">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Min Players</Label><Input type="number" min={1} max={100} value={startCount} onChange={(e) => setStartCount(e.target.value)} className="h-8 text-xs" /></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Max Players</Label><Input type="number" min={2} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} className="h-8 text-xs" /></div>
        </div>
        <p className="text-[10px] text-muted-foreground/70">Seeding mode active when server has {startCount} to {threshold} players</p>
      </Card>

      {/* Time Window */}
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

      {/* Whitelist & Group */}
      <Card title="Reward Whitelist & Permissions">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Whitelist</Label>
            <Sel value={rewardWhitelistId} onChange={setRewardWhitelistId}>
              <option value="">Auto (Seeding Rewards)</option>
              {whitelists.map((wl) => <option key={wl.id} value={String(wl.id)}>{wl.name}{wl.is_default ? " (default)" : ""}</option>)}
            </Sel>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Permission Group</Label>
            <Sel value={rewardGroupName} onChange={setRewardGroupName}>
              {safeGroups.map((g) => <option key={g.group_name} value={g.group_name}>{g.group_name} ({g.permissions})</option>)}
              {safeGroups.length === 0 && <option value="SeedReserve">SeedReserve (reserve)</option>}
            </Sel>
          </div>
        </div>
      </Card>

      {/* Point Management */}
      <Card title="Point Management">
        <div className="flex gap-2">
          <button onClick={() => setTrackingMode("fixed_reset")} className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "fixed_reset" ? "border-white/20" : "border-white/[0.06] opacity-60"}`} style={trackingMode === "fixed_reset" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}>
            <p className="text-xs font-medium text-white/80">Fixed Reset</p>
            <p className="text-[10px] text-muted-foreground">Reset on schedule</p>
          </button>
          <button onClick={() => setTrackingMode("daily_decay")} className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "daily_decay" ? "border-white/20" : "border-white/[0.06] opacity-60"}`} style={trackingMode === "daily_decay" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}>
            <p className="text-xs font-medium text-white/80">Daily Decay</p>
            <p className="text-[10px] text-muted-foreground">Points decrease when inactive</p>
          </button>
        </div>
        {trackingMode === "fixed_reset" && (
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Frequency</Label><Sel value={resetFrequency} onChange={setResetFrequency}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></Sel></div>
              <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Time</Label><div className="flex gap-1.5"><Input type="number" min={1} max={12} value={resetHour} onChange={(e) => setResetHour(e.target.value)} className="h-8 text-xs w-16" /><span className="text-muted-foreground text-xs self-center">:</span><Input type="number" min={0} max={59} value={resetMinute} onChange={(e) => setResetMinute(e.target.value)} className="h-8 text-xs w-16" /><Sel value={resetAmPm} onChange={setResetAmPm} className="w-20"><option value="AM">AM</option><option value="PM">PM</option></Sel></div></div>
            </div>
            {resetFrequency === "weekly" && <div className="flex gap-1.5 flex-wrap">{DAYS_OF_WEEK.map((day, idx) => <button key={day} onClick={() => setResetDayOfWeek(String(idx))} className={`px-3 py-1.5 rounded-md text-xs font-medium ${String(idx) === resetDayOfWeek ? "text-black" : "bg-white/[0.04] border border-white/[0.08] text-white/60"}`} style={String(idx) === resetDayOfWeek ? { background: "var(--accent-primary)" } : undefined}>{day.slice(0, 3)}</button>)}</div>}
            {resetFrequency === "monthly" && <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Day</Label><Input type="number" min={1} max={28} value={resetDayOfMonth} onChange={(e) => setResetDayOfMonth(e.target.value)} className="h-8 text-xs w-20" /></div>}
            {resetFrequency === "custom" && <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Cron</Label><Input value={customCron} onChange={(e) => setCustomCron(e.target.value)} className="h-8 text-xs font-mono" /></div>}
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2"><p className="text-xs text-white/70">{cronToReadable(currentCron)}</p></div>
          </div>
        )}
        {trackingMode === "daily_decay" && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Days before decay</Label><Input type="number" min={1} max={30} value={decayDaysThreshold} onChange={(e) => setDecayDaysThreshold(e.target.value)} className="h-8 text-xs" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Points lost per day</Label><Input type="number" min={1} max={1000} value={decayPointsPerDay} onChange={(e) => setDecayPointsPerDay(e.target.value)} className="h-8 text-xs" /></div>
          </div>
        )}
      </Card>

      <Button onClick={handleSave} disabled={save.isPending} style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
        {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
        Save Reward Settings
      </Button>

      {/* How It Works (collapsible) */}
      <button onClick={() => setGuideOpen(!guideOpen)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-white/70 transition-colors">
        <BookOpen className="h-4 w-4" />
        How Seeding Works
        {guideOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {guideOpen && (
        <div className="space-y-3 text-xs text-muted-foreground leading-relaxed rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <p>The seeding service connects to SquadJS and monitors player counts. When the server is between the min/max thresholds, it&apos;s in <strong className="text-white/70">seeding mode</strong> and each online player earns <strong className="text-white/70">1 point per minute</strong>.</p>
          <p>When a player reaches the required points (or the lowest tier threshold), they automatically receive a whitelist entry with the configured permission group and duration.</p>
          <p>In <strong className="text-white/70">Fixed Reset</strong> mode, points reset on schedule. In <strong className="text-white/70">Daily Decay</strong> mode, points decrease when players stop seeding. Existing rewards are not affected by resets or decay — they expire naturally.</p>
        </div>
      )}
    </div>
  );
}
