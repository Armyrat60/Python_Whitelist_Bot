"use client";

import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Tactical UI Components                                             */
/* ------------------------------------------------------------------ */

export const STATUS_META: Record<string, { label: string; dot: string; text: string; bg: string; border: string }> = {
  active: {
    label: "active",
    dot: "#22C55E", text: "#4ADE80",
    bg: "rgba(34,197,94,0.10)", border: "rgba(34,197,94,0.28)",
  },
  inactive: {
    label: "inactive",
    dot: "#64748B", text: "#94A3B8",
    bg: "rgba(100,116,139,0.10)", border: "rgba(100,116,139,0.22)",
  },
  expired: {
    label: "expired",
    dot: "#EF4444", text: "#F87171",
    bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.28)",
  },
  disabled_role_lost: {
    label: "Role Lost",
    dot: "#F59E0B", text: "#FCD34D",
    bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.28)",
  },
};

/** Status badge — green/gray/red/amber dot with glow */
export function StatusBadge({ status }: { status: string }) {
  const c = STATUS_META[status] ?? STATUS_META.inactive;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{
          background: c.dot,
          boxShadow: status === "active" ? `0 0 5px ${c.dot}` : "none",
        }}
      />
      {c.label}
    </span>
  );
}

/** Parse a plan string like "Solo:1 + Duo:2" into individual tier parts */
export function parsePlanTiers(plan: string | null | undefined): { name: string; slots: number }[] {
  if (!plan) return [];
  // Ignore system strings like "error:no_member", "default:1"
  if (plan.startsWith("error:")) return [];
  return plan.split("+").map((part) => {
    const colonIdx = part.lastIndexOf(":");
    if (colonIdx !== -1) {
      const name = part.slice(0, colonIdx).trim();
      const slots = parseInt(part.slice(colonIdx + 1), 10);
      // Skip "default" tier — it's a fallback, not a real role
      if (name === "default") return null;
      return { name, slots: isNaN(slots) ? 1 : slots };
    }
    return { name: part.trim(), slots: 1 };
  }).filter(Boolean) as { name: string; slots: number }[];
}

export function getTierColors(name: string): { bg: string; border: string; color: string } {
  const lower = name.toLowerCase();
  if (lower.includes("spectre") || lower.includes("command") || lower.includes("elite"))
    return { bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.30)", color: "#C084FC" };
  if (lower.includes("ghost") || lower.includes("squad") || lower.includes("recon"))
    return { bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.28)", color: "#7DD3FC" };
  if (lower.includes("duo") || lower.includes("fire"))
    return { bg: "rgba(20,184,166,0.12)", border: "rgba(20,184,166,0.28)", color: "#5EEAD4" };
  if (lower.includes("vip") || lower.includes("gold"))
    return { bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.28)", color: "#FCD34D" };
  return { bg: "rgba(148,163,184,0.09)", border: "rgba(148,163,184,0.20)", color: "#94A3B8" };
}

/** Tier chip — single pill for one role, first pill + "+N" tooltip for stacked roles */
export function TierChip({ tier }: { tier: string | null | undefined }) {
  const tiers = parsePlanTiers(tier);

  if (tiers.length === 0) {
    // Show raw value if it's an override (admin set), otherwise dash
    if (tier && tier.startsWith("override")) {
      return (
        <span
          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{ background: "rgba(99,102,241,0.12)", borderColor: "rgba(99,102,241,0.28)", color: "#A5B4FC" }}
          title={tier}
        >
          Override
        </span>
      );
    }
    return <span className="text-[11px] text-muted-foreground/60">—</span>;
  }

  const first = tiers[0];
  const rest = tiers.slice(1);
  const { bg, border, color } = getTierColors(first.name);

  if (rest.length === 0) {
    return (
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-[7rem] truncate"
        style={{ background: bg, borderColor: border, color }}
        title={`${first.name} — ${first.slots} slot${first.slots !== 1 ? "s" : ""}`}
      >
        {first.name}
      </span>
    );
  }

  // Multiple stacked roles — first pill + "+N" with tooltip listing all
  const tooltipText = tiers
    .map((t) => `${t.name}: ${t.slots} slot${t.slots !== 1 ? "s" : ""}`)
    .join("\n");

  return (
    <span
      className="inline-flex items-center gap-1 cursor-default"
      title={tooltipText}
    >
      <span
        className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-[5rem] truncate"
        style={{ background: bg, borderColor: border, color }}
      >
        {first.name}
      </span>
      <span
        className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold"
        style={{ background: "rgba(148,163,184,0.09)", borderColor: "rgba(148,163,184,0.22)", color: "#94A3B8" }}
      >
        +{rest.length}
      </span>
    </span>
  );
}

