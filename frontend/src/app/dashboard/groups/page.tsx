"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useGroups, useCreateGroup, useUpdateGroup, useDeleteGroup } from "@/hooks/use-settings";
import type { SquadGroup } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
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

export default function GroupsPage() {
  const { data: groups, isLoading } = useGroups();
  const createGroup = useCreateGroup();
  const [createOpen, setCreateOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editGroup, setEditGroup] = useState<SquadGroup | null>(null);

  function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    createGroup.mutate(
      { group_name: newGroupName.trim(), permissions: "" },
      {
        onSuccess: () => {
          toast.success("Group created");
          setNewGroupName("");
          setCreateOpen(false);
        },
        onError: () => toast.error("Failed to create group"),
      }
    );
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
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups?.map((group) => {
          const perms = group.permissions
            ? group.permissions.split(",").filter(Boolean)
            : [];
          return (
            <Card
              key={group.group_name}
              className="cursor-pointer transition-colors hover:bg-white/5"
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
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const currentPerms = group.permissions
    ? group.permissions.split(",").filter(Boolean)
    : [];
  const [selected, setSelected] = useState<string[]>(currentPerms);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(group.group_name);

  function togglePerm(perm: string) {
    setSelected((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  function handleSave() {
    const payload: { group_name: string; permissions?: string; new_name?: string } = {
      group_name: group.group_name,
      permissions: selected.join(","),
    };
    if (nameValue.trim() && nameValue.trim() !== group.group_name) {
      payload.new_name = nameValue.trim();
    }
    updateGroup.mutate(payload, {
      onSuccess: () => {
        toast.success("Group updated");
        onClose();
      },
      onError: () => toast.error("Failed to update group"),
    });
  }

  function handleDelete() {
    deleteGroup.mutate(group.group_name, {
      onSuccess: () => {
        toast.success("Group deleted");
        onClose();
      },
      onError: () => toast.error("Failed to delete group"),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {editingName ? (
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-7 w-48 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingName(false);
                  if (e.key === "Escape") { setNameValue(group.group_name); setEditingName(false); }
                }}
                onBlur={() => setEditingName(false)}
              />
            ) : (
              <span
                className="cursor-pointer hover:underline"
                onClick={() => setEditingName(true)}
                title="Click to rename"
              >
                Edit Group: {nameValue}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Select permissions for this admin group.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SQUAD_PERMISSIONS.map((perm) => (
            <label
              key={perm}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-white/[0.06] px-2 py-1.5 text-xs transition-colors hover:bg-white/5"
            >
              <Checkbox
                checked={selected.includes(perm)}
                onCheckedChange={() => togglePerm(perm)}
              />
              <span>{perm}</span>
            </label>
          ))}
        </div>
        <DialogFooter className="flex justify-between">
          {!group.is_default && (
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              Delete Group
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={updateGroup.isPending}>
              Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
