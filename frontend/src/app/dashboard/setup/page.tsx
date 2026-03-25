"use client";

import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  Send,
  Settings2,
  Copy,
  Power,
} from "lucide-react";
import {
  usePanels,
  useWhitelists,
  useRoles,
  useChannels,
  useGroups,
  useCreatePanel,
  useUpdatePanel,
  useDeletePanel,
  usePushPanel,
  useCreateWhitelist,
  useDeleteWhitelist,
  useToggleWhitelist,
  useAddRoleMapping,
  useRemoveRoleMapping,
} from "@/hooks/use-settings";
import { api } from "@/lib/api";
import type { Panel, Whitelist, SquadGroup, DiscordRole } from "@/lib/types";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

// ─── All known Squad permissions ────────────────────────────────────────
const SQUAD_PERMISSIONS = [
  "reserve",
  "startvote",
  "changemap",
  "pause",
  "cheat",
  "private",
  "balance",
  "chat",
  "kick",
  "ban",
  "config",
  "cameraman",
  "immune",
  "manageserver",
  "featuretest",
  "demos",
  "clientdemos",
  "debug",
  "teamchange",
  "forceteamchange",
  "canseeadminchat",
];

export default function SetupPage() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="panels">
        <TabsList>
          <TabsTrigger value="panels">Panels</TabsTrigger>
          <TabsTrigger value="whitelists">Whitelists</TabsTrigger>
          <TabsTrigger value="groups">Groups</TabsTrigger>
        </TabsList>

        <TabsContent value="panels">
          <PanelsTab />
        </TabsContent>
        <TabsContent value="whitelists">
          <WhitelistsTab />
        </TabsContent>
        <TabsContent value="groups">
          <GroupsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PANELS TAB
// ═══════════════════════════════════════════════════════════════════════════

