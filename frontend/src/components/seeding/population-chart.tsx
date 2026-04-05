"use client";

import { useState } from "react";
import { TrendingUp } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { useSeedingPopulation } from "@/hooks/use-settings";

export default function PopulationChart({ threshold }: { threshold: number }) {
  const [hours, setHours] = useState(24);
  const { data } = useSeedingPopulation(hours);
  const snapshots = data?.snapshots ?? [];

  if (snapshots.length < 2) return null;

  const chartData = snapshots.map((s) => ({
    time: new Date(s.time).getTime(),
    players: s.player_count,
    seeding: s.is_seeding ? s.player_count : null,
  }));

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
          <h2 className="text-sm font-semibold text-white/80">Server Population</h2>
        </div>
        <div className="flex gap-1">
          {[6, 12, 24, 48, 168].map((h) => (
            <button key={h} onClick={() => setHours(h)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${hours === h ? "text-black" : "text-muted-foreground hover:text-white/60"}`}
              style={hours === h ? { background: "var(--accent-primary)" } : undefined}
            >{h <= 24 ? `${h}h` : `${h / 24}d`}</button>
          ))}
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="popGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time"
              tickFormatter={(t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false}
            />
            <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.3)" }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: "rgba(0,0,0,0.8)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(t) => new Date(t as number).toLocaleString()}
              formatter={(v) => [`${v} players`]}
            />
            <ReferenceLine y={threshold} stroke="#eab308" strokeDasharray="4 4" strokeOpacity={0.5} />
            <Area type="monotone" dataKey="players" stroke="var(--accent-primary)" fill="url(#popGrad)" strokeWidth={1.5} dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "var(--accent-primary)" }} /> Player count</span>
        <span className="flex items-center gap-1"><span className="h-2 w-4 border-t border-dashed border-yellow-500" /> Seeding threshold ({threshold})</span>
      </div>
    </div>
  );
}
