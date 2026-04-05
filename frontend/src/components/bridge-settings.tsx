"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Database,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Zap,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import {
  useBridgeConfig,
  useSaveBridgeConfig,
  useDeleteBridgeConfig,
  useTestBridgeConnection,
  useSyncNow,
  useJobStatus,
  useBridgeJobs,
} from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

const MASKED = "••••••••";

function StatusBadge({ status, message }: { status: "ok" | "error" | null; message: string | null }) {
  if (!status) return null;
  if (status === "ok") {
    return (
      <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{message}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 text-red-400 text-xs">
      <XCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{message}</span>
    </div>
  );
}

function SetupGuide({ dbName }: { dbName: string }) {
  const [open, setOpen] = useState(false);
  const db = dbName.trim() || "YOUR_SQUADJS_DB";

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      <button
        className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-white/[0.03] transition-colors"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" style={{ color: "var(--accent-primary)" }} />
          <span className="text-sm font-semibold text-white/80">MySQL Setup Guide</span>
        </div>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-white/[0.10] px-5 py-4 space-y-4 text-xs">
          <p className="text-muted-foreground">
            Create a <strong className="text-white/70">read-only</strong> MySQL user for the bridge. It only needs{" "}
            <code className="rounded bg-white/[0.06] px-1">SELECT</code> on the{" "}
            <code className="rounded bg-white/[0.06] px-1">DBLog_Players</code> table.
          </p>

          <div className="space-y-1.5">
            <p className="font-semibold text-white/60 uppercase tracking-wider text-[10px]">Suggested credentials</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white/[0.04] border border-white/[0.10] px-3 py-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Username</p>
                <code className="text-white/80">whitelister</code>
              </div>
              <div className="rounded-lg bg-white/[0.04] border border-white/[0.10] px-3 py-2 space-y-0.5">
                <p className="text-[10px] text-muted-foreground/70 uppercase tracking-wide">Password</p>
                <code className="text-white/80">ChangeMe123!</code>
                <p className="text-[10px] text-amber-400/80 mt-0.5">Change this before use</p>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="font-semibold text-white/60 uppercase tracking-wider text-[10px]">Run on your MySQL server</p>
            <pre className="rounded-lg bg-black/40 border border-white/[0.10] px-4 py-3 text-[11px] text-green-400/90 overflow-x-auto leading-relaxed whitespace-pre">{`-- Create a read-only user (accessible from any host)
CREATE USER 'whitelister'@'%' IDENTIFIED BY 'ChangeMe123!';

-- Grant SELECT only on the DBLog_Players table
GRANT SELECT ON ${db}.DBLog_Players TO 'whitelister'@'%';

-- Apply changes
FLUSH PRIVILEGES;`}</pre>
          </div>

          <div className="space-y-1.5">
            <p className="font-semibold text-white/60 uppercase tracking-wider text-[10px]">Required permissions</p>
            <div className="rounded-lg bg-white/[0.03] border border-white/[0.10] px-3 py-2 flex items-center gap-3">
              <code className="text-emerald-400 w-16 shrink-0">SELECT</code>
              <code className="text-white/70 flex-1">DBLog_Players</code>
              <span className="text-muted-foreground/70">Read player join records</span>
            </div>
          </div>

          <p className="text-muted-foreground/70">
            Make sure your MySQL server allows remote connections from the bridge host. Check{" "}
            <code className="rounded bg-white/[0.06] px-1">bind-address</code> in{" "}
            <code className="rounded bg-white/[0.06] px-1">my.cnf</code> and your firewall rules (port 3306).
          </p>
        </div>
      )}
    </div>
  );
}

