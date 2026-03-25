"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Save, Check, Users, Crown } from "lucide-react";
import {
  useSettings,
  useWhitelists,
  useRoles,
  useStats,
  useAddRoleMapping,
  useRemoveRoleMapping,
} from "@/hooks/use-settings";
import type { RoleMapping } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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

export default function TiersPage() {
  const { data: settingsData, isLoading } = useSettings();
  const { data: whitelists } = useWhitelists();
  const { data: roles } = useRoles();
  const { data: stats } = useStats();
  const addRole = useAddRoleMapping();
  const removeRole = useRemoveRoleMapping();

  const [selectedWhitelist, setSelectedWhitelist] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newSlotCount, setNewSlotCount] = useState("1");
  const [editingSlots, setEditingSlots] = useState<Record<string, string>>({});

  // Auto-select first whitelist
  const activeSlug = selectedWhitelist || (whitelists?.[0]?.slug ?? "");

  const mappings: RoleMapping[] = useMemo(() => {
    if (!settingsData?.role_mappings || !activeSlug) return [];
    const raw = settingsData.role_mappings[activeSlug] ?? [];
    return [...raw].sort((a, b) => a.slot_limit - b.slot_limit);
  }, [settingsData, activeSlug]);

  const roleOptions: ComboboxOption[] = useMemo(
    () =>
      (roles ?? [])
        .filter((r) => !mappings.some((m) => m.role_id === r.id))
        .map((role) => ({
          value: role.id,
          label: role.name,
          icon: (
            <span
              className="mr-2 inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: role.color || "#99AAB5" }}
            />
          ),
        })),
    [roles, mappings]
  );

  // Get per-type stats for user counts
  const perTypeStats = stats?.per_type?.[activeSlug];

  function handleAdd() {
    if (!activeSlug || !newRoleId) return;
    addRole.mutate(
      { slug: activeSlug, role_id: newRoleId, slot_limit: Number(newSlotCount) || 1 },
      {
        onSuccess: () => {
          toast.success("Tier added");
          setNewRoleId("");
          setNewSlotCount("1");
        },
        onError: () => toast.error("Failed to add tier"),
      }
    );
  }

  function handleRemove(roleId: string) {
    if (!activeSlug) return;
    removeRole.mutate(
      { slug: activeSlug, roleId },
      {
        onSuccess: () => toast.success("Tier removed"),
        onError: () => toast.error("Failed to remove tier"),
      }
    );
  }

  function handleUpdateSlots(roleId: string) {
    if (!activeSlug) return;
    const newLimit = Number(editingSlots[roleId]);
    if (!newLimit || newLimit < 1) return;
    addRole.mutate(
      { slug: activeSlug, role_id: roleId, slot_limit: newLimit },
      {
        onSuccess: () => {
          toast.success("Slot count updated");
          setEditingSlots((prev) => {
            const next = { ...prev };
            delete next[roleId];
            return next;
          });
        },
        onError: () => toast.error("Failed to update"),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with whitelist selector */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Subscription Tiers</h2>
          <p className="text-sm text-muted-foreground">
            Define tiers by mapping Discord roles to whitelist slot counts.
          </p>
        </div>
        {whitelists && whitelists.length > 1 && (
          <Select value={activeSlug} onValueChange={(v) => setSelectedWhitelist(v ?? "")}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select whitelist" />
            </SelectTrigger>
            <SelectContent>
              {whitelists.map((wl) => (
                <SelectItem key={wl.slug} value={wl.slug}>
                  {wl.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Summary card */}
      <Card className="border-orange-500/20 bg-orange-500/5">
        <CardContent className="flex items-center gap-6 p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-500/20">
            <Crown className="h-6 w-6 text-orange-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {mappings.length} {mappings.length === 1 ? "tier" : "tiers"} configured
            </p>
            <p className="text-xs text-muted-foreground">
              {perTypeStats?.active_users ?? 0} active users •{" "}
              {perTypeStats?.total_ids ?? 0} total IDs
            </p>
          </div>
          <div className="flex gap-2">
            {mappings.map((rm) => (
              <Badge key={rm.role_id} variant="outline" className="text-xs">
                {rm.role_name} ({rm.slot_limit})
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tier list */}
      <div className="space-y-3">
        {mappings.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm font-medium">No tiers configured</p>
              <p className="text-xs text-muted-foreground">
                Add a Discord role below to create your first tier.
              </p>
            </CardContent>
          </Card>
        ) : (
          mappings.map((rm) => {
            const isEditing = rm.role_id in editingSlots;
            const editValue = editingSlots[rm.role_id] ?? String(rm.slot_limit);
            const role = roles?.find((r) => r.id === rm.role_id);

            return (
              <Card key={rm.role_id}>
                <CardContent className="flex items-center gap-4 p-4">
                  {/* Role color dot */}
                  <span
                    className="h-4 w-4 shrink-0 rounded-full"
                    style={{ backgroundColor: role?.color || "#99AAB5" }}
                  />

                  {/* Role info */}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{rm.role_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Discord role: @{rm.role_name}
                    </p>
                  </div>

                  {/* Slot count (editable) */}
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={isEditing ? editValue : String(rm.slot_limit)}
                      onChange={(e) =>
                        setEditingSlots((prev) => ({
                          ...prev,
                          [rm.role_id]: e.target.value,
                        }))
                      }
                      className="h-9 w-20 text-center font-mono"
                    />
                    <span className="text-sm text-muted-foreground">
                      {rm.slot_limit === 1 ? "slot" : "slots"}
                    </span>
                    {isEditing && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-9 text-emerald-500 hover:text-emerald-400"
                        onClick={() => handleUpdateSlots(rm.role_id)}
                        disabled={addRole.isPending}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {/* Remove */}
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                        />
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove {rm.role_name} tier?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Users with this role will lose their whitelist slots.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => handleRemove(rm.role_id)}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Add new tier */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add Tier</CardTitle>
          <CardDescription>
            Select a Discord role and set how many whitelist slots it grants.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="flex-1">
              <Combobox
                options={roleOptions}
                value={newRoleId}
                onValueChange={setNewRoleId}
                placeholder="Select Discord role..."
                searchPlaceholder="Search roles..."
                emptyText="No roles available."
              />
            </div>
            <Input
              type="number"
              min={1}
              max={99}
              value={newSlotCount}
              onChange={(e) => setNewSlotCount(e.target.value)}
              placeholder="Slots"
              className="w-24"
            />
            <Button
              onClick={handleAdd}
              disabled={!newRoleId || addRole.isPending}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add Tier
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
