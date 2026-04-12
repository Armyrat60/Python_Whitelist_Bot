"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";
import { useUpdatePanelRole } from "@/hooks/use-settings";
import type { PanelRole } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function PanelRoleRow({
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
    if (isNaN(limit) || limit < 1) {
      toast.error("Slots must be at least 1");
      return;
    }
    updateRole.mutate(
      { roleId: role.role_id, slot_limit: limit, is_stackable: stackable },
      {
        onSuccess: () => {
          toast.success("Role updated");
          setEditing(false);
        },
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
        <span className="text-sm font-medium text-foreground">
          {role.display_name || role.role_name}
        </span>
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
            <Switch
              checked={stackable}
              onCheckedChange={setStackable}
              id={`stack-${role.role_id}`}
            />
            <Label
              htmlFor={`stack-${role.role_id}`}
              className="text-xs text-muted-foreground"
            >
              Stack
            </Label>
          </div>
          <div className="ml-auto flex gap-1.5">
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={handleSave}
              disabled={updateRole.isPending}
            >
              <Check className="h-4 w-4" />
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={handleCancel}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/[0.10] px-2.5 py-1.5 text-sm">
      <span className="flex-1 truncate font-medium text-foreground">
        {role.display_name || role.role_name}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {role.slot_limit} slot{role.slot_limit !== 1 ? "s" : ""}
      </span>
      {role.is_stackable && (
        <span className="shrink-0 text-xs text-blue-400 border border-blue-400/30 rounded px-1">
          stack
        </span>
      )}
      <Button
        size="icon-sm"
        variant="outline"
        className="shrink-0 text-muted-foreground hover:text-foreground hover:border-foreground/30"
        onClick={() => setEditing(true)}
        title="Edit role"
      >
        <Pencil className="h-4 w-4" />
      </Button>
      <Button
        size="icon-sm"
        variant="outline"
        className="shrink-0 text-muted-foreground hover:text-destructive hover:border-destructive/30"
        onClick={onRemove}
        title="Remove role"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
