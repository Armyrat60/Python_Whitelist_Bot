"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Layers } from "lucide-react";
import {
  useGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useToggleGroup,
  useSquadPermissions,
  useWhitelists,
  useUpdateWhitelist,
} from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import type { SquadGroup, Whitelist } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

// ── Permission toggle grid ────────────────────────────────────────────────────

function PermissionGrid({
  available,
  selected,
  onChange,
}: {
  available: Record<string, string>;
  selected: string[];
  onChange: (perms: string[]) => void;
}) {
  function toggle(key: string) {
    if (selected.includes(key)) {
      onChange(selected.filter((p) => p !== key));
    } else {
      onChange([...selected, key]);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(available).map(([key, label]) => (
        <label
          key={key}
          className="flex cursor-pointer items-center gap-2 rounded-md border border-white/[0.08] px-3 py-2 text-sm hover:border-white/20 hover:bg-white/[0.03] transition-colors"
        >
          <Checkbox
            checked={selected.includes(key)}
            onCheckedChange={() => toggle(key)}
          />
          <span className="flex-1 min-w-0">
            <span className="block font-medium text-white/80">{label}</span>
            <span className="block text-[11px] text-muted-foreground font-mono">
              {key}
            </span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ── Create group dialog ───────────────────────────────────────────────────────

function CreateGroupDialog({
  available,
  open,
  onOpenChange,
}: {
  available: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>(["reserve"]);
  const create = useCreateGroup();

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Group name is required");
      return;
    }
    if (selectedPerms.length === 0) {
      toast.error("Select at least one permission");
      return;
    }
    create.mutate(
      { group_name: trimmed, permissions: selectedPerms.join(",") },
      {
        onSuccess: () => {
          toast.success(`Group "${trimmed}" created`);
          setName("");
          setSelectedPerms(["reserve"]);
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { message?: string })?.message ?? "Failed to create group";
          toast.error(msg);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Squad Group</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Group Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. reserve, vip, staff"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              This becomes the Squad server group name (e.g.{" "}
              <code className="font-mono">
                {name || "reserve"}:reserve
              </code>
              )
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Permissions</Label>
            <PermissionGrid
              available={available}
              selected={selectedPerms}
              onChange={setSelectedPerms}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={create.isPending}
            className="text-black font-semibold"
            style={{ background: "var(--accent-primary)" }}
          >
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit group dialog ─────────────────────────────────────────────────────────

function EditGroupDialog({
  group,
  available,
  open,
  onOpenChange,
}: {
  group: SquadGroup;
  available: Record<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(group.group_name);
  const [selectedPerms, setSelectedPerms] = useState<string[]>(() =>
    group.permissions
      ? group.permissions
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : []
  );
  const update = useUpdateGroup();

  function handleSave() {
    if (!name.trim()) {
      toast.error("Group name is required");
      return;
    }
    if (selectedPerms.length === 0) {
      toast.error("Select at least one permission");
      return;
    }
    update.mutate(
      {
        group_name: group.group_name,
        new_name:
          name.trim() !== group.group_name ? name.trim() : undefined,
        permissions: selectedPerms.join(","),
      },
      {
        onSuccess: () => {
          toast.success("Group updated");
          onOpenChange(false);
        },
        onError: (err: unknown) => {
          const msg =
            (err as { message?: string })?.message ?? "Failed to update group";
          toast.error(msg);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Edit group &ldquo;{group.group_name}&rdquo;
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Group Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. reserve, vip, staff"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Permissions</Label>
            <PermissionGrid
              available={available}
              selected={selectedPerms}
              onChange={setSelectedPerms}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={update.isPending}
            className="text-black font-semibold"
            style={{ background: "var(--accent-primary)" }}
          >
            {update.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete group dialog with reassignment ─────────────────────────────────────

function DeleteGroupDialog({
  group,
  open,
  onOpenChange,
}: {
  group: SquadGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: allWhitelists } = useWhitelists();
  const { data: allGroups } = useGroups();
  const remove = useDeleteGroup();
  const updateWl = useUpdateWhitelist();

  // Whitelists currently using this group
  const blocked = (allWhitelists ?? []).filter(
    (wl: Whitelist) => wl.squad_group === group.group_name
  );

  // Per-whitelist replacement selection
  const [replacements, setReplacements] = useState<Record<number, string>>({});

  const otherGroups = (allGroups ?? []).filter(
    (g) => g.group_name !== group.group_name
  );

  const allAssigned =
    blocked.length === 0 || blocked.every((wl) => !!replacements[wl.id]);

  async function handleDelete() {
    try {
      // Reassign any blocking whitelists first
      for (const wl of blocked) {
        const newGroup = replacements[wl.id];
        if (newGroup) {
          await updateWl.mutateAsync({ id: wl.id, squad_group: newGroup });
        }
      }
      await remove.mutateAsync(group.group_name);
      toast.success(`Group "${group.group_name}" deleted`);
      onOpenChange(false);
    } catch (err: unknown) {
      toast.error(
        (err as { message?: string })?.message ?? "Failed to delete group"
      );
    }
  }

  const isPending = updateWl.isPending || remove.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setReplacements({});
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Delete group &ldquo;{group.group_name}&rdquo;?
          </DialogTitle>
        </DialogHeader>

        {blocked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This group is not in use. It will be permanently removed.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {blocked.length} whitelist
              {blocked.length !== 1 ? "s are" : " is"} using this group. Choose
              a replacement for each before deleting.
            </p>
            <div className="space-y-2">
              {blocked.map((wl: Whitelist) => (
                <div
                  key={wl.id}
                  className="flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-2"
                >
                  <span className="flex-1 truncate text-sm font-medium">
                    {wl.name}
                  </span>
                  <Select
                    value={replacements[wl.id] ?? ""}
                    onValueChange={(v) =>
                      setReplacements((prev) => ({
                        ...prev,
                        [wl.id]: v ?? "",
                      }))
                    }
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue placeholder="Pick group..." />
                    </SelectTrigger>
                    <SelectContent>
                      {otherGroups.length === 0 ? (
                        <SelectItem value="__none__" disabled>
                          No other groups
                        </SelectItem>
                      ) : (
                        otherGroups.map((g) => (
                          <SelectItem key={g.group_name} value={g.group_name}>
                            {g.group_name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={
              !allAssigned ||
              isPending ||
              (blocked.length > 0 && otherGroups.length === 0)
            }
          >
            {isPending
              ? "Working..."
              : blocked.length > 0
                ? "Reassign & Delete"
                : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Permission badges (truncated) ─────────────────────────────────────────────

function PermissionBadges({
  permissions,
  available,
}: {
  permissions: string;
  available: Record<string, string>;
}) {
  const perms = useMemo(
    () =>
      (permissions || "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean),
    [permissions]
  );

  if (perms.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">
        No permissions
      </span>
    );
  }

  const visible = perms.slice(0, perms.length > 4 ? 3 : 4);
  const remaining = perms.length - visible.length;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((p) => (
        <Badge key={p} variant="outline" className="font-mono text-[11px]">
          {available[p] ?? p}
        </Badge>
      ))}
      {remaining > 0 && (
        <Badge variant="secondary" className="text-[11px]">
          +{remaining}
        </Badge>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GroupsTab() {
  const { data: groups, isLoading, isError } = useGroups();
  const { data: availablePerms } = useSquadPermissions();
  const { data: allWhitelists } = useWhitelists();
  const toggleGroup = useToggleGroup();

  const [showCreate, setShowCreate] = useState(false);
  const [editingGroup, setEditingGroup] = useState<SquadGroup | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<SquadGroup | null>(null);

  const available = availablePerms ?? {};

  // Map group_name -> list of whitelist names using it
  const usageMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const wl of allWhitelists ?? []) {
      if (wl.squad_group) {
        if (!map[wl.squad_group]) map[wl.squad_group] = [];
        map[wl.squad_group].push(wl.name);
      }
    }
    return map;
  }, [allWhitelists]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12 text-center">
        <p className="text-sm font-medium text-red-400">
          Failed to load data
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and refresh the page.
        </p>
      </div>
    );
  }

  const groupCount = groups?.length ?? 0;
  const atLimit = groupCount >= 10;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-medium ${atLimit ? "text-red-400" : "text-muted-foreground"}`}
        >
          {groupCount} / 10 groups
        </span>
        {atLimit ? (
          <span className="text-xs text-red-400">Group limit reached</span>
        ) : (
          <Button
            size="sm"
            style={{ background: "var(--accent-primary)" }}
            className="text-black font-semibold"
            onClick={() => setShowCreate(true)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Group
          </Button>
        )}
      </div>

      {/* Empty state */}
      {!groups || groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-16 text-center">
          <Layers className="h-8 w-8 text-muted-foreground/50 mb-3 mx-auto" />
          <p className="text-sm text-muted-foreground">
            No permission groups yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-white/[0.08]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[60px]">On</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Permissions</TableHead>
                <TableHead>Used By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const usedBy = usageMap[group.group_name] ?? [];
                return (
                  <TableRow
                    key={group.group_name}
                    className={!group.enabled ? "opacity-60" : undefined}
                  >
                    {/* Status toggle (far left) */}
                    <TableCell>
                      <Switch
                        checked={group.enabled}
                        disabled={toggleGroup.isPending}
                        onCheckedChange={() =>
                          toggleGroup.mutate(group.group_name, {
                            onSuccess: () =>
                              toast.success(
                                `Group ${group.enabled ? "disabled" : "enabled"}`
                              ),
                            onError: (err: unknown) =>
                              toast.error(
                                (err as { message?: string })?.message ??
                                  "Failed to toggle group"
                              ),
                          })
                        }
                      />
                    </TableCell>

                    {/* Name */}
                    <TableCell>
                      <button
                        className="inline-flex items-center gap-2 hover:underline cursor-pointer"
                        onClick={() => setEditingGroup(group)}
                      >
                        <span className="font-mono text-sm">
                          {group.group_name}
                        </span>
                        {group.is_default && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0"
                          >
                            Default
                          </Badge>
                        )}
                      </button>
                    </TableCell>

                    {/* Permissions */}
                    <TableCell>
                      <PermissionBadges
                        permissions={group.permissions}
                        available={available}
                      />
                    </TableCell>

                    {/* Used By */}
                    <TableCell>
                      {usedBy.length > 0 ? (
                        <span className="text-sm text-muted-foreground">
                          {usedBy.join(", ")}
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">
                          &mdash;
                        </span>
                      )}
                    </TableCell>

                    {/* Actions */}
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => setEditingGroup(group)}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setDeletingGroup(group)}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create dialog */}
      <CreateGroupDialog
        available={available}
        open={showCreate}
        onOpenChange={setShowCreate}
      />

      {/* Edit dialog */}
      {editingGroup && (
        <EditGroupDialog
          key={editingGroup.group_name}
          group={editingGroup}
          available={available}
          open={true}
          onOpenChange={(o) => {
            if (!o) setEditingGroup(null);
          }}
        />
      )}

      {/* Delete dialog */}
      {deletingGroup && (
        <DeleteGroupDialog
          key={deletingGroup.group_name}
          group={deletingGroup}
          open={true}
          onOpenChange={(o) => {
            if (!o) setDeletingGroup(null);
          }}
        />
      )}
    </div>
  );
}
