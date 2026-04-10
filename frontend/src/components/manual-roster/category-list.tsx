"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react";
import {
  useGroups,
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
} from "@/hooks/use-settings";
import type { Whitelist, WhitelistCategory } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
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

// ─── Types ───────────────────────────────────────────────────────────────────

interface CategoryWithWhitelist extends WhitelistCategory {
  whitelist_name: string;
  whitelist_slug: string;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CategoryListView({
  whitelists,
  onManage,
}: {
  whitelists: Whitelist[];
  onManage: (cat: WhitelistCategory, wl: Whitelist) => void;
}) {
  const { data: groups } = useGroups();

  // Fetch categories for all manual whitelists
  const categoryQueries = whitelists.map((wl) => ({
    wl,
    query: useCategories(wl.id),
  }));

  const isLoading = categoryQueries.some((q) => q.query.isLoading);

  // Merge all categories into one flat list with whitelist info
  const allCategories: CategoryWithWhitelist[] = useMemo(() => {
    const cats: CategoryWithWhitelist[] = [];
    for (const { wl, query } of categoryQueries) {
      if (!query.data) continue;
      for (const cat of query.data) {
        cats.push({
          ...cat,
          whitelist_name: wl.name,
          whitelist_slug: wl.slug,
        });
      }
    }
    // Sort alphabetically by category name
    cats.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return cats;
  }, [categoryQueries.map((q) => q.query.data)]);

  // Edit state
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatSlotLimit, setEditCatSlotLimit] = useState("");
  const [editCatWhitelistId, setEditCatWhitelistId] = useState<number | null>(null);

  // Add state
  const [addOpen, setAddOpen] = useState(false);
  const [addToWhitelistId, setAddToWhitelistId] = useState<number | null>(whitelists[0]?.id ?? null);

