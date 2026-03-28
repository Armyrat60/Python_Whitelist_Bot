"use client";

import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  Copy,
  Check,
  X,
  RefreshCw,
} from "lucide-react";
import {
  useWhitelists,
  useGroups,
  useToggleWhitelist,
  useCreateWhitelist,
  useDeleteWhitelist,
} from "@/hooks/use-settings";
import { useGuild } from "@/hooks/use-guild";
import { api } from "@/lib/api";
import type { Whitelist, SquadGroup } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

export default function WhitelistsPage() {
  const { data: whitelists, isLoading } = useWhitelists();
  const { data: groups } = useGroups();
  const toggleWhitelist = useToggleWhitelist();
  const createWhitelist = useCreateWhitelist();
  const deleteWhitelist = useDeleteWhitelist();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function handleSyncFilenames() {
    setSyncing(true);
    try {
      const res = await api.post<{ ok: boolean; updated: number }>("/api/admin/whitelists/sync-filenames", {});
      toast.success(res.updated > 0 ? `Fixed ${res.updated} filename${res.updated !== 1 ? "s" : ""}` : "All filenames are already correct");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["whitelist-urls"] });
    } catch {
      toast.error("Failed to sync filenames");
    } finally {
      setSyncing(false);
    }
  }

  function handleCreate() {
    if (!newName.trim()) return;
    const slug = slugify(newName.trim());
    createWhitelist.mutate(
      { name: newName.trim(), output_filename: `${slug}.txt` },
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

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(!whitelists || whitelists.length === 0) && !isLoading ? (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
            <p className="text-sm font-medium">No whitelists yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create your first whitelist to get started.</p>
          </div>
        ) : whitelists?.map((wl) => (
          <WhitelistCard
            key={wl.id}
            whitelist={wl}
            groups={groups ?? []}
            onToggle={() =>
              toggleWhitelist.mutate(wl.slug, {
                onSuccess: () =>
                  toast.success(
                    `Whitelist ${wl.enabled ? "disabled" : "enabled"}`
                  ),
                onError: () => toast.error("Failed to toggle whitelist"),
              })
            }
            onDelete={() =>
              deleteWhitelist.mutate(wl.slug, {
                onSuccess: () => toast.success("Whitelist deleted"),
                onError: () => toast.error("Failed to delete whitelist"),
              })
            }
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger
            render={
              <Button variant="outline">
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
                { name: "Clan", file: "clan.txt" },
                { name: "Staff", file: "staff.txt" },
                { name: "VIP", file: "vip.txt" },
              ].map((tpl) => (
                <Button
                  key={tpl.name}
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => {
                    setNewName(tpl.name);
                  }}
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
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={createWhitelist.isPending || !newName.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
        </Dialog>
        <Button variant="ghost" size="sm" onClick={handleSyncFilenames} disabled={syncing}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          Fix All Filenames
        </Button>
      </div>
    </div>
  );
}

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
  const { activeGuild } = useGuild();
  const { data: urlsData } = useQuery<{ urls: { slug: string; url: string }[] }>({
    queryKey: ["whitelist-urls", activeGuild?.id ?? null],
    queryFn: () => api.get("/api/admin/whitelist-urls"),
    enabled: !!activeGuild?.id,
  });
  const url = urlsData?.urls?.find((u) => u.slug === whitelist.slug)?.url ?? "Loading...";

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
      qc.invalidateQueries({ queryKey: ["whitelist-urls"] });
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
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={handleRename} disabled={savingName}>
                <Check className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => { setNameValue(whitelist.name); setEditingName(false); }}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <span className="cursor-pointer hover:underline truncate" onClick={() => setEditingName(true)} title="Click to rename">
              {whitelist.name}
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground/40 select-all shrink-0 ml-auto" title="Whitelist ID">
            #{whitelist.id}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Squad Group</span>
          <span className="font-medium">{whitelist.squad_group || "\u2014"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Output File</span>
          <span className="font-medium font-mono text-xs">
            {whitelist.output_filename || "\u2014"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs text-muted-foreground font-mono">
            {url}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={copyUrl} title="Copy URL">
            <Copy className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Switch
            checked={whitelist.enabled}
            onCheckedChange={onToggle}
          />
          <span className="text-xs text-muted-foreground">
            {whitelist.enabled ? "On" : "Off"}
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <WhitelistConfigSheet whitelist={whitelist} groups={groups} currentUrl={url} />
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
                  <AlertDialogAction variant="destructive" onClick={onDelete}>
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
        </div>
      </CardFooter>
    </Card>
  );
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

function WhitelistConfigSheet({
  whitelist,
  groups,
  currentUrl,
}: {
  whitelist: Whitelist;
  groups: SquadGroup[];
  currentUrl: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(whitelist.name);
  const [squadGroup, setSquadGroup] = useState(whitelist.squad_group);
  const [regeneratedUrl, setRegeneratedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Track whether user has manually overridden the filename
  const autoFilename = `${slugify(name)}.txt`;
  const [filenameOverride, setFilenameOverride] = useState<string | null>(null);
  const outputFilename = filenameOverride ?? autoFilename;
  const isAutoFilename = filenameOverride === null;

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
      qc.invalidateQueries({ queryKey: ["whitelist-urls"] });
    } catch {
      toast.error("Failed to update whitelist");
    }
  }

  async function handleRegenerate() {
    try {
      await api.post("/api/admin/whitelist-url/regenerate", {});
      await qc.invalidateQueries({ queryKey: ["whitelist-urls"] });
      // Fetch the updated URL to show in the copy box
      const res = await api.get<{ urls: { slug: string; url: string }[] }>("/api/admin/whitelist-urls");
      const newUrl = res.urls.find((u) => u.slug === whitelist.slug)?.url ?? currentUrl;
      setRegeneratedUrl(newUrl);
      setCopied(false);
    } catch {
      toast.error("Failed to regenerate URL");
    }
  }

  function copyNewUrl() {
    if (!regeneratedUrl) return;
    navigator.clipboard.writeText(regeneratedUrl);
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
          <SheetDescription>
            Edit whitelist settings and output configuration.
          </SheetDescription>
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
              <p className="text-[10px] text-muted-foreground">
                Auto-derived from name. Edit above to override.
              </p>
            )}
          </div>
          <Button onClick={handleSave} className="w-full">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>

          <div className="border-t border-white/[0.06] pt-4 space-y-3">
            <Label>Whitelist URL</Label>

            {regeneratedUrl ? (
              // Show new URL with copy button after regeneration
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-emerald-400">
                  New URL generated — copy it and update your Squad server config.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                  <span className="flex-1 truncate font-mono text-[10px] text-emerald-300">
                    {regeneratedUrl}
                  </span>
                  <Button size="icon-xs" variant="ghost" onClick={copyNewUrl}>
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setRegeneratedUrl(null)}
                >
                  Done
                </Button>
              </div>
            ) : (
              // Show regenerate button before action
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
                      <AlertDialogAction onClick={handleRegenerate}>
                        Regenerate
                      </AlertDialogAction>
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
