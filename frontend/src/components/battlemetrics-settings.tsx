"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import {
  useBattleMetricsConfig,
  useSaveBattleMetricsConfig,
  useDeleteBattleMetricsConfig,
  useTestBattleMetrics,
  useBattleMetricsServers,
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

export function BattleMetricsSettings() {
  const { data, isLoading } = useBattleMetricsConfig();
  const save = useSaveBattleMetricsConfig();
  const remove = useDeleteBattleMetricsConfig();
  const test = useTestBattleMetrics();
  const { data: serversData } = useBattleMetricsServers();

  const existing = data?.config ?? null;
  const discoveredServers = serversData?.servers ?? [];

  const [apiKey, setApiKey] = useState("");
  const [selectedServers, setSelectedServers] = useState<Array<{ id: string; name: string }>>([]);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!existing) return;
    setApiKey(MASKED);
    setSelectedServers(existing.servers?.map(s => ({ id: s.id, name: s.name ?? "" })) ?? []);
    setEnabled(existing.enabled);
  }, [existing?.has_api_key]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggleServer(srv: { id: string; name: string }) {
    setSelectedServers((prev) => {
      const exists = prev.some((s) => s.id === srv.id);
      if (exists) return prev.filter((s) => s.id !== srv.id);
      if (prev.length >= 5) return prev; // max 5
      return [...prev, srv];
    });
  }

  async function handleSave() {
    if (!existing && (!apiKey || apiKey === MASKED)) {
      toast.error("API key is required");
      return;
    }
    try {
      await save.mutateAsync({
        api_key: apiKey === MASKED ? MASKED : apiKey,
        servers: selectedServers,
        enabled,
      });
      toast.success("BattleMetrics config saved");
    } catch {
      toast.error("Failed to save");
    }
  }

  async function handleTest() {
    try {
      const r = await test.mutateAsync({
        api_key: apiKey === MASKED ? MASKED : apiKey,
        server_id: selectedServers[0]?.id || undefined,
      });
      if (r.ok) {
        toast.success(r.message);
      } else {
        toast.error(r.message);
      }
    } catch {
      toast.error("Test failed");
    }
  }

  async function handleDelete() {
    try {
      await remove.mutateAsync();
      toast.success("BattleMetrics config removed");
      setApiKey("");
      setSelectedServers([]);
      setEnabled(true);
    } catch {
      toast.error("Failed to remove");
    }
  }

  if (isLoading) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              BattleMetrics
              {existing && (
                <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Track player hours and admin activity from BattleMetrics.{" "}
              <a
                href="https://www.battlemetrics.com/developers"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 hover:underline"
                style={{ color: "var(--accent-primary)" }}
              >
                Get API token <ExternalLink className="h-3 w-3" />
              </a>
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {existing && (
          <div className="flex items-center gap-3">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            <Label className="text-sm">
              {enabled ? "BattleMetrics integration enabled" : "BattleMetrics integration disabled"}
            </Label>
          </div>
        )}

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">API Token</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={existing ? "Leave blank to keep current" : "BattleMetrics API token"}
            className="h-8 text-xs"
          />
        </div>

        {/* Server selection — multi-select from discovered servers */}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">
            Tracked Servers
            <span className="text-muted-foreground/50 ml-1">({selectedServers.length}/5 max)</span>
          </Label>
          {discoveredServers.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto rounded-lg border border-white/[0.08] bg-white/[0.02] p-2">
              {discoveredServers.map((s) => {
                const isSelected = selectedServers.some((sel) => sel.id === s.id);
                return (
                  <label
                    key={s.id}
                    className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-pointer transition-colors ${
                      isSelected ? "bg-white/[0.06] ring-1 ring-white/[0.10]" : "hover:bg-white/[0.04]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleServer({ id: s.id, name: s.name })}
                      disabled={!isSelected && selectedServers.length >= 5}
                      className="rounded border-white/20 accent-[var(--accent-primary)]"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-white/80 truncate block">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground">{s.players}/{s.maxPlayers} — {s.status}</span>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground/70 py-2">
              {existing?.has_api_key
                ? "No servers found — check your API token permissions."
                : "Save your API token first, then servers will auto-populate."}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={handleSave}
            disabled={save.isPending}
            style={{ background: "var(--accent-primary)" }}
            className="text-black font-semibold"
            size="sm"
          >
            {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {existing ? "Save Changes" : "Connect"}
          </Button>
          <Button variant="outline" size="sm" onClick={handleTest} disabled={test.isPending}>
            {test.isPending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Test Connection
          </Button>
        </div>

        {existing && (
          <div className="pt-3 border-t border-white/[0.06]">
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    disabled={remove.isPending}
                  />
                }
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove BattleMetrics
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove BattleMetrics integration?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This removes your API key and server configuration. Player hour data from BattleMetrics will no longer be available.
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}
