"use client";

import {
  Users,
  Hash,
  Shield,
  Columns3,
  RefreshCw,
  Settings2,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useStats, useHealth, useAudit } from "@/hooks/use-settings";
import { api } from "@/lib/api";
import { StatCard } from "@/components/stats/stat-card";
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
          value={stats?.total_users}
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
          value={stats?.whitelists_count}
          icon={Shield}
          loading={statsLoading}
        />
        <StatCard
          label="Panels"
          value={stats?.panels_count}
          icon={Columns3}
          loading={statsLoading}
        />
      </div>

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

      {/* Charts placeholder + bottom sections */}
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
            ) : health ? (
              <>
                <HealthRow
                  label="Bot Connected"
                  ok={health.bot_connected}
                />
                <HealthRow
                  label="Database"
                  ok={health.db_connected}
                />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Guilds Cached</span>
                  <span className="font-medium">{health.guilds_cached}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Files Cached</span>
                  <span className="font-medium">{health.files_cached}</span>
                </div>
                {health.last_sync && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Last sync:{" "}
                    {new Date(health.last_sync).toLocaleString()}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Unable to load health data
              </p>
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
          ) : audit?.entries.length ? (
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
                  {entry.whitelist_name && (
                    <Badge variant="outline" className="shrink-0">
                      {entry.whitelist_name}
                    </Badge>
                  )}
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

function HealthRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        {ok ? (
          <CheckCircle2 className={cn("h-4 w-4 text-emerald-500")} />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
        <span className={cn("font-medium", ok ? "text-emerald-500" : "text-destructive")}>
          {ok ? "Online" : "Offline"}
        </span>
      </div>
    </div>
  );
}
