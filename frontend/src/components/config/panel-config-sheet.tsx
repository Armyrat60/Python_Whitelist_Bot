"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Save, ShieldCheck, X } from "lucide-react";
import {
  useUpdatePanel,
  usePanelRoles,
  useAddPanelRole,
  useRemovePanelRole,
  useRoles,
} from "@/hooks/use-settings";
import type { Panel, Whitelist, PanelRole } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import PanelRoleRow from "./panel-role-row";

interface Channel {
  id: string;
  name: string;
}

export default function PanelConfigSheet({
  panel,
  whitelists,
  channels,
  open,
  onOpenChange,
}: {
  panel: Panel;
  whitelists: Whitelist[];
  channels: Channel[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updatePanel = useUpdatePanel();

  const [panelName, setPanelName] = useState(panel.name);
  const [channelId, setChannelId] = useState(panel.channel_id ?? "");
  const [logChannelId, setLogChannelId] = useState(panel.log_channel_id ?? "");
  const [whitelistId, setWhitelistId] = useState(
    panel.whitelist_id?.toString() ?? ""
  );
  const [showRoleMentions, setShowRoleMentions] = useState(
    panel.show_role_mentions ?? true
  );
  const [enabled, setEnabled] = useState(panel.enabled ?? true);

  // Access roles
  const [addRoleOpen, setAddRoleOpen] = useState(false);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [slotLimit, setSlotLimit] = useState("1");
  const [isStackable, setIsStackable] = useState(false);

  const { data: panelRoles, isLoading: rolesLoading } = usePanelRoles(
    panel.id
  );
  const { data: discordRoles } = useRoles();
  const addRole = useAddPanelRole(panel.id);
  const removeRole = useRemovePanelRole(panel.id);

  const availableRoles: ComboboxOption[] = useMemo(() => {
    const assignedIds = new Set((panelRoles ?? []).map((r) => r.role_id));
    return (discordRoles ?? [])
      .filter((r) => !assignedIds.has(r.id))
      .map((r) => ({ value: r.id, label: r.name }));
  }, [discordRoles, panelRoles]);

  const channelOptions: ComboboxOption[] = useMemo(
    () => [
      { value: "", label: "None (no channel)" },
      ...channels.map((ch) => ({ value: ch.id, label: `#${ch.name}` })),
    ],
    [channels]
  );

  const whitelistOptions: ComboboxOption[] = useMemo(
    () => whitelists.map((wl) => ({ value: String(wl.id), label: wl.name })),
    [whitelists]
  );

  async function handleAddRole() {
    if (selectedRoleIds.length === 0) return;
    const slots = parseInt(slotLimit, 10);
    if (isNaN(slots) || slots < 1) return;

    for (const roleId of selectedRoleIds) {
      const role = discordRoles?.find((r) => r.id === roleId);
      if (!role) continue;
      try {
        await addRole.mutateAsync({
          role_id: role.id,
          role_name: role.name,
          slot_limit: slots,
          is_stackable: isStackable,
        });
      } catch {
        toast.error(`Failed to add ${role.name}`);
        return;
      }
    }
    toast.success(
      selectedRoleIds.length === 1
        ? `Added ${discordRoles?.find((r) => r.id === selectedRoleIds[0])?.name}`
        : `Added ${selectedRoleIds.length} roles`
    );
    setSelectedRoleIds([]);
    setSlotLimit("1");
    setIsStackable(false);
    setAddRoleOpen(false);
  }

  function handleSave() {
    updatePanel.mutate(
      {
        id: panel.id,
        name: panelName.trim() || panel.name,
        channel_id: channelId || null,
        log_channel_id: logChannelId || null,
        whitelist_id: whitelistId ? Number(whitelistId) : null,
        show_role_mentions: showRoleMentions,
        enabled,
      },
      {
        onSuccess: () => {
          toast.success("Panel saved");
          onOpenChange(false);
        },
        onError: () => toast.error("Failed to save panel"),
      }
    );
  }

  function handleCancel() {
    setPanelName(panel.name);
    setChannelId(panel.channel_id ?? "");
    setLogChannelId(panel.log_channel_id ?? "");
    setWhitelistId(panel.whitelist_id?.toString() ?? "");
    setShowRoleMentions(panel.show_role_mentions ?? true);
    setEnabled(panel.enabled ?? true);
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Configure Panel</SheetTitle>
          <SheetDescription>
            Edit panel settings and manage access roles.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4">
          {/* Name */}
          <div className="space-y-2">
            <Label className="text-xs">Name</Label>
            <Input
              value={panelName}
              onChange={(e) => setPanelName(e.target.value)}
              placeholder="Panel name"
            />
          </div>

          {/* Channel */}
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

          {/* Log Channel */}
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

          {/* Whitelist */}
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

          {/* Show Role Mentions */}
          <div className="flex items-center justify-between rounded-lg border border-white/[0.10] px-3 py-2">
            <div>
              <Label className="text-xs">Show Role Mentions</Label>
              <p className="text-[10px] text-muted-foreground">
                Display roles as @mention pills in the panel embed
              </p>
            </div>
            <Switch
              checked={showRoleMentions}
              onCheckedChange={setShowRoleMentions}
            />
          </div>

          {/* Enabled */}
          <div className="flex items-center justify-between rounded-lg border border-white/[0.10] px-3 py-2">
            <div>
              <Label className="text-xs">Enabled</Label>
              <p className="text-[10px] text-muted-foreground">
                Disabled panels will not respond to interactions
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} />
          </div>

          {/* Access Roles */}
          <div className="border-t border-white/[0.10] pt-3 space-y-3">
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
                  <MultiCombobox
                    options={availableRoles}
                    values={selectedRoleIds}
                    onValuesChange={setSelectedRoleIds}
                    placeholder="Select roles..."
                    searchPlaceholder="Search roles..."
                    emptyText="No roles available."
                    disabled={addRole.isPending}
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
                        id={`stackable-new-sheet-${panel.id}`}
                      />
                      <Label
                        htmlFor={`stackable-new-sheet-${panel.id}`}
                        className="text-xs text-muted-foreground"
                      >
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
                    disabled={selectedRoleIds.length === 0 || addRole.isPending}
                  >
                    {selectedRoleIds.length > 1
                      ? `Add ${selectedRoleIds.length} Roles`
                      : "Add Role"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setAddRoleOpen(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {rolesLoading ? (
              <div className="space-y-1.5">
                {[1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-8 rounded animate-pulse bg-white/[0.04]"
                  />
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
                No access roles yet. Add Discord roles to define who can sign up
                through this panel and how many slots they get.
              </p>
            )}
          </div>
        </div>

        <SheetFooter>
          <div className="flex gap-2">
            <Button
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={handleSave}
              disabled={updatePanel.isPending}
            >
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
            <Button variant="outline" onClick={handleCancel}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
