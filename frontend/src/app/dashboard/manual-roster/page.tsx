"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Search,
  ExternalLink,
} from "lucide-react";
import {
  useWhitelists,
  useCategories,
  useCreateCategory,
  useUpdateCategory,
  useDeleteCategory,
  useCategoryManagers,
  useAddCategoryManager,
  useRemoveCategoryManager,
  useCategoryEntries,
  useAddCategoryEntry,
  useRemoveCategoryEntry,
} from "@/hooks/use-settings";
import { useGuild } from "@/hooks/use-guild";
import type { Whitelist, WhitelistCategory, CategoryEntry } from "@/lib/types";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { Separator } from "@/components/ui/separator";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "2-digit",
  });
}

function isExpiredOrSoon(dateStr: string | null | undefined): boolean {
  if (!dateStr) return false;
  const exp = new Date(dateStr);
  const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return exp <= soon;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ManualRosterPage() {
  const { activeGuild } = useGuild();
  const { data: whitelists, isLoading: wlLoading } = useWhitelists();

  const manualWhitelists = useMemo(
    () => whitelists?.filter((wl) => wl.is_manual) ?? [],
    [whitelists]
  );

  const [selectedWhitelistId, setSelectedWhitelistId] = useState<number | null>(null);
  const [view, setView] = useState<"categories" | "entries">("categories");
  const [selectedCat, setSelectedCat] = useState<WhitelistCategory | null>(null);
  const [entryPage, setEntryPage] = useState(1);
  const [entrySearchInput, setEntrySearchInput] = useState("");
  const [entrySearch, setEntrySearch] = useState("");

  // Auto-select first manual whitelist on load
  useEffect(() => {
    if (manualWhitelists.length > 0 && selectedWhitelistId === null) {
      setSelectedWhitelistId(manualWhitelists[0].id);
    }
  }, [manualWhitelists, selectedWhitelistId]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setEntrySearch(entrySearchInput), 300);
    return () => clearTimeout(t);
  }, [entrySearchInput]);

  // Reset entry page when search or category changes
  useEffect(() => { setEntryPage(1); }, [entrySearch, selectedCat?.id]);

  const selectedWhitelist = manualWhitelists.find((wl) => wl.id === selectedWhitelistId) ?? null;

  if (wlLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <div className="space-y-3 mt-6">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Page Header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-semibold">Manual Roster</h1>
        {activeGuild && (
          <p className="text-sm text-muted-foreground">Managing {activeGuild.name}</p>
        )}
      </div>

      {/* ─── Empty state ─────────────────────────────────────────────────── */}
      {manualWhitelists.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
          <p className="text-sm font-medium">No manual rosters configured</p>
          <p className="mt-1 text-xs text-muted-foreground mb-4">
            Go to Whitelists to create one.
          </p>
          <Link href="/dashboard/whitelists" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Go to Whitelists
          </Link>
        </div>
      ) : (
        <>
          {/* ─── Whitelist selector (if multiple) ──────────────────────── */}
          {manualWhitelists.length > 1 && (
            <div className="flex items-center gap-3">
              <Label className="text-sm shrink-0">Roster</Label>
              <Select
                value={selectedWhitelistId !== null ? String(selectedWhitelistId) : ""}
                onValueChange={(val) => {
                  setSelectedWhitelistId(Number(val));
                  setView("categories");
                  setSelectedCat(null);
                }}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select roster" />
                </SelectTrigger>
                <SelectContent>
                  {manualWhitelists.map((wl) => (
                    <SelectItem key={wl.id} value={String(wl.id)}>
                      {wl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ─── Content ───────────────────────────────────────────────── */}
          {selectedWhitelist && (
            <RosterContent
              whitelist={selectedWhitelist}
              view={view}
              setView={setView}
              selectedCat={selectedCat}
              setSelectedCat={setSelectedCat}
              entryPage={entryPage}
              setEntryPage={setEntryPage}
              entrySearchInput={entrySearchInput}
              setEntrySearchInput={setEntrySearchInput}
              entrySearch={entrySearch}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── RosterContent ────────────────────────────────────────────────────────────

function RosterContent({
  whitelist,
  view,
  setView,
  selectedCat,
  setSelectedCat,
  entryPage,
  setEntryPage,
  entrySearchInput,
  setEntrySearchInput,
  entrySearch,
}: {
  whitelist: Whitelist;
  view: "categories" | "entries";
  setView: (v: "categories" | "entries") => void;
  selectedCat: WhitelistCategory | null;
  setSelectedCat: (c: WhitelistCategory | null) => void;
  entryPage: number;
  setEntryPage: (p: number) => void;
  entrySearchInput: string;
  setEntrySearchInput: (s: string) => void;
  entrySearch: string;
}) {
  if (view === "categories") {
    return (
      <CategoryListView
        whitelist={whitelist}
        onManage={(cat) => {
          setSelectedCat(cat);
          setView("entries");
        }}
      />
    );
  }

  return (
    <EntryView
      whitelist={whitelist}
      category={selectedCat!}
      entryPage={entryPage}
      setEntryPage={setEntryPage}
      searchInput={entrySearchInput}
      setSearchInput={setEntrySearchInput}
      search={entrySearch}
      onBack={() => {
        setView("categories");
        setSelectedCat(null);
        setEntrySearchInput("");
        setEntryPage(1);
      }}
    />
  );
}

// ─── CategoryListView ─────────────────────────────────────────────────────────

function CategoryListView({
  whitelist,
  onManage,
}: {
  whitelist: Whitelist;
  onManage: (cat: WhitelistCategory) => void;
}) {
  const { data: categories, isLoading } = useCategories(whitelist.id);
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

  return (
    <div className="space-y-3">
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
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => handleSaveCat(cat)}>
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" onClick={() => setEditingCatId(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{cat.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {cat.slot_limit != null
                          ? `${cat.user_count} / ${cat.slot_limit} slots`
                          : `${cat.user_count} entries`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {cat.manager_count > 0 && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {cat.manager_count} mgr
                        </Badge>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => startEdit(cat)} title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger render={
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete" />
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

// ─── EntryView ────────────────────────────────────────────────────────────────

function EntryView({
  whitelist,
  category,
  entryPage,
  setEntryPage,
  searchInput,
  setSearchInput,
  search,
  onBack,
}: {
  whitelist: Whitelist;
  category: WhitelistCategory;
  entryPage: number;
  setEntryPage: (p: number) => void;
  searchInput: string;
  setSearchInput: (s: string) => void;
  search: string;
  onBack: () => void;
}) {
  const { data: entriesData, isLoading: entriesLoading } = useCategoryEntries(
    whitelist.id,
    category.id,
    entryPage,
    search || undefined
  );
  const addEntry    = useAddCategoryEntry(whitelist.id, category.id);
  const removeEntry = useRemoveCategoryEntry(whitelist.id, category.id);

  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [steamId, setSteamId]         = useState("");
  const [discordId, setDiscordId]     = useState("");
  const [discordName, setDiscordName] = useState("");
  const [entryNotes, setEntryNotes]   = useState("");
  const [entryExpiry, setEntryExpiry] = useState("");

  const entryTotalPages = entriesData ? Math.ceil(entriesData.total / entriesData.per_page) : 0;

  function handleAddEntry() {
    if (!steamId.trim()) return;
    addEntry.mutate(
      {
        steam_id:     steamId.trim(),
        discord_id:   discordId.trim() || undefined,
        discord_name: discordName.trim() || undefined,
        notes:        entryNotes.trim() || undefined,
        expires_at:   entryExpiry || null,
      },
      {
        onSuccess: () => {
          toast.success("Entry added");
          setSteamId(""); setDiscordId(""); setDiscordName(""); setEntryNotes(""); setEntryExpiry("");
          setAddEntryOpen(false);
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Failed to add entry";
          toast.error(msg.includes("full") ? "Category is full" : "Failed to add entry");
        },
      }
    );
  }

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-base font-semibold truncate">{category.name}</h2>
          <p className="text-xs text-muted-foreground">
            {category.slot_limit != null
              ? `${entriesData?.total ?? category.user_count} / ${category.slot_limit} slots`
              : `${entriesData?.total ?? category.user_count ?? 0} entries`}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search by name or Steam ID…"
          className="pl-8 h-8 text-xs"
        />
      </div>

      {/* Entry list */}
      {entriesLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !entriesData || entriesData.entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-10 text-center">
          <p className="text-sm font-medium">No entries yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Add a member below to get started.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] overflow-hidden divide-y divide-white/[0.04]">
          {entriesData.entries.map((entry) => (
            <EntryRow
              key={entry.discord_id}
              entry={entry}
              onRemove={() =>
                removeEntry.mutate(entry.discord_id, {
                  onSuccess: () => toast.success("Entry removed"),
                  onError:   () => toast.error("Failed to remove entry"),
                })
              }
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {entryTotalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setEntryPage(Math.max(1, entryPage - 1))}
            disabled={entryPage <= 1}
          >
            <ChevronLeft className="mr-1 h-3.5 w-3.5" />
            Prev
          </Button>
          <span>Page {entryPage} of {entryTotalPages}</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-7"
            onClick={() => setEntryPage(Math.min(entryTotalPages, entryPage + 1))}
            disabled={entryPage >= entryTotalPages}
          >
            Next
            <ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Add entry */}
      {addEntryOpen ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Add Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Steam ID <span className="text-red-400">*</span></Label>
              <Input
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
                placeholder="76561198..."
                className="font-mono text-xs"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Discord ID <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                placeholder="123456789012345678"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Discord Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={discordName}
                onChange={(e) => setDiscordName(e.target.value)}
                placeholder="Username"
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={entryNotes}
                onChange={(e) => setEntryNotes(e.target.value)}
                placeholder="Internal note"
                className="text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Expiry Date <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="date"
                value={entryExpiry}
                onChange={(e) => setEntryExpiry(e.target.value)}
                className="text-xs"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAddEntry}
                disabled={addEntry.isPending || !steamId.trim()}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAddEntryOpen(false);
                  setSteamId(""); setDiscordId(""); setDiscordName(""); setEntryNotes(""); setEntryExpiry("");
                }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setAddEntryOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add Entry
        </Button>
      )}

      {/* ─── Managers sub-section ──────────────────────────────────────── */}
      <Separator className="bg-white/[0.06]" />
      <ManagersSection whitelistId={whitelist.id} categoryId={category.id} />
    </div>
  );
}

// ─── EntryRow ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, onRemove }: { entry: CategoryEntry; onRemove: () => void }) {
  const steamId    = entry.steam_ids?.[0] ?? "—";
  const noDiscord  = entry.discord_name === "[No Discord]" || entry.created_via === "manual_steam_only";
  const expiredSoon = isExpiredOrSoon(entry.expires_at);

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.01] hover:bg-white/[0.03] text-xs">
      <div className="flex-1 min-w-0 space-y-0.5">
        <div>
          {noDiscord ? (
            <span className="italic text-muted-foreground/60">No Discord</span>
          ) : (
            <span className="flex items-center gap-1">
              <span className="font-medium truncate">{entry.discord_name}</span>
              <Link
                href={`/dashboard/players/${entry.discord_id}`}
                className="shrink-0 text-muted-foreground/40 hover:text-white/60 transition-colors"
                title="View profile"
              >
                <ExternalLink className="h-3 w-3" />
              </Link>
            </span>
          )}
        </div>
        <div className="font-mono text-[10px] text-muted-foreground/60 truncate">{steamId}</div>
      </div>
      <div className="shrink-0 text-right space-y-0.5 text-[10px] text-muted-foreground">
        <div>{formatDate(entry.created_at)}</div>
        {entry.expires_at && (
          <div className={expiredSoon ? "text-red-400" : ""}>
            exp {formatDate(entry.expires_at)}
          </div>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger render={
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0" />
        }>
          <Trash2 className="h-3.5 w-3.5" />
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove {noDiscord ? steamId : entry.discord_name} from this category? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── ManagersSection ──────────────────────────────────────────────────────────

function ManagersSection({ whitelistId, categoryId }: { whitelistId: number; categoryId: number }) {
  const { data: managers, isLoading } = useCategoryManagers(whitelistId, categoryId);
  const addManager    = useAddCategoryManager(whitelistId, categoryId);
  const removeManager = useRemoveCategoryManager(whitelistId, categoryId);

  const [addOpen, setAddOpen]         = useState(false);
  const [mgrName, setMgrName]         = useState("");
  const [mgrDiscordId, setMgrDiscordId] = useState("");

  function handleAddManager() {
    if (!mgrName.trim() || !mgrDiscordId.trim()) return;
    addManager.mutate(
      { discord_name: mgrName.trim(), discord_id: mgrDiscordId.trim() },
      {
        onSuccess: () => {
          toast.success("Manager added");
          setMgrName(""); setMgrDiscordId(""); setAddOpen(false);
        },
        onError: () => toast.error("Failed to add manager"),
      }
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Managers</p>
        {!addOpen && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3 w-3" />
            Add Manager
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : !managers || managers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No managers assigned.</p>
      ) : (
        <div className="space-y-1">
          {managers.map((mgr) => (
            <div
              key={mgr.discord_id}
              className="flex items-center gap-2 rounded-lg px-3 py-2 bg-white/[0.02] text-xs"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate">{mgr.discord_name}</span>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">{mgr.discord_id}</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger render={
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0" />
                }>
                  <Trash2 className="h-3 w-3" />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove manager?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Remove {mgr.discord_name} as a manager of this category?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() =>
                      removeManager.mutate(mgr.discord_id, {
                        onSuccess: () => toast.success("Manager removed"),
                        onError:   () => toast.error("Failed to remove manager"),
                      })
                    }>Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <div className="rounded-lg border border-white/[0.08] p-3 space-y-2">
          <p className="text-xs font-medium">Add Manager</p>
          <div className="space-y-1.5">
            <Label className="text-xs">Discord Name</Label>
            <Input
              value={mgrName}
              onChange={(e) => setMgrName(e.target.value)}
              placeholder="Username"
              className="text-xs"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Discord ID</Label>
            <Input
              value={mgrDiscordId}
              onChange={(e) => setMgrDiscordId(e.target.value)}
              placeholder="123456789012345678"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAddManager}
              disabled={addManager.isPending || !mgrName.trim() || !mgrDiscordId.trim()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setAddOpen(false); setMgrName(""); setMgrDiscordId(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
