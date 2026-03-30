"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import {
  useGroups,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useSquadPermissions,
} from "@/hooks/use-settings";
import type { SquadGroup } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

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
            <span className="block text-[11px] text-muted-foreground font-mono">{key}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

// ── Create group dialog ───────────────────────────────────────────────────────

function CreateGroupDialog({ available }: { available: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>(["reserve"]);
  const create = useCreateGroup();

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Group name is required"); return; }
    if (selectedPerms.length === 0) { toast.error("Select at least one permission"); return; }
    create.mutate(
      { group_name: trimmed, permissions: selectedPerms.join(",") },
      {
        onSuccess: () => {
          toast.success(`Group "${trimmed}" created`);
          setName("");
          setSelectedPerms(["reserve"]);
          setOpen(false);
        },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "Failed to create group";
          toast.error(msg);
        },
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={
        <Button size="sm" style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Group
        </Button>
      } />
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
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            />
            <p className="text-[11px] text-muted-foreground">
              This becomes the Squad server group name (e.g. <code className="font-mono">{name || "reserve"}:reserve</code>)
            </p>
          </div>
          <div className="space-y-1.5">
            <Label>Permissions</Label>
            <PermissionGrid available={available} selected={selectedPerms} onChange={setSelectedPerms} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={create.isPending} className="text-black font-semibold" style={{ background: "var(--accent-primary)" }}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────

function GroupCard({
  group,
  available,
}: {
  group: SquadGroup;
  available: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.group_name);
  const [selectedPerms, setSelectedPerms] = useState<string[]>(() =>
    group.permissions ? group.permissions.split(",").map((p) => p.trim()).filter(Boolean) : []
  );
  const update = useUpdateGroup();
  const remove = useDeleteGroup();

  function handleSave() {
    if (!name.trim()) { toast.error("Group name is required"); return; }
    if (selectedPerms.length === 0) { toast.error("Select at least one permission"); return; }
    update.mutate(
      {
        group_name: group.group_name,
        new_name:   name.trim() !== group.group_name ? name.trim() : undefined,
        permissions: selectedPerms.join(","),
      },
      {
        onSuccess: () => { toast.success("Group updated"); setEditing(false); },
        onError: (err: unknown) => {
          const msg = (err as { message?: string })?.message ?? "Failed to update group";
          toast.error(msg);
        },
      }
    );
  }

  function handleCancel() {
    setName(group.group_name);
    setSelectedPerms(group.permissions ? group.permissions.split(",").map((p) => p.trim()).filter(Boolean) : []);
    setEditing(false);
  }

  const permLabels = useMemo(
    () => (group.permissions || "").split(",").map((p) => p.trim()).filter(Boolean),
    [group.permissions]
  );

  return (
    <Card className={group.is_default ? "border-l-4 border-l-[var(--accent-primary)]" : ""}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          {editing ? (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-7 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
            />
          ) : (
            <span className="font-mono text-base">{group.group_name}</span>
          )}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {group.is_default && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Default</Badge>
            )}
            {editing ? (
              <>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleSave} disabled={update.isPending}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleCancel}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardTitle>
        <CardDescription className="font-mono text-[11px]">
          Squad config: <span className="text-white/60">{group.group_name}:{group.permissions || "reserve"}</span>
        </CardDescription>
      </CardHeader>

      <CardContent className="pb-2">
        {editing ? (
          <PermissionGrid available={available} selected={selectedPerms} onChange={setSelectedPerms} />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {permLabels.length === 0 ? (
              <span className="text-xs text-muted-foreground italic">No permissions</span>
            ) : (
              permLabels.map((p) => (
                <Badge key={p} variant="outline" className="font-mono text-[11px]">
                  {available[p] ? `${available[p]} (${p})` : p}
                </Badge>
              ))
            )}
          </div>
        )}
      </CardContent>

      {!editing && (
        <CardFooter className="pt-2">
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button size="sm" variant="destructive" className="ml-auto">
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete group &ldquo;{group.group_name}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the group. Any whitelists using it must be reassigned first.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() =>
                    remove.mutate(group.group_name, {
                      onSuccess: () => toast.success(`Group "${group.group_name}" deleted`),
                      onError: (err: unknown) => {
                        const msg = (err as { message?: string })?.message ?? "Failed to delete group";
                        toast.error(msg);
                      },
                    })
                  }
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      )}
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SquadGroupsPage() {
  const { data: groups, isLoading } = useGroups();
  const { data: availablePerms } = useSquadPermissions();

  const available = availablePerms ?? {};

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Squad Groups</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            These map to{" "}
            <code className="rounded bg-muted px-1.5 py-0.5 text-xs">Group=name:permissions</code>{" "}
            lines in your Squad server config.
          </p>
          <p className={`mt-1 text-xs font-medium ${(groups?.length ?? 0) >= 10 ? "text-red-400" : "text-muted-foreground"}`}>
            {groups?.length ?? 0} / 10 groups used
          </p>
        </div>
        {(groups?.length ?? 0) < 10 && <CreateGroupDialog available={available} />}
        {(groups?.length ?? 0) >= 10 && (
          <span className="text-xs text-red-400">Group limit reached</span>
        )}
      </div>

      {(!groups || groups.length === 0) ? (
        <div className="rounded-xl border border-dashed border-white/10 py-16 text-center">
          <p className="text-sm text-muted-foreground">No groups yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
          {groups.map((g) => (
            <GroupCard key={g.group_name} group={g} available={available} />
          ))}
        </div>
      )}
    </div>
  );
}
