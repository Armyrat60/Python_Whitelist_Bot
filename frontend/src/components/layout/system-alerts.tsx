"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, Info, XCircle, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealth } from "@/hooks/use-settings";
import type { HealthAlert } from "@/lib/types";

const STYLES = {
  error: {
    icon:  "text-red-400",
    text:  "text-red-200",
    sub:   "text-red-300/60",
    dot:   "bg-red-500",
    row:   "border-red-500/20 bg-red-500/8",
    Icon:  XCircle,
  },
  warning: {
    icon:  "text-amber-400",
    text:  "text-amber-200/90",
    sub:   "text-amber-300/60",
    dot:   "bg-amber-500",
    row:   "border-amber-500/20 bg-amber-500/8",
    Icon:  AlertTriangle,
  },
  info: {
    icon:  "text-blue-400",
    text:  "text-blue-200/80",
    sub:   "text-blue-300/60",
    dot:   "bg-blue-500",
    row:   "border-blue-500/20 bg-blue-500/8",
    Icon:  Info,
  },
} as const;

function alertKey(a: HealthAlert) {
  return `${a.level}:${a.message}`;
}

export function NotificationBell() {
  const { data } = useHealth();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const alerts = (data?.alerts ?? []).filter((a) => !dismissed.has(alertKey(a)));
  const count = alerts.length;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const badgeColor =
    alerts.some((a) => a.level === "error")   ? "bg-red-500" :
    alerts.some((a) => a.level === "warning") ? "bg-amber-500" :
    count > 0                                  ? "bg-blue-500" : "";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "relative flex h-8 w-8 items-center justify-center rounded-md transition-colors",
          open
            ? "bg-white/10 text-foreground"
            : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
        )}
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold text-white",
              badgeColor
            )}
          >
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-white/[0.08] shadow-xl"
          style={{ background: "oklch(0.18 0 0)" }}
        >
          <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
            <span className="text-sm font-semibold text-foreground">System Alerts</span>
            {count > 0 ? (
              <button
                onClick={() => setDismissed(new Set(alerts.map(alertKey)))}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            ) : null}
          </div>

          {count === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <Bell className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">No active alerts</p>
            </div>
          ) : (
            <div className="max-h-80 divide-y divide-white/[0.04] overflow-y-auto">
              {alerts.map((alert) => {
                const key = alertKey(alert);
                const s = STYLES[alert.level];
                const { Icon } = s;
                return (
                  <div key={key} className={cn("flex items-start gap-3 px-4 py-3", s.row)}>
                    <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", s.icon)} />
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-xs leading-snug", s.text)}>{alert.message}</p>
                      {alert.link && (
                        <Link
                          href={alert.link}
                          onClick={() => setOpen(false)}
                          className={cn("mt-1 flex items-center gap-0.5 text-[11px] font-medium", s.icon, "hover:opacity-80 transition-opacity")}
                        >
                          Fix <ChevronRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                    <button
                      onClick={() => setDismissed((prev) => new Set([...prev, key]))}
                      className="mt-0.5 shrink-0 text-white/50 transition-colors hover:text-white/70"
                      aria-label="Dismiss"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
