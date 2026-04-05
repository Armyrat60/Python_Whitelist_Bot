"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Users } from "lucide-react";
import { useWhitelists } from "@/hooks/use-settings";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface RoleSyncMember {
  discord_id: string;
  discord_name: string;
}

interface RoleSyncResult {
  role_name: string;
  whitelist_slug: string;
  total_role_members: number;
  added: RoleSyncMember[];
  already_exist: number;
  dry_run: boolean;
}

export default function RoleSyncTab() {
  const { data: whitelists } = useWhitelists();
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [targetWhitelist, setTargetWhitelist] = useState("");
  const [result, setResult] = useState<RoleSyncResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-select default whitelist
  useEffect(() => {
    if (!whitelists?.length || targetWhitelist) return;
    const def = whitelists.find((w: { slug: string }) => w.slug === "default") ?? whitelists[0];
    if (def) setTargetWhitelist(def.slug);
  }, [whitelists]);

  // Load Discord roles
  useEffect(() => {
    setRolesLoading(true);
    fetch("/api/admin/roles", { credentials: "include" })
      .then(async (r) => {
        const text = await r.text();
        let d: Record<string, unknown> = {};
        try { d = JSON.parse(text); } catch { /* ignore parse error */ }
        if (!r.ok) {
          toast.error((d.error as string) || `Failed to load roles: ${r.status} ${r.statusText}`);
          return;
        }
        setRoles((d.roles as { id: string; name: string }[]) ?? []);
      })
      .catch(() => toast.error("Failed to load Discord roles"))
      .finally(() => setRolesLoading(false));
  }, []);

  async function runSync(dry_run: boolean) {
    if (!selectedRole) { toast.error("Select a Discord role"); return; }
    if (!targetWhitelist) { toast.error("Select a target whitelist"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/role-sync/pull", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: selectedRole, whitelist_slug: targetWhitelist, dry_run }),
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* proxy returned plain-text error */ }
      if (!res.ok) throw new Error((data.error as string) || `Server error: ${res.status} ${res.statusText}`);
      setResult(data as unknown as RoleSyncResult);
      if (!dry_run) {
        toast.success(`Pulled ${(data.added as unknown[])?.length ?? 0} members into ${targetWhitelist}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      {/* How it works info */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Pull all current members of a Discord role into a whitelist. Members are added with
            their Discord ID — they still need to self-register their Steam ID via the bot.
            The bot also automatically adds/removes members in real-time as roles change, and
            runs a daily reconciliation to catch any gaps.
          </p>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Discord Role</Label>
          <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v ?? "")} disabled={rolesLoading}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder={rolesLoading ? "Loading…" : "Select role"} />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="flex items-center gap-2">
                    <Users className="h-3 w-3 opacity-50" />
                    {r.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Target Whitelist</Label>
          <Select value={targetWhitelist} onValueChange={(v) => setTargetWhitelist(v ?? "")}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select whitelist" />
            </SelectTrigger>
            <SelectContent>
              {whitelists?.map((wl) => (
                <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 pb-0.5">
          <Button variant="outline" onClick={() => runSync(true)} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Preview
          </Button>
          <Button onClick={() => runSync(false)} disabled={loading || !result}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Pull Members
          </Button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {result.dry_run ? "Preview" : "Result"} — @{result.role_name} → {result.whitelist_slug}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{result.total_role_members} total in role</span>
              <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
                {result.added.length} {result.dry_run ? "would be added" : "added"}
              </span>
              <span className="rounded-md bg-white/5 px-3 py-1 text-xs text-muted-foreground">{result.already_exist} already in whitelist</span>
            </div>

            {result.added.length > 0 && (
              <div className="rounded-lg border border-white/[0.10]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Discord ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.added.slice(0, 100).map((m) => (
                      <TableRow key={m.discord_id}>
                        <TableCell className="text-xs">{m.discord_name}</TableCell>
                        <TableCell className="font-mono text-xs">{m.discord_id}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {result.added.length > 100 && (
                  <p className="px-4 py-2 text-xs text-muted-foreground">Showing 100 of {result.added.length}</p>
                )}
              </div>
            )}

            {result.dry_run && result.added.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Click <strong>Pull Members</strong> to apply these changes.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
