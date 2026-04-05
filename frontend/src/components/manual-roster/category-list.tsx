"use client";

import { useState } from "react";
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

export default function CategoryListView({
  whitelist,
  onManage,
}: {
  whitelist: Whitelist;
  onManage: (cat: WhitelistCategory) => void;
}) {
  const { data: categories, isLoading } = useCategories(whitelist.id);
  const { data: groups } = useGroups();
  const createCategory = useCreateCategory(whitelist.id);
  const updateCategory = useUpdateCategory(whitelist.id);
  const deleteCategory = useDeleteCategory(whitelist.id);

  const [addOpen, setAddOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatSlotLimit, setNewCatSlotLimit] = useState("");
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editCatName, setEditCatName] = useState("");
  const [editCatSlotLimit, setEditCatSlotLimit] = useState("");

  function handleAddCategory() {
    if (!newCatName.trim()) return;
    createCategory.mutate(
      { name: newCatName.trim(), slot_limit: newCatSlotLimit ? parseInt(newCatSlotLimit, 10) : null },
      {
        onSuccess: () => {
          toast.success("Category created");
          setNewCatName("");
          setNewCatSlotLimit("");
          setAddOpen(false);
        },
        onError: () => toast.error("Failed to create category"),
      }
    );
  }

  function startEdit(cat: WhitelistCategory) {
    setEditingCatId(cat.id);
    setEditCatName(cat.name);
    setEditCatSlotLimit(cat.slot_limit != null ? String(cat.slot_limit) : "");
  }

  function handleSaveCat(cat: WhitelistCategory) {
    updateCategory.mutate(
      {
        id: cat.id,
        name: editCatName.trim() || cat.name,
        slot_limit: editCatSlotLimit ? parseInt(editCatSlotLimit, 10) : null,
      },
      {
        onSuccess: () => {
          toast.success("Category updated");
          setEditingCatId(null);
        },
        onError: () => toast.error("Failed to update category"),
      }
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
      </div>
    );
  }

  // Compute aggregate stats across all categories
  const totalEntries  = categories?.reduce((s, c) => s + c.user_count, 0) ?? 0;
  const totalCapacity = categories?.reduce((s, c) => s + (c.slot_limit ?? 0), 0) ?? 0;
  const numCats       = categories?.length ?? 0;
  const nearlFull     = categories?.filter(c => c.slot_limit != null && c.user_count / c.slot_limit >= 0.8).length ?? 0;

  return (
    <div className="space-y-3">
      {/* Stats */}
      {categories && categories.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Categories", value: numCats, color: "text-white/80" },
            { label: "Total Entries", value: totalEntries, color: "text-white/80" },
            { label: "Capacity", value: totalCapacity > 0 ? `${totalEntries}/${totalCapacity}` : "\u2014", color: totalCapacity > 0 && totalEntries >= totalCapacity ? "text-red-400" : "text-white/80" },
            { label: "Near Full", value: nearlFull, color: nearlFull > 0 ? "text-amber-400" : "text-white/80" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-3 py-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">{label}</span>
              <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {whitelist.name} — Categories
        </h2>
        {!addOpen && (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Category
          </Button>
        )}
      </div>

      {!categories || categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-12 text-center">
          <p className="text-sm font-medium">No categories yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a category to start building this roster.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            <Card key={cat.id} className="overflow-hidden">
              <CardContent className="flex items-center gap-3 px-4 py-3">
                {editingCatId === cat.id ? (
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Input
                      value={editCatName}
                      onChange={(e) => setEditCatName(e.target.value)}
                      className="h-7 text-sm flex-1 min-w-0"
                      autoFocus
                    />
                    <Input
                      type="number"
                      min={1}
                      value={editCatSlotLimit}
                      onChange={(e) => setEditCatSlotLimit(e.target.value)}
                      className="h-7 text-xs w-20 shrink-0"
                      placeholder="slots"
                    />
                    <Button size="xs" className="shrink-0 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => handleSaveCat(cat)}>
                      <Check className="h-3 w-3" />
                      Save
                    </Button>
                    <Button size="xs" variant="outline" className="shrink-0" onClick={() => setEditingCatId(null)}>
                      <X className="h-3 w-3" />
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cat.name}</p>
                      {cat.slot_limit != null ? (
                        <div className="mt-1 flex items-center gap-2">
                          {(() => {
                            const pct = Math.min((cat.user_count / cat.slot_limit) * 100, 100);
                            const isOver = cat.user_count > cat.slot_limit;
                            const barColor = isOver ? "#F87171" : "var(--accent-primary)";
                            return (
                              <>
                                <span className={`text-[11px] tabular-nums ${isOver ? "text-red-400" : "text-muted-foreground"}`}>
                                  {cat.user_count}/{cat.slot_limit}
                                </span>
                                <div className="relative h-[3px] w-16 overflow-hidden rounded-full bg-white/10">
                                  <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">{cat.user_count} entries</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {cat.manager_count > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
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
                        <SelectTrigger className="h-7 w-32 text-xs">
                          <SelectValue placeholder="No group" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">No group</SelectItem>
                          {(groups ?? []).map((g) => (
                            <SelectItem key={g.group_name} value={g.group_name}>
                              {g.group_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button size="icon-xs" variant="outline" className="text-muted-foreground hover:text-foreground hover:border-foreground/30" onClick={() => startEdit(cat)} title="Edit">
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger render={
                          <Button size="icon-xs" variant="outline" className="text-destructive hover:text-destructive hover:border-destructive/30" title="Delete" />
                        }>
                          <Trash2 className="h-3.5 w-3.5" />
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
                        className="h-7 px-3 text-xs"
                        onClick={() => onManage(cat)}
                      >
                        Manage
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add category form */}
      {addOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">New Category</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="e.g. [SquadName]"
                onKeyDown={(e) => e.key === "Enter" && handleAddCategory()}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Slot Limit <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="number"
                min={1}
                value={newCatSlotLimit}
                onChange={(e) => setNewCatSlotLimit(e.target.value)}
                placeholder="Leave blank for unlimited"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddCategory}
                disabled={createCategory.isPending || !newCatName.trim()}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setAddOpen(false); setNewCatName(""); setNewCatSlotLimit(""); }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
