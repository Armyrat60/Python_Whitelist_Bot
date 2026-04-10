"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Search,
} from "lucide-react";
import {
  useGroups,
  useCategories,
  useCreateCategory,
  useDeleteCategory,
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
    cats.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return cats;
  }, [categoryQueries.map((q) => q.query.data)]);

  // Search
  const [searchInput, setSearchInput] = useState("");
  const filteredCategories = useMemo(() => {
    if (!searchInput.trim()) return allCategories;
    const q = searchInput.toLowerCase();
    return allCategories.filter((c) => c.name.toLowerCase().includes(q));
  }, [allCategories, searchInput]);

  // Add state
  const [addOpen, setAddOpen] = useState(false);
  const [addToWhitelistId, setAddToWhitelistId] = useState<number | null>(whitelists[0]?.id ?? null);

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

      {/* Category list */}
      {filteredCategories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-12 text-center">
          <p className="text-sm font-medium">{searchInput ? "No matching categories" : "No categories yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {searchInput ? "Try a different search term." : "Add a category to start building your roster."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredCategories.map((cat) => (
            <CategoryCard
              key={cat.id}
              cat={cat}
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
          onCreated={() => setAddOpen(false)}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Category Card (simplified) ──────────────────────────────────────────────

function CategoryCard({
  cat,
  onManage,
}: {
  cat: CategoryWithWhitelist;
  onManage: () => void;
}) {
  const deleteCategory = useDeleteCategory(cat.whitelist_id);

  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 px-5 py-4">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onManage}>
          <p className="text-base font-medium truncate">{cat.name}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{cat.user_count} entries</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
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
