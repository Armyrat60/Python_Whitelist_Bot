"use client";

import {
  Users,
  Hash,
  Shield,
  PanelTop,
  RefreshCw,
  Settings2,
  AlertTriangle,
  Info,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useStats, useHealth, useAudit, useWhitelists, usePanels, useSettings } from "@/hooks/use-settings";
import { api } from "@/lib/api";
import { StatCard } from "@/components/stats/stat-card";
import { SetupGuide } from "@/components/setup-guide";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { data: health, isLoading: healthLoading } = useHealth();
  const { data: audit, isLoading: auditLoading } = useAudit(1, 10);
  const { data: whitelists } = useWhitelists();
  const { data: panels } = usePanels();
  const { data: settingsData } = useSettings();

  const whitelistCount = whitelists?.length ?? 0;
  const panelCount = panels?.length ?? 0;

  // Setup guide state
  const hasWhitelistEnabled = whitelists?.some((w) => w.enabled) ?? false;
  const hasRoleMappings = settingsData?.role_mappings
    ? Object.values(settingsData.role_mappings).some((arr) => arr.length > 0)
    : false;
  const hasPanelChannel = panels?.some((p) => p.channel_id) ?? false;

  async function handleResync() {
    try {
      await api.post("/api/admin/resync");
      toast.success("Resync triggered successfully");
    } catch {
      toast.error("Failed to trigger resync");
    }
  }

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Users"
          value={stats?.total_active_users}
          icon={Users}
          loading={statsLoading}
        />
        <StatCard
          label="Active IDs"
          value={stats?.total_identifiers}
          icon={Hash}
          loading={statsLoading}
        />
        <StatCard
          label="Whitelists"
          value={whitelistCount}
          icon={Shield}
          loading={statsLoading}
        />
        <StatCard
          label="Panels"
          value={panelCount}
          icon={PanelTop}
          loading={statsLoading}
        />
      </div>

      {/* Setup Guide */}
      <SetupGuide
        hasWhitelistEnabled={hasWhitelistEnabled}
        hasRoleMappings={hasRoleMappings}
        hasPanelChannel={hasPanelChannel}
      />

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={handleResync}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Resync
        </Button>
        <Link href="/dashboard/setup">
          <Button variant="outline" size="sm">
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            Go to Setup
          </Button>
        </Link>
      </div>

      {/* Charts placeholder + Health */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Placeholder for charts */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Charts coming soon</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-zinc-700 text-muted-foreground">
              Recharts integration placeholder
            </div>
          </CardContent>
        </Card>

        {/* Health Status */}
        <Card>
          <CardHeader>
            <CardTitle>Health Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthLoading ? (
              <>
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </>
            ) : health?.alerts?.length ? (
              <div className="space-y-2">
                {health.alerts.map((alert, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                      alert.level === "warning"
                        ? "border-amber-800 bg-amber-950/30 text-amber-400"
                        : alert.level === "error"
                        ? "border-red-800 bg-red-950/30 text-red-400"
                        : "border-blue-800 bg-blue-950/30 text-blue-400"
                    )}
                  >
                    {alert.level === "warning" ? (
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{alert.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-400">
                <Shield className="h-4 w-4" />
                All systems healthy — no alerts
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Audit */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>Latest 10 audit entries</CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : audit?.entries?.length ? (
            <div className="space-y-2">
              {audit.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2 text-sm"
                >
                  <Badge variant="secondary" className="shrink-0">
                    {entry.action_type}
                  </Badge>
                  <span className="flex-1 truncate text-muted-foreground">
                    {entry.details ?? "No details"}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No audit entries yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
