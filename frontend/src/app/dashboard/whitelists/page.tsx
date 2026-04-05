"use client";

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  Copy,
  Check,
  X,
  RefreshCw,
  Shield,
} from "lucide-react";
import {
  useWhitelists,
  useGroups,
  useToggleWhitelist,
  useCreateWhitelist,
  useDeleteWhitelist,
} from "@/hooks/use-settings";
import { api } from "@/lib/api";
import type { Whitelist, SquadGroup } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Combobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WhitelistsPage() {
  const { data: whitelists, isLoading, isError } = useWhitelists();
  const { data: groups } = useGroups();
  const toggleWhitelist = useToggleWhitelist();
  const createWhitelist = useCreateWhitelist();
  const deleteWhitelist = useDeleteWhitelist();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const roleWhitelists = useMemo(() => whitelists?.filter(wl => !wl.is_manual) ?? [], [whitelists]);

  function handleCreateWhitelist() {
    if (!newName.trim()) return;
    const slug = slugify(newName.trim());
    createWhitelist.mutate(
      { name: newName.trim(), output_filename: `${slug}.txt`, is_manual: false },
      {
        onSuccess: () => {
          toast.success("Whitelist created");
          setNewName("");
          setCreateOpen(false);
        },
        onError: () => toast.error("Failed to create whitelist"),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12 text-center">
        <p className="text-sm font-medium text-red-400">Failed to load data</p>
        <p className="mt-1 text-xs text-muted-foreground">Check your connection and refresh the page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ─── Discord Whitelists Section ─────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Discord Whitelists</h2>
            <p className="text-xs text-muted-foreground">Role-based whitelists synced from Discord roles.</p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger
              render={
                <Button variant="outline" size="sm">
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create Whitelist
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Whitelist</DialogTitle>
                <DialogDescription>
                  Choose a template or enter a custom name.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { name: "Subscribers", file: "subscribers.txt" },
                    { name: "Clan",        file: "clan.txt" },
                    { name: "Staff",       file: "staff.txt" },
                    { name: "VIP",         file: "vip.txt" },
                  ].map((tpl) => (
                    <Button
                      key={tpl.name}
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => setNewName(tpl.name)}
                    >
                      {tpl.name}
                    </Button>
                  ))}
                </div>
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-white/[0.08]" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-card px-2 text-muted-foreground">or custom</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Tournament Whitelist"
                    onKeyDown={(e) => e.key === "Enter" && handleCreateWhitelist()}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleCreateWhitelist}
                  disabled={createWhitelist.isPending || !newName.trim()}
                >
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {roleWhitelists.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-12 text-center">
            <Shield className="h-8 w-8 text-muted-foreground/50 mb-3" />
            <p className="text-sm font-medium">No whitelists yet</p>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm">Whitelists hold your player roster. Create one, then add Discord roles under Configure to control who gets whitelisted and how many slots they receive.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {roleWhitelists.map((wl) => (
              <WhitelistCard
                key={wl.id}
                whitelist={wl}
                groups={groups ?? []}
                onToggle={() =>
                  toggleWhitelist.mutate(wl.slug, {
                    onSuccess: () => toast.success(`Whitelist ${wl.enabled ? "disabled" : "enabled"}`),
                    onError:   () => toast.error("Failed to toggle whitelist"),
                  })
                }
                onDelete={() =>
                  deleteWhitelist.mutate(wl.slug, {
                    onSuccess: () => toast.success("Whitelist deleted"),
                    onError:   () => toast.error("Failed to delete whitelist"),
                  })
                }
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

// ─── WhitelistCard (role-based) ───────────────────────────────────────────────

function WhitelistCard({
  whitelist,
  groups,
  onToggle,
  onDelete,
}: {
  whitelist: Whitelist;
  groups: SquadGroup[];
  onToggle: () => void;
  onDelete: () => void;
}) {
  const url = whitelist.url ?? "";
  const qc = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(whitelist.name);
  const [savingName, setSavingName] = useState(false);

  function copyUrl() {
    navigator.clipboard.writeText(url);
    toast.success("URL copied to clipboard");
  }

  async function handleRename() {
    if (!nameValue.trim() || nameValue === whitelist.name) { setEditingName(false); return; }
    setSavingName(true);
    try {
      await api.put(`/api/admin/whitelists/${whitelist.id}`, { name: nameValue.trim() });
      toast.success("Renamed");
      setEditingName(false);
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      toast.error("Failed to rename");
    } finally {
      setSavingName(false);
    }
  }

  return (
    <Card className={`border-l-4 ${whitelist.enabled ? "border-l-emerald-500" : "border-l-red-500 opacity-60"}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {editingName ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-7 text-sm flex-1 min-w-0"
                autoFocus
                disabled={savingName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setNameValue(whitelist.name); setEditingName(false); }
                }}
              />
              <Button size="xs" className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleRename} disabled={savingName}>
                <Check className="h-3 w-3" />
                Save
              </Button>
              <Button size="xs" variant="outline" className="shrink-0" onClick={() => { setNameValue(whitelist.name); setEditingName(false); }}>
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </div>
          ) : (
            <span className="cursor-pointer hover:underline truncate" onClick={() => setEditingName(true)} title="Click to rename">
              {whitelist.name}
            </span>
          )}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {whitelist.is_default && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Default</Badge>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/60 select-all" title="Whitelist ID">
              #{whitelist.id}
            </span>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Squad Group</span>
          <span className="font-medium">{whitelist.squad_group || "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Output File</span>
          <span className="font-medium font-mono text-xs">{whitelist.output_filename || "—"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs font-mono text-muted-foreground">
            {url || <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">URL pending deploy</Badge>}
          </span>
          {url && (
            <Button variant="ghost" size="icon-xs" onClick={copyUrl} title="Copy URL">
              <Copy className="h-3 w-3" />
            </Button>
          )}
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Switch checked={whitelist.enabled} onCheckedChange={onToggle} />
          <span className="text-xs text-muted-foreground">{whitelist.enabled ? "On" : "Off"}</span>
        </div>
        <div className="ml-auto flex gap-2">
          <WhitelistConfigSheet whitelist={whitelist} groups={groups} />
          {!whitelist.is_default && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button size="sm" variant="destructive">
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {whitelist.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently remove this whitelist and all associated data. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={onDelete}>Continue</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

// ─── WhitelistConfigSheet (role-based) ───────────────────────────────────────

function WhitelistConfigSheet({
  whitelist,
  groups,
}: {
  whitelist: Whitelist;
  groups: SquadGroup[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(whitelist.name);
  const [squadGroup, setSquadGroup] = useState(whitelist.squad_group);
  const [showNewUrl, setShowNewUrl] = useState(false);
  const [copied, setCopied] = useState(false);

  const autoFilename = `${slugify(name)}.txt`;
  const [filenameOverride, setFilenameOverride] = useState<string | null>(null);
  const outputFilename = filenameOverride ?? autoFilename;
  const isAutoFilename = filenameOverride === null;

  const displayUrl = whitelist.url ?? "";

  const groupOptions: ComboboxOption[] = useMemo(
    () => groups.map((g) => ({ value: g.group_name, label: g.group_name })),
    [groups]
  );

  async function handleSave() {
    try {
      await api.put(`/api/admin/whitelists/${whitelist.id}`, {
        name,
        squad_group: squadGroup,
        ...(filenameOverride !== null ? { output_filename: filenameOverride } : {}),
      });
      toast.success("Whitelist updated");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      toast.error("Failed to update whitelist");
    }
  }

  async function handleRegenerate() {
    try {
      await api.post("/api/admin/whitelist-url/regenerate", {});
      await qc.refetchQueries({ queryKey: ["settings"] });
      setShowNewUrl(true);
      setCopied(false);
    } catch {
      toast.error("Failed to regenerate URL");
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Sheet>
      <SheetTrigger render={<Button size="sm" variant="outline" />}>
        Configure
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Configure {whitelist.name}</SheetTitle>
          <SheetDescription>Edit whitelist settings and output configuration.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Squad Group</Label>
            <Combobox
              options={groupOptions}
              value={squadGroup}
              onValueChange={setSquadGroup}
              placeholder="Select group"
              searchPlaceholder="Search groups..."
              emptyText="No groups found."
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Output Filename</Label>
              {!isAutoFilename && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-foreground underline"
                  onClick={() => setFilenameOverride(null)}
                >
                  Reset to auto
                </button>
              )}
            </div>
            <Input
              value={outputFilename}
              onChange={(e) => setFilenameOverride(e.target.value)}
              placeholder="e.g. whitelist.txt"
              className={isAutoFilename ? "text-muted-foreground" : ""}
            />
            {isAutoFilename && (
              <p className="text-[10px] text-muted-foreground">Auto-derived from name. Edit above to override.</p>
            )}
          </div>
          <Button onClick={handleSave} className="w-full">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>

          <div className="border-t border-white/[0.10] pt-4 space-y-3">
            <Label>Whitelist URL</Label>
            {showNewUrl ? (
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-emerald-400">
                  New URL generated — copy it and update your Squad server config.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                  <span className="flex-1 truncate font-mono text-[10px] text-emerald-300">{displayUrl}</span>
                  <Button size="icon-xs" variant="ghost" onClick={copyUrl}>
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => setShowNewUrl(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <>
                <p className="text-[11px] text-muted-foreground">
                  The current URL will stop working immediately. Update your Squad
                  server&apos;s RemoteAdminListHosts.cfg with the new URL.
                </p>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button variant="outline" size="sm" className="w-full">
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Regenerate URL
                      </Button>
                    }
                  />
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Regenerate whitelist URL?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The current URL will stop working immediately. You must update your
                        Squad server&apos;s RemoteAdminListHosts.cfg with the new URL or your
                        whitelist will stop loading on the server.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRegenerate}>Regenerate</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
