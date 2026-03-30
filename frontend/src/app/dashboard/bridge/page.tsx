"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  RefreshCw,
  Clock,
  Zap,
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

export default function BridgePage() {
  const { data, isLoading } = useBridgeConfig();
  const save    = useSaveBridgeConfig();
  const remove  = useDeleteBridgeConfig();
  const test    = useTestBridgeConnection();
  const { data: jobsData } = useBridgeJobs();

  const syncNow  = useSyncNow();
  const existing = data?.config ?? null;

  // Track the most recently enqueued job for live status
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const { data: jobData } = useJobStatus(activeJobId);
  const activeJob = jobData?.job ?? null;

  // Clear the job tracker once it finishes
  useEffect(() => {
    if (activeJob && (activeJob.status === "done" || activeJob.status === "failed")) {
      const timer = setTimeout(() => setActiveJobId(null), 8000);
      return () => clearTimeout(timer);
    }
  }, [activeJob?.status]);

  // Form state
  const [host,     setHost]     = useState("");
  const [port,     setPort]     = useState("3306");
  const [database, setDatabase] = useState("");
  const [user,     setUser]     = useState("");
  const [password, setPassword] = useState("");
  const [server,   setServer]   = useState("Game Server");
  const [interval, setInterval] = useState("15");
  const [enabled,  setEnabled]  = useState(true);

  // Sync form from fetched config
  useEffect(() => {
    if (!existing) return;
    setHost(existing.mysql_host);
    setPort(String(existing.mysql_port));
    setDatabase(existing.mysql_database);
    setUser(existing.mysql_user);
    setPassword(MASKED);
    setServer(existing.server_name);
    setInterval(String(existing.sync_interval_minutes));
    setEnabled(existing.enabled);
  }, [existing?.id]);

  function buildPayload() {
    return {
      mysql_host:            host.trim(),
      mysql_port:            parseInt(port, 10) || 3306,
      mysql_database:        database.trim(),
      mysql_user:            user.trim(),
      mysql_password:        password === MASKED ? MASKED : password,
      server_name:           server.trim() || "Game Server",
      sync_interval_minutes: parseInt(interval, 10) || 15,
      enabled,
    };
  }

  async function handleSave() {
    if (!host || !database || !user) {
      toast.error("Host, database, and username are required");
      return;
    }
    if (!existing && (!password || password === MASKED)) {
      toast.error("Password is required for a new connection");
      return;
    }
    try {
      await save.mutateAsync(buildPayload());
      toast.success("Bridge configuration saved");
    } catch {
      toast.error("Failed to save configuration");
    }
  }

  async function handleTest() {
    if (!host || !database || !user) {
      toast.error("Fill in host, database, and username first");
      return;
    }
    const payload = buildPayload();
    // If password is still masked, let the API use the stored one
    if (payload.mysql_password === MASKED) delete (payload as Record<string,unknown>).mysql_password;

    try {
      const result = await test.mutateAsync(payload);
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("Test request failed");
    }
  }

  async function handleSyncNow() {
    try {
      const result = await syncNow.mutateAsync();
      setActiveJobId(result.job_id);
      toast.success("Sync job queued");
    } catch {
      toast.error("Failed to queue sync");
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync();
      toast.success("Bridge configuration removed");
      setHost(""); setPort("3306"); setDatabase(""); setUser("");
      setPassword(""); setServer("Game Server"); setInterval("15"); setEnabled(true);
    } catch {
      toast.error("Failed to remove configuration");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0"
          style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
        >
          <Database className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white/90">SquadJS Bridge</h1>
          <p className="text-xs text-muted-foreground">
            Sync in-game player records from your SquadJS MySQL database
          </p>
        </div>
      </div>

      {/* Last sync status */}
      {existing && (
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Last Sync</span>
            <Badge variant={existing.enabled ? "default" : "secondary"} className="text-[10px]">
              {existing.enabled ? "Enabled" : "Disabled"}
            </Badge>
          </div>
          {existing.last_sync_at ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3 shrink-0" />
                {new Date(existing.last_sync_at).toLocaleString()}
              </div>
              <StatusBadge status={existing.last_sync_status} message={existing.last_sync_message} />
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
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="your-squadjs-host.com"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="3306"
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Database Name</Label>
          <Input
            value={database}
            onChange={(e) => setDatabase(e.target.value)}
            placeholder="squadjs"
            className="h-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Username</Label>
            <Input
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="squadjs_user"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Password</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={existing ? "Leave blank to keep current" : "••••••••"}
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
            <Label className="text-xs text-muted-foreground">Server Label</Label>
            <Input
              value={server}
              onChange={(e) => setServer(e.target.value)}
              placeholder="My Squad Server"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Sync Interval (minutes)</Label>
            <Input
              type="number"
              min={5}
              max={1440}
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <Label className="text-sm">
            {enabled ? "Bridge enabled — will sync on schedule" : "Bridge disabled — no syncing"}
          </Label>
        </div>
      </div>

      {/* Active job status */}
      {activeJob && (
        <div className={`rounded-lg border px-4 py-3 text-xs flex items-center gap-2 ${
          activeJob.status === "done"
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-400"
            : activeJob.status === "failed"
            ? "border-red-500/30 bg-red-500/5 text-red-400"
            : "border-white/[0.08] bg-white/[0.02] text-muted-foreground"
        }`}>
          {(activeJob.status === "pending" || activeJob.status === "running") && (
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
          )}
          {activeJob.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {activeJob.status === "failed" && <XCircle className="h-3.5 w-3.5 shrink-0" />}
          <span>
            {activeJob.status === "pending" && "Sync queued — waiting for worker..."}
            {activeJob.status === "running" && "Syncing players..."}
            {activeJob.status === "done" && (activeJob.result?.summary ?? "Sync complete")}
            {activeJob.status === "failed" && `Sync failed: ${activeJob.error}`}
          </span>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={save.isPending}
          style={{ background: "var(--accent-primary)" }}
          className="text-black font-semibold"
        >
          {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {existing ? "Save Changes" : "Connect"}
        </Button>

        <Button
          variant="outline"
          onClick={handleTest}
          disabled={test.isPending}
        >
          {test.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Test Connection
        </Button>

        {existing && (
          <Button
            variant="outline"
            onClick={handleSyncNow}
            disabled={syncNow.isPending || activeJob?.status === "pending" || activeJob?.status === "running"}
          >
            {(syncNow.isPending || activeJob?.status === "pending" || activeJob?.status === "running") ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="mr-1.5 h-3.5 w-3.5" />
            )}
            Sync Now
          </Button>
        )}

        {existing && (
          <AlertDialog>
            <AlertDialogTrigger render={<Button variant="ghost" className="ml-auto text-red-400 hover:text-red-300 hover:bg-red-500/10" disabled={remove.isPending} />}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Remove
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remove bridge configuration?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove your SquadJS MySQL connection settings. The bridge will stop syncing for this server. Player records already synced are kept.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                  Remove
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {/* Sync history */}
      {existing && jobsData && jobsData.jobs.length > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-white/80">Sync History</h2>
          <div className="space-y-2">
            {jobsData.jobs.map((job) => (
              <div key={job.id} className="flex items-start justify-between gap-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  {job.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                  {job.status === "failed" && <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
                  {(job.status === "pending" || job.status === "running") && (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground animate-spin" />
                  )}
                  <span className={`truncate ${
                    job.status === "done" ? "text-white/70" :
                    job.status === "failed" ? "text-red-400/80" : "text-muted-foreground"
                  }`}>
                    {job.status === "done" && (job.result?.summary ?? "Sync complete")}
                    {job.status === "failed" && (job.error ?? "Sync failed")}
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
        and syncs player Steam IDs into the whitelister. Players whose Steam IDs match a registered Discord user are
        automatically linked — you can then search them by in-game name from the Player Search page.
      </p>
    </div>
  );
}