/** Whitelist badge — simple muted pill showing which whitelist */
export function WhitelistBadge({ name }: { name: string | null | undefined }) {
  if (!name) return <span className="text-[11px] text-muted-foreground/60">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium max-w-[8rem] truncate"
      style={{
        background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--accent-primary) 25%, transparent)",
        color: "var(--accent-primary)",
      }}
      title={name}
    >
      {name}
    </span>
  );
}

/** Registration source chip — how the user was first added */
export function RegSourceChip({ source }: { source?: string | null }) {
  const cfgs: Record<string, { label: string; bg: string; border: string; color: string }> = {
    self_register: { label: "Self Reg",  bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.30)",  color: "#4ADE80" },
    role_sync:     { label: "Role Sync", bg: "rgba(168,85,247,0.12)", border: "rgba(168,85,247,0.30)", color: "#C084FC" },
    import:        { label: "Import",    bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.28)", color: "#94A3B8" },
    web_dashboard: { label: "Dashboard", bg: "rgba(56,189,248,0.12)", border: "rgba(56,189,248,0.28)", color: "#7DD3FC" },
    admin:         { label: "Admin",     bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.22)", color: "#7DD3FC" },
    admin_web:     { label: "Admin",     bg: "rgba(56,189,248,0.10)", border: "rgba(56,189,248,0.22)", color: "#7DD3FC" },
    orphan:        { label: "Unmatched", bg: "rgba(251,146,60,0.12)", border: "rgba(251,146,60,0.30)", color: "#FB923C" },
  };
  const c = source ? cfgs[source] : null;
  if (!c) return <span className="text-[10px] text-muted-foreground/60">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{ background: c.bg, borderColor: c.border, color: c.color }}
    >
      {c.label}
    </span>
  );
}

/** Temp whitelist chip — shown when user has an expiry date */
export function TempChip({ expiresAt, createdAt }: { expiresAt?: string | null; createdAt?: string }) {
  if (!expiresAt) return null;
  const exp = new Date(expiresAt);
  const now = new Date();
  const isExpired = exp < now;
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  const label = isExpired
    ? `Temp · exp ${fmt(exp)}`
    : `Temp · ${createdAt ? fmt(new Date(createdAt)) + " → " : ""}${fmt(exp)}`;
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
      style={{
        background: isExpired ? "rgba(239,68,68,0.10)" : "rgba(251,146,60,0.10)",
        borderColor: isExpired ? "rgba(239,68,68,0.30)" : "rgba(251,146,60,0.30)",
        color: isExpired ? "#F87171" : "#FB923C",
      }}
    >
      {label}
    </span>
  );
}

/** Slot visualization — dot + count + slim progress bar */
export function SlotBar({ used, total }: { used: number; total: number }) {
  if (total === 0) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: "#F87171", boxShadow: "0 0 5px rgba(248,113,113,0.5)" }}
        />
        <span className="text-[11px] font-medium text-red-400">No Access</span>
      </div>
    );
  }

  const pct = Math.min((used / total) * 100, 100);
  const isOver = used > total;
  const barColor = isOver ? "#F87171" : "var(--accent-primary)";
  const glowColor = isOver ? "rgba(248,113,113,0.5)" : "color-mix(in srgb, var(--accent-primary) 50%, transparent)";

  return (
    <div className="flex items-center gap-2">
      {/* Colored identity dot */}
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: barColor, boxShadow: `0 0 5px ${glowColor}` }}
      />
      <span className={cn("min-w-[26px] text-[11px] tabular-nums font-medium", isOver ? "text-red-400" : "text-white/60")}>
        {used}/{total}
      </span>
      {/* Progress track */}
      <div className="relative h-[3px] w-20 overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background: barColor,
            boxShadow: `0 0 6px ${glowColor}`,
          }}
        />
      </div>
    </div>
  );
}
