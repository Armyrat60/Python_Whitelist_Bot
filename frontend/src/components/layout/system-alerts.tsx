"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Info, XCircle, X, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHealth } from "@/hooks/use-settings";
import type { HealthAlert } from "@/lib/types";

const STYLES = {
  error: {
    bar:   "bg-red-500/10 border-red-500/20",
    icon:  "text-red-400",
    text:  "text-red-200",
    close: "text-red-400/60 hover:text-red-300",
    Icon:  XCircle,
  },
  warning: {
    bar:   "bg-amber-500/10 border-amber-500/20",
    icon:  "text-amber-400",
    text:  "text-amber-200/80",
    close: "text-amber-400/60 hover:text-amber-300",
    Icon:  AlertTriangle,
  },
  info: {
    bar:   "bg-blue-500/10 border-blue-500/20",
    icon:  "text-blue-400",
    text:  "text-blue-200/70",
    close: "text-blue-400/60 hover:text-blue-300",
    Icon:  Info,
  },
} as const;

export function SystemAlerts() {
  const { data } = useHealth();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const alerts = (data?.alerts ?? []).filter(
    (a) => !dismissed.has(alertKey(a))
  );

  if (alerts.length === 0) return null;

  return (
    <div className="border-b border-white/[0.05] space-y-px">
      {alerts.map((alert) => {
        const key = alertKey(alert);
        const s = STYLES[alert.level];
        const { Icon } = s;
        return (
          <div
            key={key}
            className={cn("flex items-center gap-3 border-l-2 px-4 py-2.5", s.bar,
              alert.level === "error"   ? "border-l-red-500/60" :
              alert.level === "warning" ? "border-l-amber-500/60" :
                                          "border-l-blue-500/60"
            )}
          >
            <Icon className={cn("h-3.5 w-3.5 shrink-0", s.icon)} />
            <span className={cn("flex-1 text-xs", s.text)}>{alert.message}</span>
            {alert.link && (
              <Link
                href={alert.link}
                className={cn("flex items-center gap-0.5 text-[11px] font-medium shrink-0", s.icon, "hover:opacity-80 transition-opacity")}
              >
                Fix <ChevronRight className="h-3 w-3" />
              </Link>
            )}
            <button
              onClick={() => setDismissed(prev => new Set([...prev, key]))}
              className={cn("shrink-0 transition-colors", s.close)}
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function alertKey(a: HealthAlert) {
  return `${a.level}:${a.message}`;
}
