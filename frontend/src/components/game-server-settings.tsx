"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Server,
  Plus,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  ChevronDown,
  ChevronUp,
  X,
} from "lucide-react";
import {
  useGameServers,
  useAddGameServer,
  useUpdateGameServer,
  useDeleteGameServer,
  useTestSftp,
  usePushWhitelist,
} from "@/hooks/use-settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
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

const MASKED = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

function ServerForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: { name: string; sftp_host: string; sftp_port: number; sftp_user: string; sftp_password: string; sftp_base_path: string };
  onSave: (data: { name: string; sftp_host: string; sftp_port: number; sftp_user: string; sftp_password: string; sftp_base_path: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.sftp_host ?? "");
  const [port, setPort] = useState(String(initial?.sftp_port ?? 22));
  const [user, setUser] = useState(initial?.sftp_user ?? "");
  const [password, setPassword] = useState(initial?.sftp_password ?? "");
  const [basePath, setBasePath] = useState(initial?.sftp_base_path ?? "/SquadGame/ServerConfig");

  return (
    <div className="space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Server Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. US Server 1" className="h-8 text-xs" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2 space-y-1.5">
            <Label className="text-xs text-muted-foreground">SFTP Host</Label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="your-server.com" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Port</Label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="22" className="h-8 text-xs" />
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Username</Label>
          <Input value={user} onChange={(e) => setUser(e.target.value)} placeholder="sftp_user" className="h-8 text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Password</Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={initial ? "Leave blank to keep" : "Password"} className="h-8 text-xs" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Base Path</Label>
        <Input value={basePath} onChange={(e) => setBasePath(e.target.value)} placeholder="/SquadGame/ServerConfig" className="h-8 text-xs" />
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => onSave({ name: name.trim(), sftp_host: host.trim(), sftp_port: parseInt(port, 10) || 22, sftp_user: user.trim(), sftp_password: password, sftp_base_path: basePath.trim() })}
          disabled={saving || !name.trim()}
          className="font-semibold text-black"
          style={{ background: "var(--accent-primary)" }}
        >
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function ServerCard({ server }: { server: { id: number; name: string; sftp_host: string | null; sftp_port: number; sftp_user: string | null; sftp_password: string | null; sftp_base_path: string; enabled: boolean } }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const update = useUpdateGameServer();
  const remove = useDeleteGameServer();
  const test = useTestSftp();
  const push = usePushWhitelist();

  const hasCredentials = !!server.sftp_host && !!server.sftp_user;

  async function handleTest() {
    try {
      const r = await test.mutateAsync(server.id);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch { toast.error("Test failed"); }
  }

  async function handlePush() {
    try {
      const r = await push.mutateAsync(server.id);
      r.ok ? toast.success(r.message) : toast.error(r.message);
    } catch { toast.error("Push failed"); }
  }

  async function handleUpdate(data: Record<string, unknown>) {
    try {
      await update.mutateAsync({ id: server.id, ...data } as any);
      toast.success("Server updated");
      setEditing(false);
    } catch { toast.error("Failed to update"); }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync(server.id);
      toast.success("Server removed");
    } catch { toast.error("Failed to remove"); }
  }

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02]">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-white/90">{server.name}</span>
          {hasCredentials && (
            <Badge variant="secondary" className="text-[9px]">{server.sftp_host}:{server.sftp_port}</Badge>
          )}
          <Badge variant={server.enabled ? "default" : "secondary"} className="text-[9px]">
            {server.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {hasCredentials && (
            <>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleTest} disabled={test.isPending}>
                {test.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                <span className="ml-1 hidden sm:inline">Test</span>
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handlePush} disabled={push.isPending}>
                {push.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                <span className="ml-1 hidden sm:inline">Push</span>
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {expanded && !editing && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-muted-foreground">Host:</span> <span className="text-white/70">{server.sftp_host || "—"}</span></div>
            <div><span className="text-muted-foreground">Port:</span> <span className="text-white/70">{server.sftp_port}</span></div>
            <div><span className="text-muted-foreground">User:</span> <span className="text-white/70">{server.sftp_user || "—"}</span></div>
            <div><span className="text-muted-foreground">Path:</span> <span className="text-white/70">{server.sftp_base_path}</span></div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setEditing(true)}>Edit</Button>
            <AlertDialog>
              <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300" />}>
                <Trash2 className="mr-1 h-3 w-3" /> Remove
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove {server.name}?</AlertDialogTitle>
                  <AlertDialogDescription>SFTP credentials will be deleted. This does not affect the game server itself.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}

      {expanded && editing && (
        <div className="border-t border-white/[0.06] p-4">
          <ServerForm
            initial={{
              name: server.name,
              sftp_host: server.sftp_host ?? "",
              sftp_port: server.sftp_port,
              sftp_user: server.sftp_user ?? "",
              sftp_password: server.sftp_password ?? "",
              sftp_base_path: server.sftp_base_path,
            }}
            onSave={handleUpdate}
            onCancel={() => setEditing(false)}
            saving={update.isPending}
          />
        </div>
      )}
    </div>
  );
}

export function GameServerSettings() {
  const { data, isLoading } = useGameServers();
  const addServer = useAddGameServer();
  const [showAdd, setShowAdd] = useState(false);

  const servers = data?.servers ?? [];

  async function handleAdd(formData: Record<string, unknown>) {
    try {
      await addServer.mutateAsync(formData as any);
      toast.success("Server added");
      setShowAdd(false);
    } catch { toast.error("Failed to add server"); }
  }

  if (isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
              Game Servers
            </CardTitle>
            <CardDescription>
              Manage SFTP connections to push whitelist files directly to your game servers.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? <X className="mr-1 h-3.5 w-3.5" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
            {showAdd ? "Cancel" : "Add Server"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <ServerForm onSave={handleAdd} onCancel={() => setShowAdd(false)} saving={addServer.isPending} />
        )}

        {servers.length === 0 && !showAdd && (
          <p className="text-sm text-muted-foreground/60 italic py-4 text-center">
            No game servers configured. Add a server to push whitelist files via SFTP.
          </p>
        )}

        {servers.map((server) => (
          <ServerCard key={server.id} server={server} />
        ))}
      </CardContent>
    </Card>
  );
}
