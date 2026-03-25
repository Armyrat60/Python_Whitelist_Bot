"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { useGroups } from "@/hooks/use-settings";
import { api } from "@/lib/api";
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
    <div className="space-y-4">
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