function PanelsTab() {
  const { data: panels, isLoading: panelsLoading } = usePanels();
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

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {panels?.map((panel) => (
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

  const [channelId, setChannelId] = useState(panel.channel_id ?? "");
  const [logChannelId, setLogChannelId] = useState(panel.log_channel_id ?? "");
  const [whitelistId, setWhitelistId] = useState(
    panel.whitelist_id?.toString() ?? ""
  );

  const channelName =
    channels.find((c) => c.id === panel.channel_id)?.name ?? "None";
  const wlName =
    whitelists.find((w) => w.id === panel.whitelist_id)?.name ?? "None";

  function handleSave() {
    updatePanel.mutate(
      {
        id: panel.id,
        channel_id: channelId || null,
        log_channel_id: logChannelId || null,
        whitelist_id: whitelistId ? Number(whitelistId) : null,
      },
      {
        onSuccess: () => toast.success("Panel saved"),
        onError: () => toast.error("Failed to save panel"),
      }
    );
  }

  function handlePush() {
    pushPanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel pushed to Discord"),
      onError: () => toast.error("Failed to push panel"),
    });
  }

  function handleDelete() {
    deletePanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel deleted"),
      onError: () => toast.error("Failed to delete panel"),
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {panel.name}
          {panel.is_default && (
            <Badge variant="secondary" className="text-[10px]">
              Default
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {panel.channel_id && (
            <Badge variant="outline">#{channelName}</Badge>
          )}
          {panel.whitelist_id && (
            <Badge variant="outline">{wlName}</Badge>
          )}
          {!panel.channel_id && !panel.whitelist_id && (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Channel</Label>
          <Select value={channelId} onValueChange={(v) => setChannelId(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  #{ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Log Channel</Label>
          <Select value={logChannelId} onValueChange={(v) => setLogChannelId(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select log channel" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  #{ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs">Whitelist</Label>
          <Select value={whitelistId} onValueChange={(v) => setWhitelistId(v ?? "")}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select whitelist" />
            </SelectTrigger>
            <SelectContent>
              {whitelists.map((wl) => (
                <SelectItem key={wl.id} value={String(wl.id)}>
                  {wl.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          size="sm"
          className="bg-emerald-600 text-white hover:bg-emerald-700"
          onClick={handlePush}
          disabled={pushPanel.isPending}
        >
          <Send className="mr-1 h-3 w-3" />
          Push
        </Button>
        <Button
          size="sm"
          className="bg-blue-600 text-white hover:bg-blue-700"
          onClick={handleSave}
          disabled={updatePanel.isPending}
        >
          <Save className="mr-1 h-3 w-3" />
          Save
        </Button>
        <ManageRolesButton panelWhitelistSlug={
          whitelists.find((w) => w.id === panel.whitelist_id)?.slug
        } />
        {!panel.is_default && (
          <Button
            size="sm"
            variant="destructive"
            onClick={handleDelete}
            disabled={deletePanel.isPending}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function ManageRolesButton({
  panelWhitelistSlug,
}: {
  panelWhitelistSlug?: string;
}) {
  const { data: roles } = useRoles();
  const addRole = useAddRoleMapping();
  const removeRole = useRemoveRoleMapping();
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [slotCount, setSlotCount] = useState("1");
  const [roleSearchOpen, setRoleSearchOpen] = useState(false);

  // We get role mappings from the settings query which includes whitelists with their mappings
  // For now, this is a simplified version

  const slug = panelWhitelistSlug;

  function handleAddRole() {
    if (!slug || !selectedRoleId) return;
    addRole.mutate(
      { slug, role_id: selectedRoleId, slot_limit: Number(slotCount) || 1 },
      {
        onSuccess: () => {
          toast.success("Role mapping added");
          setSelectedRoleId("");
          setSlotCount("1");
        },
        onError: () => toast.error("Failed to add role mapping"),
      }
    );
  }

  function handleRemoveRole(roleId: string) {
    if (!slug) return;
    removeRole.mutate(
      { slug, roleId },
      {
        onSuccess: () => toast.success("Role mapping removed"),
        onError: () => toast.error("Failed to remove role mapping"),
      }
    );
  }

  const selectedRoleName =
    roles?.find((r) => r.id === selectedRoleId)?.name ?? "Select role";

  return (
    <Dialog>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Settings2 className="mr-1 h-3 w-3" />
        Roles
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage Role Mappings</DialogTitle>
          <DialogDescription>
            {slug
              ? `Configure roles for whitelist "${slug}"`
              : "No whitelist assigned to this panel"}
          </DialogDescription>
        </DialogHeader>

        {slug && (
          <div className="space-y-4">
            {/* Add new role mapping */}
            <div className="space-y-2">
              <Label>Add Role Mapping</Label>
              <div className="flex gap-2">
                <Popover open={roleSearchOpen} onOpenChange={setRoleSearchOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-start"
                      />
                    }
                  >
                    {selectedRoleName}
                  </PopoverTrigger>
                  <PopoverContent className="w-56 p-0">
                    <Command>
                      <CommandInput placeholder="Search role..." />
                      <CommandList>
                        <CommandEmpty>No roles found.</CommandEmpty>
                        <CommandGroup>
                          {roles?.map((role) => (
                            <CommandItem
                              key={role.id}
                              onSelect={() => {
                                setSelectedRoleId(role.id);
                                setRoleSearchOpen(false);
                              }}
                            >
                              <span
                                className="mr-2 inline-block h-3 w-3 rounded-full"
                                style={{ backgroundColor: role.color || "#99AAB5" }}
                              />
                              {role.name}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                <Input
                  type="number"
                  min={1}
                  value={slotCount}
                  onChange={(e) => setSlotCount(e.target.value)}
                  placeholder="Slots"
                  className="w-20"
                />
                <Button
                  size="sm"
                  onClick={handleAddRole}
                  disabled={!selectedRoleId || addRole.isPending}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// WHITELISTS TAB
// ═══════════════════════════════════════════════════════════════════════════

function WhitelistsTab() {
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
    <div className="space-y-4 pt-4">
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
              Give your new whitelist a name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. VIP Whitelist"
            />
          </div>
          <DialogFooter>
            <Button
              onClick={handleCreate}
              disabled={createWhitelist.isPending}
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

  function copyUrl() {
    navigator.clipboard.writeText(url);
    toast.success("URL copied to clipboard");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {whitelist.name}
          {whitelist.is_default && (
            <Badge variant="secondary" className="text-[10px]">
              Default
            </Badge>
          )}
          <Badge
            variant={whitelist.enabled ? "default" : "destructive"}
            className="text-[10px]"
          >
            {whitelist.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Squad Group</span>
          <span className="font-medium">{whitelist.squad_group || "—"}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Output File</span>
          <span className="font-medium font-mono text-xs">
            {whitelist.output_filename || "—"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate text-xs text-muted-foreground font-mono">
            {url}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={copyUrl}>
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
          <WhitelistConfigSheet whitelist={whitelist} groups={groups} />
          {!whitelist.is_default && (
            <Button size="sm" variant="destructive" onClick={onDelete}>
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
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
  const [name, setName] = useState(whitelist.name);
  const [squadGroup, setSquadGroup] = useState(whitelist.squad_group);
  const [outputFilename, setOutputFilename] = useState(
    whitelist.output_filename
  );

  async function handleSave() {
    try {
      await api.put(`/api/admin/whitelists/${whitelist.slug}`, {
        name,
        squad_group: squadGroup,
        output_filename: outputFilename,
      });
      toast.success("Whitelist updated");
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
            <Select value={squadGroup} onValueChange={(v) => setSquadGroup(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.group_name} value={g.group_name}>
                    {g.group_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

// ═══════════════════════════════════════════════════════════════════════════
// GROUPS TAB
// ═══════════════════════════════════════════════════════════════════════════

function GroupsTab() {
  const { data: groups, isLoading } = useGroups();
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editGroup, setEditGroup] = useState<SquadGroup | null>(null);

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    try {
      await api.post("/api/admin/groups", {
        group_name: newGroupName.trim(),
        permissions: "",
      });
      toast.success("Group created");
      setNewGroupName("");
      setCreateOpen(false);
    } catch {
      toast.error("Failed to create group");
    }
  }

  if (isLoading) {
    return (
      <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups?.map((group) => {
          const perms = group.permissions
            ? group.permissions.split(",").filter(Boolean)
            : [];
          return (
            <Card
              key={group.group_name}
              className="cursor-pointer transition-colors hover:bg-zinc-800/50"
              onClick={() => setEditGroup(group)}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {group.group_name}
                  {group.is_default && (
                    <Badge variant="secondary" className="text-[10px]">
                      Default
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {perms.length > 0 ? (
                    perms.map((p) => (
                      <Badge key={p} variant="outline" className="text-[10px]">
                        {p}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No permissions
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Edit Group Dialog */}
      {editGroup && (
        <EditGroupDialog
          group={editGroup}
          onClose={() => setEditGroup(null)}
        />
      )}

      {/* Create Group Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger
          render={
            <Button variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create Group
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Group</DialogTitle>
            <DialogDescription>
              Create a new Squad admin group.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Group Name</Label>
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Moderator"
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCreateGroup}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditGroupDialog({
  group,
  onClose,
}: {
  group: SquadGroup;
  onClose: () => void;
}) {
  const currentPerms = group.permissions
    ? group.permissions.split(",").filter(Boolean)
    : [];
  const [selected, setSelected] = useState<string[]>(currentPerms);

  function togglePerm(perm: string) {
    setSelected((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  async function handleSave() {
    try {
      await api.put(`/api/admin/groups/${group.group_name}`, {
        permissions: selected.join(","),
      });
      toast.success("Group updated");
      onClose();
    } catch {
      toast.error("Failed to update group");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Group: {group.group_name}</DialogTitle>
          <DialogDescription>
            Select permissions for this admin group.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SQUAD_PERMISSIONS.map((perm) => (
            <label
              key={perm}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-1.5 text-xs transition-colors hover:bg-zinc-800/50"
            >
              <Checkbox
                checked={selected.includes(perm)}
                onCheckedChange={() => togglePerm(perm)}
              />
              <span>{perm}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