export function BridgeSettings() {
  const { data: bridgeData, isLoading: bridgeLoading } = useBridgeConfig();
  const bridgeSave   = useSaveBridgeConfig();
  const bridgeRemove = useDeleteBridgeConfig();
  const bridgeTest   = useTestBridgeConnection();
  const { data: bridgeJobsData } = useBridgeJobs();
  const bridgeSyncNow = useSyncNow();
  const bridgeExisting = bridgeData?.config ?? null;

  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const { data: jobData } = useJobStatus(activeJobId);
  const activeJob = jobData?.job ?? null;

  useEffect(() => {
    if (activeJob && (activeJob.status === "done" || activeJob.status === "failed")) {
      const timer = setTimeout(() => setActiveJobId(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [activeJob?.status]);

  // Pre-fill with SquadJS defaults for new configs
  const [bridgeHost,     setBridgeHost]     = useState("");
  const [bridgePort,     setBridgePort]     = useState("3306");
  const [bridgeDatabase, setBridgeDatabase] = useState("squadjs");
  const [bridgeUser,     setBridgeUser]     = useState("whitelister");
  const [bridgePassword, setBridgePassword] = useState("");
  const [bridgeServer,   setBridgeServer]   = useState("Game Server");
  const [bridgeInterval, setBridgeInterval] = useState("15");
  const [bridgeEnabled,  setBridgeEnabled]  = useState(true);

  useEffect(() => {
    if (!bridgeExisting) return;
    setBridgeHost(bridgeExisting.mysql_host);
    setBridgePort(String(bridgeExisting.mysql_port));
    setBridgeDatabase(bridgeExisting.mysql_database);
    setBridgeUser(bridgeExisting.mysql_user);
    setBridgePassword(MASKED);
    setBridgeServer(bridgeExisting.server_name);
    setBridgeInterval(String(bridgeExisting.sync_interval_minutes));
    setBridgeEnabled(bridgeExisting.enabled);
  }, [bridgeExisting?.id]);

  function buildBridgePayload() {
    return {
      mysql_host:            bridgeHost.trim(),
      mysql_port:            parseInt(bridgePort, 10) || 3306,
      mysql_database:        bridgeDatabase.trim(),
      mysql_user:            bridgeUser.trim(),
      mysql_password:        bridgePassword === MASKED ? MASKED : bridgePassword,
      server_name:           bridgeServer.trim() || "Game Server",
      sync_interval_minutes: parseInt(bridgeInterval, 10) || 15,
      enabled:               bridgeEnabled,
    };
  }

  async function handleBridgeSave() {
    if (!bridgeHost || !bridgeDatabase || !bridgeUser) { toast.error("Host, database, and username are required"); return; }
    if (!bridgeExisting && (!bridgePassword || bridgePassword === MASKED)) { toast.error("Password is required for a new connection"); return; }
    try {
      await bridgeSave.mutateAsync(buildBridgePayload());
      toast.success("Bridge configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    }
  }

  async function handleBridgeTest() {
    if (!bridgeHost || !bridgeDatabase || !bridgeUser) { toast.error("Fill in host, database, and username first"); return; }
    const payload = buildBridgePayload();
    if (payload.mysql_password === MASKED) delete (payload as Record<string, unknown>).mysql_password;
    try {
      const result = await bridgeTest.mutateAsync(payload);
      if (result.ok) { toast.success(result.message); } else { toast.error(result.message); }
    } catch {
      toast.error("Test request failed");
    }
  }

  async function handleBridgeSyncNow() {
    try {
      const result = await bridgeSyncNow.mutateAsync();
      setActiveJobId(result.job_id);
      toast.success("Sync job queued");
    } catch {
      toast.error("Failed to queue sync");
    }
  }

  async function handleBridgeDelete() {
    try {
      await bridgeRemove.mutateAsync();
      toast.success("Bridge configuration removed");
      setBridgeHost(""); setBridgePort("3306"); setBridgeDatabase("squadjs"); setBridgeUser("whitelister");
      setBridgePassword(""); setBridgeServer("Game Server"); setBridgeInterval("15"); setBridgeEnabled(true);
    } catch {
      toast.error("Failed to remove configuration");
    }
  }

  if (bridgeLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Database className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white/90">SquadJS Bridge</h2>
          <p className="text-xs text-muted-foreground">
            Sync in-game player records from your SquadJS MySQL database
          </p>
        </div>
      </div>

      {/* Setup guide */}
      <SetupGuide dbName={bridgeDatabase} />

      {/* Last sync status */}
      {bridgeExisting && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Sync</span>
            <Badge variant={bridgeExisting.enabled ? "default" : "secondary"} className="text-[10px]">
              {bridgeExisting.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          {bridgeExisting.last_sync_at ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                {new Date(bridgeExisting.last_sync_at).toLocaleString()}
              </div>
              <StatusBadge status={bridgeExisting.last_sync_status} message={bridgeExisting.last_sync_message} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No sync run yet</p>
          )}
        </div>
      )}

      {/* Connection form */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white/80">MySQL Connection</h2>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">Host</Label>
            <Input
              value={bridgeHost}
              onChange={(e) => setBridgeHost(e.target.value)}
              placeholder="your-squadjs-host.com"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input
              value={bridgePort}
              onChange={(e) => setBridgePort(e.target.value)}
              placeholder="3306"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Database Name</Label>
          <Input
            value={bridgeDatabase}
            onChange={(e) => setBridgeDatabase(e.target.value)}
            placeholder="squadjs"
            className="h-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input
              value={bridgeUser}
              onChange={(e) => setBridgeUser(e.target.value)}
              placeholder="whitelister"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input
              type="password"
              value={bridgePassword}
              onChange={(e) => setBridgePassword(e.target.value)}
              placeholder={bridgeExisting ? "Leave blank to keep current" : "••••••••"}
              className="h-8 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Sync settings */}
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-white/80">Sync Settings</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Game Server Name</Label>
            <Input
              value={bridgeServer}
              onChange={(e) => setBridgeServer(e.target.value)}
              placeholder="My Squad Server"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Labels player records by server. Optional if you run one server.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sync Interval (minutes)</Label>
            <Input
              type="number"
              min={5}
              max={1440}
              value={bridgeInterval}
              onChange={(e) => setBridgeInterval(e.target.value)}
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground/60">
              Only new/updated records are fetched after the first sync.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={bridgeEnabled} onCheckedChange={setBridgeEnabled} />
          <Label className="text-sm">
            {bridgeEnabled ? "Bridge enabled — will sync on schedule" : "Bridge disabled — no syncing"}
          </Label>
        </div>
      </div>

      {/* Active job status */}
      {activeJob && (
        <div className={cn(
          "rounded-lg border px-4 py-3 text-xs flex items-center gap-2",
          activeJob.status === "done"   && "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
          activeJob.status === "failed" && "border-red-500/30 bg-red-500/5 text-red-400",
          (activeJob.status === "pending" || activeJob.status === "running") && "border-white/[0.08] bg-white/[0.02] text-muted-foreground",
        )}>
          {(activeJob.status === "pending" || activeJob.status === "running") && (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          )}
          {activeJob.status === "done"   && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {activeJob.status === "failed" && <XCircle className="h-3.5 w-3.5 shrink-0" />}
          <span>
            {activeJob.status === "pending" && "Sync queued — waiting for worker..."}
            {activeJob.status === "running" && "Syncing players..."}
            {activeJob.status === "done"    && (activeJob.result?.summary ?? "Sync complete")}
            {activeJob.status === "failed"  && `Sync failed: ${activeJob.error}`}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          onClick={handleBridgeSave}
          disabled={bridgeSave.isPending}
          style={{ background: "var(--accent-primary)" }}
          className="text-black font-semibold"
        >
          {bridgeSave.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {bridgeExisting ? "Save Changes" : "Connect"}
        </Button>

        <Button variant="outline" onClick={handleBridgeTest} disabled={bridgeTest.isPending}>
          {bridgeTest.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Test Connection
        </Button>

        {bridgeExisting && (
          <Button
            variant="outline"
            onClick={handleBridgeSyncNow}
            disabled={bridgeSyncNow.isPending || activeJob?.status === "pending" || activeJob?.status === "running"}
          >
            {(bridgeSyncNow.isPending || activeJob?.status === "pending" || activeJob?.status === "running") ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sync Now
          </Button>
        )}

        {bridgeExisting && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" className="ml-auto text-red-400 hover:text-red-300 hover:bg-red-500/10" disabled={bridgeRemove.isPending} />}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove bridge configuration?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove your SquadJS MySQL connection settings. The bridge will stop syncing. Player records already synced are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleBridgeDelete} className="bg-red-600 hover:bg-red-700">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Sync history */}
      {bridgeExisting && bridgeJobsData && bridgeJobsData.jobs.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white/80">Sync History</h2>
          <div className="space-y-2">
            {bridgeJobsData.jobs.map((job) => (
              <div key={job.id} className="flex items-start justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {job.status === "done"   && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                  {job.status === "failed" && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  {(job.status === "pending" || job.status === "running") && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin" />
                  )}
                  <span className={cn(
                    "truncate",
                    job.status === "done"   && "text-white/70",
                    job.status === "failed" && "text-red-400/80",
                    (job.status === "pending" || job.status === "running") && "text-muted-foreground",
                  )}>
                    {job.status === "done"    && (job.result?.summary ?? "Sync complete")}
                    {job.status === "failed"  && (job.error ?? "Sync failed")}
                    {job.status === "running" && "Syncing…"}
                    {job.status === "pending" && "Queued"}
                  </span>
                </div>
                <span className="text-muted-foreground shrink-0">
                  {new Date(job.created_at).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        The bridge reads from <code className="rounded bg-white/[0.06] px-1">DBLog_Players</code> in your SquadJS database
        and syncs player Steam IDs. After the first full sync, only new or updated records are fetched.
        Players whose Steam IDs match a registered Discord user are automatically linked — searchable by in-game name.
      </p>
    </div>
  );
}
