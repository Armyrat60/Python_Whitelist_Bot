"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Plus,
  Pencil,
  Trash2,
  ArrowRight,
  Eye,
  Loader2,
} from "lucide-react";
import { useRoles } from "@/hooks/use-settings";
import {
  useRoleSyncRules,
  useCreateRoleSyncRule,
  useUpdateRoleSyncRule,
  useDeleteRoleSyncRule,
  useRoleWatchConfigs,
  useSaveRoleWatchConfigs,
} from "@/hooks/use-role-sync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Combobox, MultiCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { RoleSyncRule } from "@/lib/types";

const MAX_RULES = 10;
const MAX_SOURCE_ROLES = 20;

export default function RoleSyncPage() {
  const { data: rules, isLoading: rulesLoading } = useRoleSyncRules();
  const { data: discordRoles } = useRoles();
  const { data: watchConfigs, isLoading: watchLoading } = useRoleWatchConfigs();

  const [editRule, setEditRule] = useState<RoleSyncRule | null>(null);
  const [creating, setCreating] = useState(false);

  const sheetOpen = creating || editRule !== null;

  function closeSheet() {
    setCreating(false);
    setEditRule(null);
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" style={{ color: "var(--accent-primary)" }} />
          Role Sync
        </h1>
        <p className="text-sm text-muted-foreground">
          Automatically assign a target role when members have any of the source roles.
        </p>
      </div>

      {/* Rules Section */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Sync Rules</h2>
            <p className="text-xs text-muted-foreground">
              {rules?.length ?? 0} / {MAX_RULES} rules
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={(rules?.length ?? 0) >= MAX_RULES}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Rule
          </Button>
        </div>

        {rulesLoading ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {[1, 2].map((i) => (
              <Skeleton key={i} className="h-40 rounded-xl" />
            ))}
          </div>
        ) : !rules?.length ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ShieldCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No sync rules yet. Create one to start auto-assigning roles.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {rules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={() => setEditRule(rule)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Watch Config Section */}
      <WatchConfigSection
        watchConfigs={watchConfigs ?? []}
        discordRoles={discordRoles ?? []}
        isLoading={watchLoading}
      />

      {/* Create/Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open) closeSheet(); }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>{editRule ? "Edit Rule" : "New Sync Rule"}</SheetTitle>
            <SheetDescription>
              {editRule
                ? "Update the role sync rule configuration."
                : "Map source Discord roles to a target role."}
            </SheetDescription>
          </SheetHeader>
          <RuleForm
            rule={editRule}
            discordRoles={discordRoles ?? []}
            existingRules={rules ?? []}
            onClose={closeSheet}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Rule Card ───────────────────────────────────────────────────────────────

function RuleCard({
  rule,
  onEdit,
}: {
  rule: RoleSyncRule;
  onEdit: () => void;
}) {
  const updateRule = useUpdateRoleSyncRule();
  const deleteRule = useDeleteRoleSyncRule();

  function handleToggle(enabled: boolean) {
    updateRule.mutate(
      { id: rule.id, enabled },
      {
        onSuccess: () => toast.success(`Rule ${enabled ? "enabled" : "disabled"}`),
        onError: () => toast.error("Failed to update rule"),
      },
    );
  }

  function handleDelete() {
    deleteRule.mutate(rule.id, {
      onSuccess: () => toast.success("Rule deleted"),
      onError: () => toast.error("Failed to delete rule"),
    });
  }

  return (
    <Card className="relative">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <CardTitle className="text-sm font-semibold truncate">
              {rule.name}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {rule.source_roles.length} source role{rule.source_roles.length !== 1 ? "s" : ""}
            </CardDescription>
          </div>
          <Switch
            checked={rule.enabled}
            onCheckedChange={handleToggle}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Source → Target visualization */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1 flex-1 min-w-0">
            {rule.source_roles.slice(0, 5).map((sr) => (
              <Badge key={sr.id} variant="secondary" className="text-[10px] px-1.5 py-0.5">
                {sr.role_name}
              </Badge>
            ))}
            {rule.source_roles.length > 5 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5">
                +{rule.source_roles.length - 5} more
              </Badge>
            )}
          </div>
          <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Badge
            className="text-[10px] px-1.5 py-0.5 shrink-0"
            style={{ background: "var(--accent-primary)", color: "#000" }}
          >
            {rule.target_role_name}
          </Badge>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onEdit}>
            <Pencil className="mr-1 h-3 w-3" />
            Edit
          </Button>
          <AlertDialog>
            <AlertDialogTrigger>
              <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300">
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Rule</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the rule &quot;{rule.name}&quot;.
                  The target role will no longer be auto-managed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Rule Form (Create / Edit) ───────────────────────────────────────────────

function RuleForm({
  rule,
  discordRoles,
  existingRules,
  onClose,
}: {
  rule: RoleSyncRule | null;
  discordRoles: Array<{ id: string; name: string }>;
  existingRules: RoleSyncRule[];
  onClose: () => void;
}) {
  const createRule = useCreateRoleSyncRule();
  const updateRule = useUpdateRoleSyncRule();

  const [name, setName] = useState(rule?.name ?? "");
  const [targetRoleId, setTargetRoleId] = useState(rule?.target_role_id ?? "");
  const [sourceRoleIds, setSourceRoleIds] = useState<string[]>(
    rule?.source_roles.map((r) => r.role_id) ?? [],
  );

  const roleOptions: ComboboxOption[] = useMemo(
    () => discordRoles.map((r) => ({ value: r.id, label: r.name })),
    [discordRoles],
  );

  // Filter out target role from source options and vice versa
  const sourceOptions = useMemo(
    () => roleOptions.filter((r) => r.value !== targetRoleId),
    [roleOptions, targetRoleId],
  );

  const targetOptions = useMemo(
    () => roleOptions.filter((r) => !sourceRoleIds.includes(r.value)),
    [roleOptions, sourceRoleIds],
  );

  const saving = createRule.isPending || updateRule.isPending;

  function handleSave() {
    if (!name.trim()) return toast.error("Name is required");
    if (!targetRoleId) return toast.error("Select a target role");
    if (!sourceRoleIds.length) return toast.error("Select at least one source role");
    if (sourceRoleIds.length > MAX_SOURCE_ROLES) {
      return toast.error(`Maximum ${MAX_SOURCE_ROLES} source roles`);
    }

    const sourceRoles = sourceRoleIds.map((id) => ({
      role_id: id,
      role_name: discordRoles.find((r) => r.id === id)?.name ?? id,
    }));
    const targetRoleName = discordRoles.find((r) => r.id === targetRoleId)?.name ?? targetRoleId;

    if (rule) {
      updateRule.mutate(
        {
          id: rule.id,
          name: name.trim(),
          target_role_id: targetRoleId,
          target_role_name: targetRoleName,
          source_roles: sourceRoles,
        },
        {
          onSuccess: () => {
            toast.success("Rule updated");
            onClose();
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to update"),
        },
      );
    } else {
      createRule.mutate(
        {
          name: name.trim(),
          target_role_id: targetRoleId,
          target_role_name: targetRoleName,
          source_roles: sourceRoles,
        },
        {
          onSuccess: () => {
            toast.success("Rule created");
            onClose();
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create"),
        },
      );
    }
  }

  return (
    <div className="mt-6 space-y-5">
      {/* Name */}
      <div className="space-y-2">
        <Label>Rule Name</Label>
        <Input
          placeholder="e.g. Supporter → VIP"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
      </div>

      {/* Target Role */}
      <div className="space-y-2">
        <Label>Target Role (assigned automatically)</Label>
        <Combobox
          options={targetOptions}
          value={targetRoleId}
          onValueChange={setTargetRoleId}
          placeholder="Select target role..."
          searchPlaceholder="Search roles..."
          emptyText="No roles found"
        />
        <p className="text-[11px] text-muted-foreground">
          This role will be added to members who have any source role.
        </p>
      </div>

      {/* Source Roles */}
      <div className="space-y-2">
        <Label>
          Source Roles ({sourceRoleIds.length}/{MAX_SOURCE_ROLES})
        </Label>
        <MultiCombobox
          options={sourceOptions}
          values={sourceRoleIds}
          onValuesChange={(vals) => setSourceRoleIds(vals.slice(0, MAX_SOURCE_ROLES))}
          placeholder="Select source roles..."
          searchPlaceholder="Search roles..."
          emptyText="No roles found"
        />
        <p className="text-[11px] text-muted-foreground">
          If a member has <strong>any</strong> of these roles, they get the target role.
          When they lose <strong>all</strong> source roles, the target role is removed.
        </p>
      </div>

      {/* Selected Source Roles Preview */}
      {sourceRoleIds.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {sourceRoleIds.map((id) => {
            const roleName = discordRoles.find((r) => r.id === id)?.name ?? id;
            return (
              <Badge
                key={id}
                variant="secondary"
                className="text-[10px] px-1.5 py-0.5 cursor-pointer hover:bg-red-500/20 hover:text-red-400 transition-colors"
                onClick={() => setSourceRoleIds((prev) => prev.filter((v) => v !== id))}
              >
                {roleName} &times;
              </Badge>
            );
          })}
        </div>
      )}

      {/* Save / Cancel */}
      <div className="flex gap-3 pt-2">
        <Button onClick={handleSave} disabled={saving} className="flex-1">
          {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {rule ? "Save Changes" : "Create Rule"}
        </Button>
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ── Watch Config Section ────────────────────────────────────────────────────

function WatchConfigSection({
  watchConfigs,
  discordRoles,
  isLoading,
}: {
  watchConfigs: Array<{ id: number; role_id: string; role_name: string }>;
  discordRoles: Array<{ id: string; name: string }>;
  isLoading: boolean;
}) {
  const saveWatch = useSaveRoleWatchConfigs();
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Initialize from server data
  if (!initialized && watchConfigs.length > 0) {
    setWatchedIds(watchConfigs.map((c) => c.role_id));
    setInitialized(true);
  }
  if (!initialized && !isLoading && watchConfigs.length === 0) {
    setInitialized(true);
  }

  const roleOptions: ComboboxOption[] = useMemo(
    () => discordRoles.map((r) => ({ value: r.id, label: r.name })),
    [discordRoles],
  );

  const hasChanges = useMemo(() => {
    const serverIds = new Set(watchConfigs.map((c) => c.role_id));
    if (watchedIds.length !== serverIds.size) return true;
    return watchedIds.some((id) => !serverIds.has(id));
  }, [watchedIds, watchConfigs]);

  function handleSave() {
    const roles = watchedIds.map((id) => ({
      role_id: id,
      role_name: discordRoles.find((r) => r.id === id)?.name ?? id,
    }));
    saveWatch.mutate(roles, {
      onSuccess: () => toast.success("Watched roles updated"),
      onError: () => toast.error("Failed to save watched roles"),
    });
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold flex items-center gap-2">
          <Eye className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
          Role Change Monitoring
        </h2>
        <p className="text-xs text-muted-foreground">
          Select which Discord roles to track. All gains and losses are logged and visible in the Role Logs page.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5 space-y-4">
          {isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <div className="space-y-2">
                <Label>Watched Roles</Label>
                <MultiCombobox
                  options={roleOptions}
                  values={watchedIds}
                  onValuesChange={setWatchedIds}
                  placeholder="Select roles to watch..."
                  searchPlaceholder="Search roles..."
                  emptyText="No roles found"
                />
              </div>

              {watchedIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {watchedIds.map((id) => {
                    const roleName = discordRoles.find((r) => r.id === id)?.name ?? id;
                    return (
                      <Badge
                        key={id}
                        variant="secondary"
                        className="text-[10px] px-1.5 py-0.5 cursor-pointer hover:bg-red-500/20 hover:text-red-400 transition-colors"
                        onClick={() => setWatchedIds((prev) => prev.filter((v) => v !== id))}
                      >
                        {roleName} &times;
                      </Badge>
                    );
                  })}
                </div>
              )}

              <Button
                size="sm"
                onClick={handleSave}
                disabled={!hasChanges || saveWatch.isPending}
              >
                {saveWatch.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save Watched Roles
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
