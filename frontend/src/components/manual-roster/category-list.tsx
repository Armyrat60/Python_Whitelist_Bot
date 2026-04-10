"use client";

import { useState, useMemo, useCallback } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Search,
  GripVertical,
  Copy,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  useCloneCategory,
} from "@/hooks/use-settings";
import type { Whitelist, WhitelistCategory } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";

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
  const categoryQueries = whitelists.map((wl) => ({
    wl,
    query: useCategories(wl.id),
  }));

  const isLoading = categoryQueries.some((q) => q.query.isLoading);

  const allCategories: CategoryWithWhitelist[] = useMemo(() => {
    const cats: CategoryWithWhitelist[] = [];
    for (const { wl, query } of categoryQueries) {
      if (!query.data) continue;
      for (const cat of query.data) {
        cats.push({ ...cat, whitelist_name: wl.name, whitelist_slug: wl.slug });
      }
    }
    // Sort by sort_order first, then alphabetically as fallback
    cats.sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
    return cats;
  }, [categoryQueries.map((q) => q.query.data)]);

  // All unique tags across categories
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const cat of allCategories) {
      if (cat.tags) {
        for (const tag of cat.tags.split(",").map(t => t.trim()).filter(Boolean)) {
          tagSet.add(tag);
        }
      }
    }
    return [...tagSet].sort();
  }, [allCategories]);

  // Search + tag filter
  const [searchInput, setSearchInput] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());

  const filteredCategories = useMemo(() => {
    let cats = allCategories;
    if (searchInput.trim()) {
      const q = searchInput.toLowerCase();
      cats = cats.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (activeTags.size > 0) {
      cats = cats.filter((c) => {
        if (!c.tags) return false;
        const catTags = new Set(c.tags.split(",").map(t => t.trim()));
        for (const tag of activeTags) {
          if (!catTags.has(tag)) return false;
        }
        return true;
      });
    }
    return cats;
  }, [allCategories, searchInput, activeTags]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags(prev => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  // Add state
  const [addOpen, setAddOpen] = useState(false);

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // We need an update mutation for reorder — use the first whitelist
  const defaultWlId = whitelists[0]?.id ?? 0;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = filteredCategories.findIndex(c => c.id === active.id);
    const newIndex = filteredCategories.findIndex(c => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Update sort_order for moved category
    const movedCat = filteredCategories[oldIndex];
    const targetCat = filteredCategories[newIndex];
    const newSortOrder = targetCat.sort_order;

    // Find the right whitelist's update mutation
    const wl = whitelists.find(w => w.id === movedCat.whitelist_id);
    if (!wl) return;

    // Simple approach: set moved cat to target's sort_order, shift others
    const updates: { id: number; sort_order: number; whitelist_id: number }[] = [];
    const reordered = [...filteredCategories];
    const [removed] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, removed);

    reordered.forEach((cat, idx) => {
      if (cat.sort_order !== idx) {
        updates.push({ id: cat.id, sort_order: idx, whitelist_id: cat.whitelist_id });
      }
    });

    // Fire updates (fire and forget, queries will refresh)
    for (const upd of updates) {
      const wlId = upd.whitelist_id;
      fetch(`/api/admin/whitelists/${wlId}/categories/${upd.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sort_order: upd.sort_order }),
      });
    }

    // Optimistically reorder in the UI by invalidating queries after a short delay
    setTimeout(() => {
      for (const { wl } of categoryQueries) {
        if (wl) categoryQueries.find(q => q.wl.id === wl.id)?.query.refetch();
      }
    }, 300);
  }

  // Stats
  const totalEntries = allCategories.reduce((s, c) => s + c.user_count, 0);
  const numCats = allCategories.length;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats + Search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <div className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-2.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Categories</span>
            <span className="text-lg font-semibold tabular-nums">{numCats}</span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-2.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Total Entries</span>
            <span className="text-lg font-semibold tabular-nums">{totalEntries}</span>
          </div>
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search categories..."
            className="pl-9 h-9 text-sm"
          />
        </div>
        {!addOpen && (
          <Button variant="outline" size="sm" className="h-9 text-sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Category
          </Button>
        )}
      </div>

      {/* Tag filter pills */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                activeTags.has(tag)
                  ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/40"
                  : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.08] hover:text-white"
              )}
            >
              {tag}
            </button>
          ))}
          {activeTags.size > 0 && (
            <button
              className="text-xs text-muted-foreground hover:text-white px-2"
              onClick={() => setActiveTags(new Set())}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Category list with drag-and-drop */}
      {filteredCategories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-12 text-center">
          <p className="text-sm font-medium">{searchInput || activeTags.size > 0 ? "No matching categories" : "No categories yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {searchInput || activeTags.size > 0 ? "Try a different search or filter." : "Add a category to start building your roster."}
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filteredCategories.map(c => c.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {filteredCategories.map((cat) => (
                <SortableCategoryCard
                  key={cat.id}
                  cat={cat}
                  whitelists={whitelists}
                  onManage={() => {
                    const wl = whitelists.find((w) => w.id === cat.whitelist_id);
                    if (wl) onManage(cat, wl);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Add category form */}
      {addOpen && (
        <AddCategoryForm
          whitelists={whitelists}
          defaultWhitelistId={whitelists[0]?.id ?? 0}
          onCreated={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Sortable Category Card ──────────────────────────────────────────────────

function SortableCategoryCard({
  cat,
  whitelists,
  onManage,
}: {
  cat: CategoryWithWhitelist;
  whitelists: Whitelist[];
  onManage: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cat.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const deleteCategory = useDeleteCategory(cat.whitelist_id);
  const cloneCategory = useCloneCategory(cat.whitelist_id);

  return (
    <div ref={setNodeRef} style={style}>
      <Card className="overflow-hidden">
        <CardContent className="flex items-center gap-3 px-4 py-4">
          {/* Drag handle */}
          <button
            className="shrink-0 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-5 w-5" />
          </button>

          {/* Name + count */}
          <div className="flex-1 min-w-0 cursor-pointer" onClick={onManage}>
            <div className="flex items-center gap-2">
              <p className="text-base font-medium truncate">{cat.name}</p>
              {cat.tags && (
                <div className="flex gap-1 shrink-0">
                  {cat.tags.split(",").slice(0, 3).map(t => t.trim()).filter(Boolean).map(tag => (
                    <span key={tag} className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-400">{tag}</span>
                  ))}
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{cat.user_count} entries</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-9 p-0"
              title="Clone category"
              onClick={() => {
                cloneCategory.mutate(cat.id, {
                  onSuccess: (res) => toast.success(`Cloned as "${res.name}"`),
                  onError: () => toast.error("Failed to clone"),
                });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger render={
                <Button size="sm" variant="outline" className="h-9 w-9 p-0 text-destructive hover:text-destructive hover:border-destructive/30" title="Delete category" />
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
        </CardContent>
      </Card>
    </div>
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
