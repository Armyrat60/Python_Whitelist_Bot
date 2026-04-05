"use client";

import type React from "react";

/* ─── Custom Card (used across seeding settings sections) ─── */
export function SeedingCard({
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

/* ─── Custom Select wrapper ─── */
export function Sel({ value, onChange, children, className }: { value: string; onChange: (v: string) => void; children: React.ReactNode; className?: string }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={`flex h-8 w-full rounded-md border border-white/[0.08] px-3 text-xs text-white/80 appearance-none cursor-pointer ${className ?? ""}`} style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}>{children}</select>;
}
