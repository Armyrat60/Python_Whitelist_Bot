"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SeedingCard as Card, Sel } from "./settings-helpers";

const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface RewardConfigSectionProps {
  tiersEnabled: boolean;
  setTiersEnabled: (v: boolean) => void;
  tiers: { label: string; hours: string; minutes: string; durationHours: string }[];
  setTiers: (v: { label: string; hours: string; minutes: string; durationHours: string }[]) => void;
  seedingHours: string;
  setSeedingHours: (v: string) => void;
  seedingMinutes: string;
  setSeedingMinutes: (v: string) => void;
  rewardDurationDays: string;
  setRewardDurationDays: (v: string) => void;
  rewardDurationHoursR: string;
  setRewardDurationHoursR: (v: string) => void;
  startCount: string;
  setStartCount: (v: string) => void;
  threshold: string;
  setThreshold: (v: string) => void;
  windowEnabled: boolean;
  setWindowEnabled: (v: boolean) => void;
  windowStart: string;
  setWindowStart: (v: string) => void;
  windowEnd: string;
  setWindowEnd: (v: string) => void;
  trackingMode: "fixed_reset" | "daily_decay";
  setTrackingMode: (v: "fixed_reset" | "daily_decay") => void;
  resetFrequency: string;
  setResetFrequency: (v: string) => void;
  resetHour: string;
  setResetHour: (v: string) => void;
  resetMinuteVal: string;
  setResetMinuteVal: (v: string) => void;
  resetAmPm: string;
  setResetAmPm: (v: string) => void;
  resetDayOfWeek: string;
  setResetDayOfWeek: (v: string) => void;
  resetDayOfMonth: string;
  setResetDayOfMonth: (v: string) => void;
  customCron: string;
  setCustomCron: (v: string) => void;
  decayDaysThreshold: string;
  setDecayDaysThreshold: (v: string) => void;
  decayPointsPerDay: string;
  setDecayPointsPerDay: (v: string) => void;
  buildCron: (freq: string, hour: number, minute: number, ampm: string, dow: number, dom: number, custom: string) => string;
  cronToReadable: (cron: string) => string;
}

export function RewardConfigSection(props: RewardConfigSectionProps) {
  const {
    tiersEnabled, setTiersEnabled, tiers, setTiers,
    seedingHours, setSeedingHours, seedingMinutes, setSeedingMinutes,
    rewardDurationDays, setRewardDurationDays, rewardDurationHoursR, setRewardDurationHoursR,
    startCount, setStartCount, threshold, setThreshold,
    windowEnabled, setWindowEnabled, windowStart, setWindowStart, windowEnd, setWindowEnd,
    trackingMode, setTrackingMode,
    resetFrequency, setResetFrequency, resetHour, setResetHour,
    resetMinuteVal, setResetMinuteVal, resetAmPm, setResetAmPm,
    resetDayOfWeek, setResetDayOfWeek, resetDayOfMonth, setResetDayOfMonth,
    customCron, setCustomCron,
    decayDaysThreshold, setDecayDaysThreshold, decayPointsPerDay, setDecayPointsPerDay,
    buildCron, cronToReadable,
  } = props;

  return (
    <>
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
          <button onClick={() => setTrackingMode("fixed_reset")} className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "fixed_reset" ? "border-white/20" : "border-white/[0.10] opacity-60"}`} style={trackingMode === "fixed_reset" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}>
            <p className="text-xs font-medium text-white/80">Fixed Reset</p><p className="text-[10px] text-muted-foreground">Reset on schedule</p>
          </button>
          <button onClick={() => setTrackingMode("daily_decay")} className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${trackingMode === "daily_decay" ? "border-white/20" : "border-white/[0.10] opacity-60"}`} style={trackingMode === "daily_decay" ? { background: "color-mix(in srgb, var(--accent-primary) 8%, transparent)" } : undefined}>
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
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.10] px-3 py-2"><p className="text-xs text-white/70">{cronToReadable(currentCron)}</p></div>
          </div>
        ); })()}
        {trackingMode === "daily_decay" && (
          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Days before decay</Label><Input type="number" min={1} max={30} value={decayDaysThreshold} onChange={(e) => setDecayDaysThreshold(e.target.value)} className="h-8 text-xs" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Points lost per day</Label><Input type="number" min={1} max={1000} value={decayPointsPerDay} onChange={(e) => setDecayPointsPerDay(e.target.value)} className="h-8 text-xs" /></div>
          </div>
        )}
      </Card>
    </>
  );
}
