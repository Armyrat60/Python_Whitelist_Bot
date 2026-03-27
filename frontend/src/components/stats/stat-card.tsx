"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string | undefined;
  icon: LucideIcon;
  trend?: { value: number; label: string };
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  loading,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="flex items-center gap-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <span style={{ color: "var(--accent-primary)" }}>
            <Icon className="h-5 w-5" />
          </span>
        </div>
        <div className="flex-1 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Skeleton className="h-6 w-16" />
          ) : (
            <p className="text-2xl font-bold tracking-tight">
              {value ?? "--"}
            </p>
          )}
          {trend && !loading && (
            <p
              className={cn("text-xs", trend.value < 0 && "text-destructive")}
              style={trend.value >= 0 ? { color: "var(--accent-primary)" } : undefined}
            >
              {trend.value >= 0 ? "+" : ""}
              {trend.value}% {trend.label}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