  function startEdit(cat: CategoryWithWhitelist) {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatSlotLimit(cat.slot_limit != null ? String(cat.slot_limit) : "");
    setEditCatWhitelistId(cat.whitelist_id);
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  // Compute aggregate stats
  const totalEntries  = allCategories.reduce((s, c) => s + c.user_count, 0);
  const totalCapacity = allCategories.reduce((s, c) => s + (c.slot_limit ?? 0), 0);
  const numCats       = allCategories.length;
  const nearlyFull    = allCategories.filter(c => c.slot_limit != null && c.user_count / c.slot_limit >= 0.8).length;

  return (
    <div className="space-y-4">
      {/* Stats */}
      {allCategories.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Categories", value: numCats, color: "text-white/80" },
            { label: "Total Entries", value: totalEntries, color: "text-white/80" },
            { label: "Capacity", value: totalCapacity > 0 ? `${totalEntries}/${totalCapacity}` : "\u2014", color: totalCapacity > 0 && totalEntries >= totalCapacity ? "text-red-400" : "text-white/80" },
            { label: "Near Full", value: nearlyFull, color: nearlyFull > 0 ? "text-amber-400" : "text-white/80" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-3">
              <span className="text-xs uppercase tracking-wider text-muted-foreground/60">{label}</span>
              <span className={`text-xl font-semibold tabular-nums ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          All Categories
        </h2>
        {!addOpen && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Category
          </Button>
        )}
      </div>

      {allCategories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-12 text-center">
          <p className="text-sm font-medium">No categories yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a category to start building your roster.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {allCategories.map((cat) => (
            <CategoryCard
              key={cat.id}
              cat={cat}
              whitelists={whitelists}
              groups={groups ?? []}
              isEditing={editingCatId === cat.id}
              editCatName={editCatName}
              setEditCatName={setEditCatName}
              editCatSlotLimit={editCatSlotLimit}
              setEditCatSlotLimit={setEditCatSlotLimit}
              editCatWhitelistId={editCatWhitelistId}
              setEditCatWhitelistId={setEditCatWhitelistId}
              onStartEdit={() => startEdit(cat)}
              onCancelEdit={() => setEditingCatId(null)}
              onManage={() => {
                const wl = whitelists.find((w) => w.id === cat.whitelist_id);
                if (wl) onManage(cat, wl);
              }}
            />
          ))}
        </div>
      )}

      {/* Add category form */}
      {addOpen && (
        <AddCategoryForm
          whitelists={whitelists}
          defaultWhitelistId={addToWhitelistId ?? whitelists[0]?.id ?? 0}
          onCreated={() => { setAddOpen(false); }}
          onCancel={() => { setAddOpen(false); }}
        />
      )}
    </div>
  );
}

// ─── Category Card ───────────────────────────────────────────────────────────

function CategoryCard({
  cat,
  whitelists,
  groups,
  isEditing,
  editCatName,
  setEditCatName,
  editCatSlotLimit,
  setEditCatSlotLimit,
  editCatWhitelistId,
  setEditCatWhitelistId,
  onStartEdit,
  onCancelEdit,
  onManage,
}: {
  cat: CategoryWithWhitelist;
  whitelists: Whitelist[];
  groups: { group_name: string }[];
  isEditing: boolean;
  editCatName: string;
  setEditCatName: (v: string) => void;
  editCatSlotLimit: string;
  setEditCatSlotLimit: (v: string) => void;
  editCatWhitelistId: number | null;
  setEditCatWhitelistId: (v: number | null) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onManage: () => void;
}) {
  const updateCategory = useUpdateCategory(cat.whitelist_id);
  const deleteCategory = useDeleteCategory(cat.whitelist_id);

  function handleSave() {
    updateCategory.mutate(
      {
        id: cat.id,
        name: editCatName.trim() || cat.name,
        slot_limit: editCatSlotLimit ? parseInt(editCatSlotLimit, 10) : null,
        ...(editCatWhitelistId && editCatWhitelistId !== cat.whitelist_id ? { whitelist_id: editCatWhitelistId } : {}),
      },
      {
        onSuccess: () => {
          toast.success("Category updated");
          onCancelEdit();
        },
        onError: () => toast.error("Failed to update category"),
      }
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 px-5 py-4">
        {isEditing ? (
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
                className="h-9 text-sm w-48"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Max Entries</Label>
              <Input
                type="number"
                min={1}
                value={editCatSlotLimit}
                onChange={(e) => setEditCatSlotLimit(e.target.value)}
                className="h-9 text-sm w-24"
                placeholder="No limit"
              />
            </div>
            {whitelists.length > 1 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Whitelist</Label>
                <Select
                  value={editCatWhitelistId != null ? String(editCatWhitelistId) : ""}
                  onValueChange={(val) => setEditCatWhitelistId(Number(val))}
                >
                  <SelectTrigger className="h-9 w-40 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {whitelists.map((wl) => (
                      <SelectItem key={wl.id} value={String(wl.id)}>
                        {wl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-end gap-2 pb-0.5">
              <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={handleSave}>
                <Check className="mr-1 h-3.5 w-3.5" />
                Save
              </Button>
              <Button size="sm" variant="outline" onClick={onCancelEdit}>
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-base font-medium truncate">{cat.name}</p>
              <p className="text-sm text-muted-foreground mt-0.5">{cat.user_count} entries</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {cat.manager_count > 0 && (
                <Badge variant="outline" className="text-xs px-2 py-0.5">
                  {cat.manager_count} mgr
                </Badge>
              )}
              <Select
                value={cat.squad_group ?? ""}
                onValueChange={(val) => {
                  updateCategory.mutate(
                    { id: cat.id, squad_group: val || null },
                    { onSuccess: () => toast.success("Group updated"), onError: () => toast.error("Failed to update group") }
                  );
                }}
              >
                <SelectTrigger className="h-9 w-36 text-sm">
                  <SelectValue placeholder="No group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No group</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.group_name} value={g.group_name}>
                      {g.group_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-9" onClick={onStartEdit} title="Edit category">
                <Pencil className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger render={
                  <Button size="sm" variant="outline" className="h-9 text-destructive hover:text-destructive hover:border-destructive/30" title="Delete category" />
                }>
                  <Trash2 className="h-4 w-4" />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {cat.name}?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Deleting this category removes all managers. Existing members will be unassigned (not deleted).
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() =>
                      deleteCategory.mutate(cat.id, {
                        onSuccess: () => toast.success("Category deleted"),
                        onError:   () => toast.error("Failed to delete category"),
                      })
                    }>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button
                size="sm"
                variant="outline"
                className="h-9 px-4 text-sm"
                onClick={onManage}
              >
                Manage
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Add Category Form ───────────────────────────────────────────────────────

function AddCategoryForm({
  whitelists,
  defaultWhitelistId,
  onCreated,
  onCancel,
}: {
  whitelists: Whitelist[];
  defaultWhitelistId: number;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slotLimit, setSlotLimit] = useState("");
  const [whitelistId, setWhitelistId] = useState(defaultWhitelistId);

  const createCategory = useCreateCategory(whitelistId);

  function handleAdd() {
    if (!name.trim()) return;
    createCategory.mutate(
      { name: name.trim(), slot_limit: slotLimit ? parseInt(slotLimit, 10) : null },
      {
        onSuccess: () => {
          toast.success("Category created");
          onCreated();
        },
        onError: () => toast.error("Failed to create category"),
      }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">New Category</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-sm">Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. DMH, S2C, AdHoc"
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Max Entries <span className="text-muted-foreground">(optional)</span></Label>
          <Input
            type="number"
            min={1}
            value={slotLimit}
            onChange={(e) => setSlotLimit(e.target.value)}
            placeholder="Leave blank for unlimited"
          />
          <p className="text-xs text-muted-foreground">Maximum number of entries allowed in this category</p>
        </div>
        {whitelists.length > 1 && (
          <div className="space-y-1.5">
            <Label className="text-sm">Whitelist</Label>
            <Select
              value={String(whitelistId)}
              onValueChange={(val) => setWhitelistId(Number(val))}
            >
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select whitelist" />
              </SelectTrigger>
              <SelectContent>
                {whitelists.map((wl) => (
                  <SelectItem key={wl.id} value={String(wl.id)}>
                    {wl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={handleAdd} disabled={createCategory.isPending || !name.trim()}>
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
