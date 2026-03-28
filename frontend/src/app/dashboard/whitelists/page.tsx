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
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  function handleCreate() {
    if (!newName.trim()) return;
    createWhitelist.mutate(
      { name: newName.trim() },
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
        {whitelists?.map((wl) => (
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
  const { data: urlsData } = useQuery<{ urls: { slug: string; url: string }[] }>({
    queryKey: ["whitelist-urls"],
    queryFn: () => api.get("/api/admin/whitelist-urls"),
  });
  const url = urlsData?.urls?.find((u) => u.slug === whitelist.slug)?.url ?? "Loading...";

  const qc = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(whitelist.name);
  const [savingName, setSavingName] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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

  async function handleRegenerateUrl() {
    setRegenerating(true);
    try {
      await api.post("/api/admin/whitelist-url/regenerate", {});
      toast.success("URL regenerated — update your Squad server config with the new link");
      qc.invalidateQueries({ queryKey: ["whitelist-urls"] });
    } catch {
      toast.error("Failed to regenerate URL");
    } finally {
      setRegenerating(false);
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
          {whitelist.is_default && (
            <Badge variant="secondary" className="text-[10px] shrink-0">Default</Badge>
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
          <Button variant="ghost" size="icon-xs" onClick={handleRegenerateUrl} disabled={regenerating} title="Regenerate URL (old URL will stop working)">
            <RefreshCw className={`h-3 w-3 ${regenerating ? "animate-spin" : ""}`} />
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
                  <AlertDialogAction variant="destructive" onClick={onDelete}>
                    Continue
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

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
  const [outputFilename, setOutputFilename] = useState(
    whitelist.output_filename
  );

  const groupOptions: ComboboxOption[] = useMemo(
    () => groups.map((g) => ({ value: g.group_name, label: g.group_name })),
    [groups]
  );

  async function handleSave() {
    try {
      await api.put(`/api/admin/whitelists/${whitelist.id}`, {
        name,
        squad_group: squadGroup,
        output_filename: outputFilename,
      });
      toast.success("Whitelist updated");
      qc.invalidateQueries({ queryKey: ["settings"] });
      qc.invalidateQueries({ queryKey: ["whitelist-urls"] });
    } catch {
      toast.error("Failed to update whitelist");
    }
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
            <Label>Output Filename</Label>
            <Input
              value={outputFilename}
              onChange={(e) => setOutputFilename(e.target.value)}
              placeholder="e.g. whitelist.cfg"
            />
          </div>
          <Button onClick={handleSave} className="w-full">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
