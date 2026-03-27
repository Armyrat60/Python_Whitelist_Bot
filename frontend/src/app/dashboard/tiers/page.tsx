"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Check, Crown, X, GripVertical } from "lucide-react";
import {
  useTierCategories,
  useCreateTierCategory,
  useUpdateTierCategory,
  useDeleteTierCategory,
  useAddTierEntry,
  useUpdateTierEntry,
  useRemoveTierEntry,
  useRoles,
} from "@/hooks/use-settings";
import type { TierCategory, TierEntry } from "@/lib/types";

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

  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(category.name);
  const [newRoleId, setNewRoleId] = useState("");
  const [newSlotCount, setNewSlotCount] = useState("1");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [editingSlots, setEditingSlots] = useState<Record<number, string>>({});

  // Sort entries by sort_order then slot_limit
  const sortedEntries = useMemo(
    () =>
      [...category.entries].sort(
        (a, b) => a.sort_order - b.sort_order || a.slot_limit - b.slot_limit
      ),
    [category.entries]
  );

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
        },
        onError: () => toast.error("Failed to add tier entry"),
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
    <Card>
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
                  className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2"
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
  );
}
