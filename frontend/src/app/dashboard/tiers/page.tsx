"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Check, Crown, X, RefreshCw, Users } from "lucide-react";
import {
  useTierCategories,
  useCreateTierCategory,
  useUpdateTierCategory,
  useDeleteTierCategory,
  useAddTierEntry,
  useUpdateTierEntry,
  useRemoveTierEntry,
  useRoles,
  useWhitelists,
  useRoleStats,
} from "@/hooks/use-settings";
import type { TierCategory, TierEntry } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
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

function RoleStatsSection() {
  const { data, isLoading, error, refetch, isFetching } = useRoleStats();
  const [resyncing, setResyncing] = useState(false);

  const stats = data?.stats ?? [];
  const gatewayMode = data?.gateway_mode ?? false;

  const totalDiscord = stats.reduce((s, r) => s + r.discord_count, 0);
  const totalRegistered = stats.reduce((s, r) => s + r.registered_count, 0);
  const totalUnregistered = totalDiscord - totalRegistered;

  async function handleResync() {
    setResyncing(true);
    try {
      const res = await fetch("/api/admin/role-sync/check", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error((data as { error?: string }).error || "Role sync failed");
      } else {
        toast.success("Discord roles resynced");
        refetch();
      }
    } catch {
      toast.error("Role sync failed");
    } finally {
      setResyncing(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="h-4 w-4" />
          Role Registration Stats
          <span className="ml-auto flex items-center gap-3">
            {data && (
              <span className="text-sm font-normal text-muted-foreground flex items-center gap-3">
                <span style={{ color: "var(--accent-primary)" }}>{totalRegistered} registered</span>
                {totalUnregistered > 0 && (
                  <span className="text-amber-400">{totalUnregistered} missing</span>
                )}
              </span>
            )}
            {gatewayMode && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleResync}
                disabled={resyncing || isFetching}
                title="Re-check Discord role membership and update whitelist status"
              >
                <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${resyncing ? "animate-spin" : ""}`} />
                Resync Roles
              </Button>
            )}
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="rounded p-0.5 text-muted-foreground hover:text-white transition-colors"
              title="Refresh stats"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </button>
          </span>
        </CardTitle>
        <CardDescription>
          Discord role member count vs. active whitelist registrations per tier role.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">
            Failed to load role stats — bot may not be connected.
          </p>
        ) : stats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active tier roles found.</p>
        ) : (
          <div className="space-y-2">
            {stats.map((r) => {
              const pct = r.discord_count > 0
                ? Math.round((r.registered_count / r.discord_count) * 100)
                : 100;
              const missing = r.unregistered_count;
              return (
                <div key={r.role_id} className="flex items-center gap-3 text-sm">
                  <span className="w-36 truncate font-medium" title={r.role_name}>{r.role_name}</span>
                  <div className="relative flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: missing > 0
                          ? "linear-gradient(90deg, var(--accent-primary), oklch(0.8 0.18 80))"
                          : "var(--accent-primary)",
                      }}
                    />
                  </div>
                  <span className="w-36 shrink-0 text-right text-xs text-muted-foreground">
                    {r.registered_count}/{r.discord_count} registered
                    {missing > 0 && (
                      <span className="ml-1 text-amber-400">({missing} missing)</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function TiersPage() {
  const { data: categories, isLoading } = useTierCategories();
  const { data: roles } = useRoles();
  const createCategory = useCreateTierCategory();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  function handleCreateCategory() {
    if (!newName.trim()) return;
    createCategory.mutate(
      { name: newName.trim(), description: newDescription.trim() || undefined },
      {
        onSuccess: () => {
          toast.success("Category created");
          setNewName("");
          setNewDescription("");
          setCreateOpen(false);
        },
        onError: () => toast.error("Failed to create category"),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tier Categories</h2>
          <p className="text-sm text-muted-foreground">
            Create categories of tiers and assign them to panels.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger
            render={
              <Button>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create Category
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Tier Category</DialogTitle>
              <DialogDescription>
                Give your new tier category a name and optional description.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Standard Tiers"
                />
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Input
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="e.g. Default tier set for most panels"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreateCategory}
                disabled={createCategory.isPending || !newName.trim()}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Category grid */}
      {categories && categories.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {categories.map((cat) => (
            <CategoryCard key={cat.id} category={cat} roles={roles ?? []} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Crown className="mb-3 h-10 w-10 text-muted-foreground/50" />
            <p className="text-sm font-medium">No tier categories</p>
            <p className="text-xs text-muted-foreground">
              Create your first tier category to get started.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Role registration stats */}
      <RoleStatsSection />
    </div>
  );
}

// ─── Category card ─────────────────────────────────────────────────────────

function CategoryCard({
  category,
  roles,
}: {
  category: TierCategory;
  roles: { id: string; name: string; color: string; position: number }[];
}) {
  const deleteCategory = useDeleteTierCategory();
  const updateCategory = useUpdateTierCategory();
  const addEntry = useAddTierEntry();
  const updateEntry = useUpdateTierEntry();
  const removeEntry = useRemoveTierEntry();
  const { data: whitelists } = useWhitelists();

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(category.name);
  const [newRoleId, setNewRoleId] = useState("");
  const [newSlotCount, setNewSlotCount] = useState("1");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [editingSlots, setEditingSlots] = useState<Record<number, string>>({});
  const [syncPromptRole, setSyncPromptRole] = useState<{ id: string; name: string } | null>(null);
  const [syncWhitelistSlug, setSyncWhitelistSlug] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Sort entries by sort_order then slot_limit
  const sortedEntries = useMemo(
    () =>
      [...category.entries].sort(
        (a, b) => a.sort_order - b.sort_order || a.slot_limit - b.slot_limit
      ),
    [category.entries]
  );

  const totalCapacity = category.entries
    .filter((e) => e.is_active)
    .reduce((s, e) => s + e.slot_limit, 0);

  // Build role options, excluding roles already in this category
  // Show color dot + role ID suffix to distinguish duplicates
  const roleOptions: ComboboxOption[] = useMemo(() => {
    const filtered = roles.filter(
      (r) => !category.entries.some((e) => e.role_id === r.id)
    );
    // Check for duplicate names to know when to show IDs
    const nameCounts: Record<string, number> = {};
    for (const r of filtered) {
      nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;
    }
    return filtered.map((role) => ({
      value: role.id,
      label:
        nameCounts[role.name] > 1
          ? `${role.name}  (ID: ...${role.id.slice(-6)})`
          : role.name,
      icon: (
        <span
          className="mr-2 inline-block h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: role.color || "#99AAB5" }}
        />
      ),
    }));
  }, [roles, category.entries]);

  function handleAddEntry() {
    if (!newRoleId) return;
    const role = roles.find((r) => r.id === newRoleId);
    const roleForPrompt = role ? { id: role.id, name: role.name } : null;
    addEntry.mutate(
      {
        categoryId: category.id,
        role_id: newRoleId,
        role_name: role?.name ?? "Unknown",
        slot_limit: Number(newSlotCount) || 1,
        display_name: newDisplayName.trim() || undefined,
      },
      {
        onSuccess: () => {
          toast.success("Tier entry added");
          setNewRoleId("");
          setNewSlotCount("1");
          setNewDisplayName("");
          // Prompt to sync role members into a whitelist
          if (roleForPrompt) {
            setSyncPromptRole(roleForPrompt);
            setSyncWhitelistSlug(whitelists?.[0]?.slug ?? "");
          }
        },
        onError: () => toast.error("Failed to add tier entry"),
      }
    );
  }

  async function handleRoleSync() {
    if (!syncPromptRole || !syncWhitelistSlug) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/role-sync/pull", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: syncPromptRole.id, whitelist_slug: syncWhitelistSlug, dry_run: false }),
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* plain-text error */ }
      if (!res.ok) throw new Error((data.error as string) || `Server error ${res.status}`);
      const added = (data.added as unknown[])?.length ?? 0;
      toast.success(`Pulled ${added} member${added !== 1 ? "s" : ""} from @${syncPromptRole.name} → ${syncWhitelistSlug}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role sync failed");
    } finally {
      setSyncing(false);
      setSyncPromptRole(null);
    }
  }

  function handleToggleActive(entry: TierEntry) {
    updateEntry.mutate(
      { categoryId: category.id, entryId: entry.id, is_active: !entry.is_active },
      {
        onSuccess: () => toast.success(entry.is_active ? "Tier deactivated" : "Tier activated"),
        onError: () => toast.error("Failed to toggle tier"),
      }
    );
  }

  function handleUpdateSlots(entry: TierEntry) {
    const newLimit = Number(editingSlots[entry.id]);
    if (!newLimit || newLimit < 1) return;
    updateEntry.mutate(
      {
        categoryId: category.id,
        entryId: entry.id,
        slot_limit: newLimit,
      },
      {
        onSuccess: () => {
          toast.success("Slot count updated");
          setEditingSlots((prev) => {
            const next = { ...prev };
            delete next[entry.id];
            return next;
          });
        },
        onError: () => toast.error("Failed to update"),
      }
    );
  }

  function handleRemoveEntry(entryId: number) {
    removeEntry.mutate(
      { categoryId: category.id, entryId },
      {
        onSuccess: () => toast.success("Tier entry removed"),
        onError: () => toast.error("Failed to remove tier entry"),
      }
    );
  }

  function handleDeleteCategory() {
    deleteCategory.mutate(category.id, {
      onSuccess: () => toast.success("Category deleted"),
      onError: () => toast.error("Failed to delete category"),
    });
  }

  return (
    <>
    {/* Role sync prompt dialog */}
    {syncPromptRole && (
      <Dialog open onOpenChange={(open) => { if (!open) setSyncPromptRole(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync Role Members?</DialogTitle>
            <DialogDescription>
              Pull all current members of <strong>@{syncPromptRole.name}</strong> into a whitelist now?
              They&apos;ll be added as active users and can self-register their Steam IDs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-xs">Target Whitelist</Label>
            <Select value={syncWhitelistSlug} onValueChange={(v) => setSyncWhitelistSlug(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select whitelist" /></SelectTrigger>
              <SelectContent>
                {whitelists?.map((wl) => (
                  <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSyncPromptRole(null)}>Skip</Button>
            <Button onClick={handleRoleSync} disabled={syncing || !syncWhitelistSlug}
              style={{ background: "var(--accent-primary)" }} className="text-black font-semibold">
              {syncing ? <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Sync Now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    <Card className="border-l-4 border-l-emerald-500">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {editingName ? (
            <div className="flex items-center gap-1">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-7 w-40 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    updateCategory.mutate(
                      { id: category.id, name: nameValue.trim() },
                      {
                        onSuccess: () => { toast.success("Renamed"); setEditingName(false); },
                        onError: () => toast.error("Failed to rename"),
                      }
                    );
                  }
                  if (e.key === "Escape") { setNameValue(category.name); setEditingName(false); }
                }}
              />
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                style={{ color: "var(--accent-primary)" }}
                onClick={() => {
                  updateCategory.mutate(
                    { id: category.id, name: nameValue.trim() },
                    {
                      onSuccess: () => { toast.success("Renamed"); setEditingName(false); },
                      onError: () => toast.error("Failed to rename"),
                    }
                  );
                }}
              >
                <Check className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={() => { setNameValue(category.name); setEditingName(false); }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <span
              className="cursor-pointer hover:underline"
              onClick={() => setEditingName(true)}
              title="Click to rename"
            >
              {category.name}
            </span>
          )}
          {category.is_default && (
            <Badge
              variant="secondary"
              className="text-[10px] cursor-help"
              title="Default category — cannot be deleted but can be renamed"
            >
              Default
            </Badge>
          )}
          <span className="ml-auto flex items-center gap-2">
            {totalCapacity > 0 && (
              <Badge variant="outline" className="text-[10px] font-mono" title="Total active slot capacity">
                {totalCapacity} slots
              </Badge>
            )}
            <span className="text-[10px] font-mono text-muted-foreground/40 select-all" title="Category ID">
              #{category.id}
            </span>
          </span>
        </CardTitle>
        {category.description && (
          <CardDescription>{category.description}</CardDescription>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Tier entries list */}
        {sortedEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">
            No tiers in this category yet.
          </p>
        ) : (
          <div className="space-y-1.5">
            {sortedEntries.map((entry) => {
              const role = roles.find((r) => r.id === entry.role_id);
              const isEditing = entry.id in editingSlots;
              const editValue =
                editingSlots[entry.id] ?? String(entry.slot_limit);

              return (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3 rounded-lg border border-l-4 px-3 py-2 ${
                    entry.is_active
                      ? "border-white/[0.06] border-l-emerald-500"
                      : "border-white/[0.06] border-l-red-500 opacity-60"
                  }`}
                  title={`Role ID: ${entry.role_id}`}
                >
                  {/* Role color dot */}
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/[0.20]"
                    style={{
                      backgroundColor: role?.color || "#99AAB5",
                    }}
                  />

                  {/* Role name + ID */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {entry.role_name}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-mono truncate">
                      ID: {entry.role_id}
                    </p>
                  </div>

                  {/* Slot count — auto-saves on blur or Enter */}
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={1}
                      max={99}
                      value={isEditing ? editValue : String(entry.slot_limit)}
                      onChange={(e) =>
                        setEditingSlots((prev) => ({
                          ...prev,
                          [entry.id]: e.target.value,
                        }))
                      }
                      onBlur={() => {
                        if (isEditing) handleUpdateSlots(entry);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && isEditing) {
                          e.preventDefault();
                          handleUpdateSlots(entry);
                        }
                        if (e.key === "Escape") {
                          setEditingSlots((prev) => {
                            const next = { ...prev };
                            delete next[entry.id];
                            return next;
                          });
                        }
                      }}
                      className="h-8 w-16 text-center text-sm font-mono"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {(isEditing ? Number(editValue) : entry.slot_limit) === 1 ? "slot" : "slots"}
                    </span>
                  </div>

                  {/* Active toggle */}
                  <Switch
                    checked={entry.is_active}
                    onCheckedChange={() => handleToggleActive(entry)}
                    className="scale-75"
                    title={entry.is_active ? "Deactivate tier" : "Activate tier"}
                  />

                  {/* Remove entry */}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleRemoveEntry(entry.id)}
                    disabled={removeEntry.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add tier entry section */}
        <div className="space-y-2 border-t border-white/[0.06] pt-3">
          <Label className="text-xs text-muted-foreground">Add Tier</Label>
          <div className="space-y-2">
            <Combobox
              options={roleOptions}
              value={newRoleId}
              onValueChange={setNewRoleId}
              placeholder="Select role..."
              searchPlaceholder="Search roles..."
              emptyText="No roles available."
            />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={99}
                value={newSlotCount}
                onChange={(e) => setNewSlotCount(e.target.value)}
                placeholder="Slots"
                className="w-20"
              />
              <span className="text-xs text-muted-foreground">slots</span>
              <Button
                onClick={handleAddEntry}
                disabled={!newRoleId || addEntry.isPending}
                className="text-black font-semibold"
                style={{ background: "var(--accent-primary)" }}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </CardContent>

      {/* Delete category (not for default) */}
      {!category.is_default && (
        <CardFooter>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleteCategory.isPending}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete Category
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete &ldquo;{category.name}&rdquo;?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove this tier category and all its
                  entries. Panels using this category will need to be
                  reassigned.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={handleDeleteCategory}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardFooter>
      )}
    </Card>
    </>
  );
}
