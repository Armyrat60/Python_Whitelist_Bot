"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  Send,
  X,
  Pencil,
  Check,
  ShieldCheck,
  PanelTop,
} from "lucide-react";
import {
  usePanels,
  useWhitelists,
  useChannels,
  useCreatePanel,
  useUpdatePanel,
  useDeletePanel,
  usePushPanel,
  usePanelRoles,
  useAddPanelRole,
  useRemovePanelRole,
  useUpdatePanelRole,
  useRoles,
} from "@/hooks/use-settings";
import type { Panel, Whitelist, PanelRole, DiscordRole } from "@/lib/types";

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
import { Combobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";

export default function PanelsPage() {
  const { data: panels, isLoading: panelsLoading, isError: panelsError } = usePanels();
  const { data: whitelists } = useWhitelists();
  const { data: channels } = useChannels();
  const createPanel = useCreatePanel();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  function handleCreate() {
    if (!newName.trim()) return;
    createPanel.mutate(
      { name: newName.trim() },
      {
        onSuccess: () => {
          toast.success("Panel created");
          setNewName("");
          setCreateOpen(false);
        },
        onError: () => toast.error("Failed to create panel"),
      }
    );
  }

  if (panelsLoading) {
    return (
      <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (panelsError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12 text-center">
        <p className="text-sm font-medium text-red-400">Failed to load data</p>
        <p className="mt-1 text-xs text-muted-foreground">Check your connection and refresh the page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(!panels || panels.length === 0) && !panelsLoading ? (
          <div className="col-span-full flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
            <PanelTop className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium">No panels yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Create a panel to let members apply for the whitelist.</p>
          </div>
        ) : panels?.map((panel) => (
          <PanelCard
            key={panel.id}
            panel={panel}
            whitelists={whitelists ?? []}
            channels={channels ?? []}
          />
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger
          render={
            <Button variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create Panel
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Panel</DialogTitle>
            <DialogDescription>
              Give your new panel a name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Whitelist Panel"
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={createPanel.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Status dot helper ──────────────────────────────────────────────────────
function getStatusColor(panel: Panel): string {
  if (panel.last_push_status === "error") return "bg-red-500";
  const hasChannel = !!panel.channel_id;
  const hasWhitelist = !!panel.whitelist_id;
  if (hasChannel && hasWhitelist) return panel.last_push_status === "ok" ? "bg-emerald-500" : "bg-yellow-500";
  if (hasChannel || hasWhitelist) return "bg-yellow-500";
  return "bg-red-500/60";
}

// ── Inline-editable panel role row ───────────────────────────────────────────

function PanelRoleRow({
  role,
  panelId,
  onRemove,
}: {
  role: PanelRole;
  panelId: number;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [slots, setSlots] = useState(String(role.slot_limit));
  const [stackable, setStackable] = useState(role.is_stackable);
  const updateRole = useUpdatePanelRole(panelId);

  function handleSave() {
    const limit = parseInt(slots, 10);
    if (isNaN(limit) || limit < 1) { toast.error("Slots must be at least 1"); return; }
    updateRole.mutate(
      { roleId: role.role_id, slot_limit: limit, is_stackable: stackable },
      {
        onSuccess: () => { toast.success("Role updated"); setEditing(false); },
        onError: () => toast.error("Failed to update role"),
      }
    );
  }

  function handleCancel() {
    setSlots(String(role.slot_limit));
    setStackable(role.is_stackable);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-white/[0.12] bg-white/[0.02] px-2.5 py-2 space-y-2">
        <span className="text-sm font-medium text-foreground">{role.display_name || role.role_name}</span>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs text-muted-foreground">Slots</Label>
            <Input
              type="number"
              min={1}
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              className="h-7 w-16 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Switch checked={stackable} onCheckedChange={setStackable} id={`stack-${role.role_id}`} />
            <Label htmlFor={`stack-${role.role_id}`} className="text-xs text-muted-foreground">Stack</Label>
          </div>
          <div className="ml-auto flex gap-1.5">
            <Button size="xs" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleSave} disabled={updateRole.isPending}>
              <Check className="h-3 w-3" />
              Save
            </Button>
            <Button size="xs" variant="outline" onClick={handleCancel}>
              <X className="h-3 w-3" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-2.5 py-1.5 text-sm">
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
        variant="outline"
        className="shrink-0 text-muted-foreground hover:text-foreground hover:border-foreground/30"
        onClick={() => setEditing(true)}
        title="Edit role"
      >
        <Pencil className="h-3 w-3" />
      </Button>
      <Button
        size="icon-xs"
        variant="outline"
        className="shrink-0 text-muted-foreground hover:text-destructive hover:border-destructive/30"
        onClick={onRemove}
        title="Remove role"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ── Panel card ────────────────────────────────────────────────────────────────

function PanelCard({
  panel,
  whitelists,
  channels,
}: {
  panel: Panel;
  whitelists: Whitelist[];
  channels: { id: string; name: string }[];
}) {
  const updatePanel = useUpdatePanel();
  const deletePanel = useDeletePanel();
  const pushPanel = usePushPanel();

  const [configMode, setConfigMode] = useState(false);
  const [channelId, setChannelId] = useState(panel.channel_id ?? "");
  const [logChannelId, setLogChannelId] = useState(panel.log_channel_id ?? "");
  const [whitelistId, setWhitelistId] = useState(
    panel.whitelist_id?.toString() ?? ""
  );
  const [panelName, setPanelName] = useState(panel.name);
  const [enabled, setEnabled] = useState(panel.enabled ?? true);
  const [showRoleMentions, setShowRoleMentions] = useState(panel.show_role_mentions ?? true);

  // Access roles state
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");
  const [slotLimit, setSlotLimit] = useState("1");
  const [isStackable, setIsStackable] = useState(false);

  const { data: panelRoles, isLoading: rolesLoading } = usePanelRoles(panel.id);
  const { data: discordRoles } = useRoles();
  const addRole = useAddPanelRole(panel.id);
  const removeRole = useRemovePanelRole(panel.id);

  const availableRoles: ComboboxOption[] = useMemo(() => {
    const assignedIds = new Set((panelRoles ?? []).map((r) => r.role_id));
    return (discordRoles ?? [])
      .filter((r) => !assignedIds.has(r.id))
      .map((r) => ({ value: r.id, label: r.name }));
  }, [discordRoles, panelRoles]);

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

  const channelName =
    channels.find((c) => c.id === panel.channel_id)?.name ?? "None";
  const logChannelName =
    channels.find((c) => c.id === panel.log_channel_id)?.name ?? "None";
  const wlName =
    whitelists.find((w) => w.id === panel.whitelist_id)?.name ?? "None";

  const channelOptions: ComboboxOption[] = useMemo(
    () => channels.map((ch) => ({ value: ch.id, label: `#${ch.name}` })),
    [channels]
  );

  const whitelistOptions: ComboboxOption[] = useMemo(
    () => whitelists.map((wl) => ({ value: String(wl.id), label: wl.name })),
    [whitelists]
  );

  function handleSave() {
    updatePanel.mutate(
      {
        id: panel.id,
        name: panelName.trim() || panel.name,
        channel_id: channelId || null,
        log_channel_id: logChannelId || null,
        whitelist_id: whitelistId ? Number(whitelistId) : null,
        show_role_mentions: showRoleMentions,
      },
      {
        onSuccess: () => {
          toast.success("Panel saved");
          setConfigMode(false);
        },
        onError: () => toast.error("Failed to save panel"),
      }
    );
  }

  function handleCancel() {
    setChannelId(panel.channel_id ?? "");
    setLogChannelId(panel.log_channel_id ?? "");
    setWhitelistId(panel.whitelist_id?.toString() ?? "");
    setPanelName(panel.name);
    setShowRoleMentions(panel.show_role_mentions ?? true);
    setConfigMode(false);
  }

  function handlePush() {
    pushPanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel refresh queued — Discord will update within 15 seconds"),
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message || "Failed to queue panel push.";
        toast.error(msg);
      },
    });
  }

  function handleDelete() {
    deletePanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel deleted"),
      onError: () => toast.error("Failed to delete panel"),
    });
  }

  return (
    <Card className={`border-l-4 ${enabled ? "border-l-emerald-500" : "border-l-red-500 opacity-60"}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${getStatusColor(panel)}`} />
          {/* Inline name edit */}
          {configMode ? (
            <span className="truncate">{panelName || panel.name}</span>
          ) : (
            <span
              className="cursor-pointer truncate hover:underline"
              title="Click to rename"
              onClick={() => setConfigMode(true)}
            >
              {panel.name}
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground/40 select-all shrink-0" title="Panel ID">
            #{panel.id}
          </span>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              updatePanel.mutate(
                { id: panel.id, enabled: checked },
                {
                  onSuccess: () => toast.success(checked ? "Panel enabled" : "Panel disabled"),
                  onError: () => { setEnabled(!checked); toast.error("Failed to toggle panel"); },
                }
              );
            }}
            className="ml-auto scale-75 shrink-0"
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Push status banner */}
        {panel.last_push_status === "error" && panel.last_push_error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
            <div className="min-w-0">
              <p className="text-xs font-medium text-red-400">Push failed</p>
              <p className="text-[11px] text-red-300/70">{panel.last_push_error}</p>
            </div>
          </div>
        )}
        {panel.last_push_status === "ok" && panel.last_push_at && (
          <p className="text-[11px] text-emerald-400/60">
            Last pushed {new Date(panel.last_push_at).toLocaleString()}
          </p>
        )}

        {/* Always show badges summary */}
        <div className="flex flex-wrap gap-1.5">
          {panel.channel_id && (
            <Badge variant="outline">#{channelName}</Badge>
          )}
          {panel.log_channel_id && (
            <Badge variant="outline">Log: #{logChannelName}</Badge>
          )}
          {panel.whitelist_id && (
            <Link href="/dashboard/whitelists">
              <Badge variant="outline" className="cursor-pointer hover:border-white/30 transition-colors">
                {wlName}
              </Badge>
            </Link>
          )}
          {panelRoles !== undefined && panelRoles.map((r) => (
            <Badge key={r.role_id} variant="outline" className="gap-1">
              <ShieldCheck className="h-2.5 w-2.5 opacity-60" />
              {r.role_name}
              <span className="text-muted-foreground">{r.slot_limit}s</span>
            </Badge>
          ))}
          {(!panel.channel_id || !panel.whitelist_id) && (
            <span className="text-xs text-amber-400/80">
              {!panel.channel_id && !panel.whitelist_id
                ? "No channel or whitelist — configure before pushing"
                : !panel.channel_id
                ? "No channel set — configure before pushing"
                : "No whitelist linked — configure before pushing"}
            </span>
          )}
        </div>

        {/* Configure mode: show dropdowns + name field */}
        {configMode && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input
                value={panelName}
                onChange={(e) => setPanelName(e.target.value)}
                placeholder="Panel name"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Channel</Label>
              <Combobox
                options={channelOptions}
                value={channelId}
                onValueChange={setChannelId}
                placeholder="Select channel"
                searchPlaceholder="Search channels..."
                emptyText="No channels found."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Log Channel</Label>
              <Combobox
                options={channelOptions}
                value={logChannelId}
                onValueChange={setLogChannelId}
                placeholder="Select log channel"
                searchPlaceholder="Search channels..."
                emptyText="No channels found."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Whitelist</Label>
              <Combobox
                options={whitelistOptions}
                value={whitelistId}
                onValueChange={setWhitelistId}
                placeholder="Select whitelist"
                searchPlaceholder="Search whitelists..."
                emptyText="No whitelists found."
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/[0.06] px-3 py-2">
              <div>
                <Label className="text-xs">Show Role Mentions</Label>
                <p className="text-[10px] text-muted-foreground">Display roles as @mention pills in the panel embed</p>
              </div>
              <Switch
                checked={showRoleMentions}
                onCheckedChange={setShowRoleMentions}
              />
            </div>

            {/* Access Roles */}
            <div className="border-t border-white/[0.06] pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">
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
                          id={`stackable-new-${panel.id}`}
                        />
                        <Label htmlFor={`stackable-new-${panel.id}`} className="text-xs text-muted-foreground">
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
              ) : panelRoles && panelRoles.length > 0 ? (
                <div className="space-y-1.5">
                  {panelRoles.map((role) => (
                    <PanelRoleRow
                      key={role.role_id}
                      role={role}
                      panelId={panel.id}
                      onRemove={() =>
                        removeRole.mutate(role.role_id, {
                          onError: () => toast.error("Failed to remove role"),
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No access roles configured. Add roles to control who gets whitelisted.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {configMode ? (
          <>
            <Button
              size="sm"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={handleSave}
              disabled={updatePanel.isPending}
            >
              <Save className="mr-1 h-3 w-3" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
            >
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              onClick={handlePush}
              disabled={pushPanel.isPending || !panel.channel_id || !panel.whitelist_id}
              title={
                !panel.channel_id && !panel.whitelist_id
                  ? "Configure a channel and whitelist before pushing"
                  : !panel.channel_id
                  ? "Configure a channel before pushing"
                  : !panel.whitelist_id
                  ? "Link a whitelist before pushing"
                  : undefined
              }
            >
              <Send className="mr-1 h-3 w-3" />
              Push
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => setConfigMode(true)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              Configure
            </Button>
          </>
        )}
        <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deletePanel.isPending}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {panel.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove this panel and all associated data. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
      </CardFooter>
    </Card>
  );
}
