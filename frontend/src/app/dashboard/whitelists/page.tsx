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
  ShieldCheck,
} from "lucide-react";
import {
  useWhitelists,
  useGroups,
  useToggleWhitelist,
  useCreateWhitelist,
  useDeleteWhitelist,
  useWhitelistRoles,
  useAddWhitelistRole,
  useRemoveWhitelistRole,
  useRoles,
} from "@/hooks/use-settings";
import { api } from "@/lib/api";
import type { Whitelist, SquadGroup, WhitelistRole, DiscordRole } from "@/lib/types";

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
  const url = whitelist.url ?? "";
  const { data: roles } = useWhitelistRoles(whitelist.id);

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
          <span className="text-muted-foreground">Access Roles</span>
          <span className="font-medium">
            {roles === undefined ? (
              <span className="text-muted-foreground/40 text-xs">…</span>
            ) : roles.length === 0 ? (
              <span className="text-amber-400 text-xs">None configured</span>
            ) : (
              <span className="text-xs">{roles.length} role{roles.length !== 1 ? "s" : ""}</span>
            )}
          </span>
        </div>
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
          <span className="flex-1 truncate text-xs font-mono text-muted-foreground">
            {url || <span className="italic text-muted-foreground/50">URL pending deploy…</span>}
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
}: {
  whitelist: Whitelist;
  groups: SquadGroup[];
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(whitelist.name);
  const [squadGroup, setSquadGroup] = useState(whitelist.squad_group);
  const [showNewUrl, setShowNewUrl] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [slotLimit, setSlotLimit] = useState("1");
  const [isStackable, setIsStackable] = useState(false);

  const { data: whitelistRoles, isLoading: rolesLoading } = useWhitelistRoles(whitelist.id);
  const { data: discordRoles } = useRoles();
  const addRole = useAddWhitelistRole(whitelist.id);
  const removeRole = useRemoveWhitelistRole(whitelist.id);

  const availableRoles: ComboboxOption[] = useMemo(() => {
    const assignedIds = new Set((whitelistRoles ?? []).map((r) => r.role_id));
    return (discordRoles ?? [])
      .filter((r) => !assignedIds.has(r.id))
      .map((r) => ({ value: r.id, label: r.name }));
  }, [discordRoles, whitelistRoles]);

  function handleAddRole() {
    if (!selectedRoleId) return;
    const role = discordRoles?.find((r) => r.id === selectedRoleId);
    if (!role) return;
    const slots = parseInt(slotLimit, 10);
    if (isNaN(slots) || slots < 1) return;
    addRole.mutate(
      { role_id: role.id, role_name: role.name, slot_limit: slots, is_stackable: isStackable },
      {
        onSuccess: () => {
          toast.success(`Added ${role.name}`);
          setSelectedRoleId("");
          setSlotLimit("1");
          setIsStackable(false);
          setAddRoleOpen(false);
        },
        onError: () => toast.error("Failed to add role"),
      }
    );
  }

  // Track whether user has manually overridden the filename
  const autoFilename = `${slugify(name)}.txt`;
  const [filenameOverride, setFilenameOverride] = useState<string | null>(null);
  const outputFilename = filenameOverride ?? autoFilename;
  const isAutoFilename = filenameOverride === null;

  // whitelist.url is always current (comes from settings query)
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
      // Refetch settings — whitelist.url (from parent) will auto-update with new salt
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

          {/* Access Roles */}
          <div className="border-t border-white/[0.06] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>
                <ShieldCheck className="inline mr-1.5 h-3.5 w-3.5 opacity-60" />
                Access Roles
              </Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddRoleOpen((v) => !v)}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add
              </Button>
            </div>

            {addRoleOpen && (
              <div className="rounded-lg border border-white/[0.08] p-3 space-y-3 bg-white/[0.02]">
                <div className="space-y-1.5">
                  <Label className="text-xs">Discord Role</Label>
                  <Combobox
                    options={availableRoles}
                    value={selectedRoleId}
                    onValueChange={setSelectedRoleId}
                    placeholder="Select role..."
                    searchPlaceholder="Search roles..."
                    emptyText="No roles available."
                  />
                </div>
                <div className="flex gap-2">
                  <div className="space-y-1.5 flex-1">
                    <Label className="text-xs">Slots</Label>
                    <Input
                      type="number"
                      min={1}
                      value={slotLimit}
                      onChange={(e) => setSlotLimit(e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 flex items-end gap-2 pb-0.5">
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={isStackable}
                        onCheckedChange={setIsStackable}
                        id={`stackable-new-${whitelist.id}`}
                      />
                      <Label htmlFor={`stackable-new-${whitelist.id}`} className="text-xs text-muted-foreground">
                        Stack
                      </Label>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleAddRole}
                    disabled={!selectedRoleId || addRole.isPending}
                  >
                    Add Role
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setAddRoleOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {rolesLoading ? (
              <div className="space-y-1.5">
                {[1, 2].map((i) => (
                  <div key={i} className="h-8 rounded animate-pulse bg-white/[0.04]" />
                ))}
              </div>
            ) : whitelistRoles && whitelistRoles.length > 0 ? (
              <div className="space-y-1.5">
                {whitelistRoles.map((role) => (
                  <div
                    key={role.role_id}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-2.5 py-1.5 text-sm"
                  >
                    <span className="flex-1 truncate font-medium text-foreground">
                      {role.display_name || role.role_name}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {role.slot_limit} slot{role.slot_limit !== 1 ? "s" : ""}
                    </span>
                    {role.is_stackable && (
                      <span className="shrink-0 text-[10px] text-blue-400 border border-blue-400/30 rounded px-1">
                        stack
                      </span>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        removeRole.mutate(role.role_id, {
                          onError: () => toast.error("Failed to remove role"),
                        })
                      }
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No access roles configured. Add roles to control who gets whitelisted.
              </p>
            )}
          </div>

          <div className="border-t border-white/[0.06] pt-4 space-y-3">
            <Label>Whitelist URL</Label>

            {showNewUrl ? (
              // After regeneration — show new URL (auto-updated from settings)
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-emerald-400">
                  New URL generated — copy it and update your Squad server config.
                </p>
                <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2">
                  <span className="flex-1 truncate font-mono text-[10px] text-emerald-300">
                    {displayUrl}
                  </span>
                  <Button size="icon-xs" variant="ghost" onClick={copyUrl}>
                    {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setShowNewUrl(false)}
                >
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
