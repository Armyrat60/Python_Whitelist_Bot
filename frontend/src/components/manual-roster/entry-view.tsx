"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import {
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Search,
  ExternalLink,
  Upload,
  Download,
  AlertCircle,
  CheckCircle2,
  Pencil,
  Check,
  X,
  ArrowRightLeft,
} from "lucide-react";
import {
  useCategoryEntries,
  useAddCategoryEntry,
  useRemoveCategoryEntry,
  useImportCategoryEntries,
  useUpdateCategory,
  useGroups,
  useBulkDeleteEntries,
  useBulkMoveEntries,
  useCategories,
} from "@/hooks/use-settings";
import type { Whitelist, WhitelistCategory, CategoryEntry } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import ManagersSection from "./managers-section";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "\u2014";
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

// ─── EntryRow ─────────────────────────────────────────────────────────────────

function EntryRow({ entry, onRemove, selected, onToggle }: { entry: CategoryEntry; onRemove: () => void; selected?: boolean; onToggle?: () => void }) {
  const steamId    = entry.steam_ids?.[0] ?? "\u2014";
  const noDiscord  = entry.discord_name === "[No Discord]" || entry.created_via === "manual_steam_only";
  const expiredSoon = isExpiredOrSoon(entry.expires_at);

  return (
    <div className={cn("flex items-center gap-4 px-5 py-3 hover:bg-white/[0.03] text-sm", selected ? "bg-sky-500/5" : "bg-white/[0.01]")}>
      {onToggle && (
        <Checkbox checked={selected} onCheckedChange={onToggle} className="h-4 w-4 shrink-0" />
      )}
      <div className="flex-1 min-w-0 space-y-0.5">
        <div>
          {noDiscord ? (
            <span className="italic text-muted-foreground/60">No Discord</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="font-medium truncate">{entry.discord_name}</span>
              <Link
                href={`/dashboard/players/${entry.discord_id}`}
                className="shrink-0 text-muted-foreground/60 hover:text-white/80 transition-colors"
                title="View profile"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </span>
          )}
        </div>
        <div className="font-mono text-xs text-muted-foreground/60 truncate">{steamId}</div>
        {entry.notes && (
          <div className="text-xs text-muted-foreground/50 italic truncate">{entry.notes}</div>
        )}
      </div>
      <div className="shrink-0 text-right space-y-0.5 text-xs text-muted-foreground">
        <div>{formatDate(entry.created_at)}</div>
        {entry.expires_at && (
          <div className={expiredSoon ? "text-red-400" : ""}>
            exp {formatDate(entry.expires_at)}
          </div>
        )}
      </div>
      <AlertDialog>
        <AlertDialogTrigger render={
          <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:border-destructive/30 shrink-0" />
        }>
          <Trash2 className="h-4 w-4" />
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

// ─── EntryView ────────────────────────────────────────────────────────────────

export default function EntryView({
  whitelist,
  allWhitelists,
  category,
  entryPage,
  setEntryPage,
  searchInput,
  setSearchInput,
  search,
  onBack,
}: {
  whitelist: Whitelist;
  allWhitelists?: Whitelist[];
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
  const importEntries = useImportCategoryEntries(whitelist.id, category.id);
  const bulkDelete  = useBulkDeleteEntries(whitelist.id, category.id);
  const bulkMove    = useBulkMoveEntries(whitelist.id, category.id);
  const updateCategory = useUpdateCategory(whitelist.id);
  const { data: groups } = useGroups();
  const { data: allCats } = useCategories(whitelist.id);

  const [addEntryOpen, setAddEntryOpen] = useState(false);
  const [importOpen, setImportOpen]     = useState(false);
  const [csvText, setCsvText]           = useState("");
  const [importResult, setImportResult] = useState<{ added: number; updated: number; errors: { row: number; message: string }[] } | null>(null);
  const [steamId, setSteamId]         = useState("");
  const [discordId, setDiscordId]     = useState("");
  const [discordName, setDiscordName] = useState("");
  const [entryNotes, setEntryNotes]   = useState("");
  const [entryExpiry, setEntryExpiry] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<"all" | "active" | "expiring-soon" | "expired">("all");

  // Selection for bulk actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTargetCatId, setMoveTargetCatId] = useState<number | null>(null);
  const otherCategories = (allCats ?? []).filter(c => c.id !== category.id);

  // Category name editing
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState(category.name);

  // Inline settings
  const [tagInput, setTagInput] = useState("");
  const currentTags = (category.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);

  const now = new Date();
  const soonThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const filteredEntries = (entriesData?.entries ?? []).filter((e) => {
    if (expiryFilter === "all") return true;
    if (expiryFilter === "active") return !e.expires_at || new Date(e.expires_at) > now;
    if (expiryFilter === "expiring-soon") {
      if (!e.expires_at) return false;
      const exp = new Date(e.expires_at);
      return exp > now && exp <= soonThreshold;
    }
    if (expiryFilter === "expired") return !!e.expires_at && new Date(e.expires_at) <= now;
    return true;
  });

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

  function handleSaveName() {
    if (!editName.trim() || editName.trim() === category.name) {
      setEditingName(false);
      return;
    }
    updateCategory.mutate(
      { id: category.id, name: editName.trim() },
      {
        onSuccess: () => { toast.success("Name updated"); setEditingName(false); },
        onError: () => toast.error("Failed to update name"),
      }
    );
  }

  function saveField(data: Parameters<typeof updateCategory.mutate>[0]) {
    updateCategory.mutate(data, {
      onSuccess: () => toast.success("Updated"),
      onError: () => toast.error("Failed to update"),
    });
  }

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (!trimmed || currentTags.includes(trimmed)) return;
    const newTags = [...currentTags, trimmed].join(", ");
    saveField({ id: category.id, tags: newTags });
  }

  function removeTag(tag: string) {
    const newTags = currentTags.filter(t => t !== tag).join(", ") || null;
    saveField({ id: category.id, tags: newTags });
  }

  return (
    <div className="space-y-4">
      {/* Back + header with editable name */}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5 px-3 text-sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        {editingName ? (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-9 text-lg font-semibold flex-1"
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveName(); if (e.key === "Escape") { setEditingName(false); setEditName(category.name); } }}
              autoFocus
            />
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={handleSaveName}>
              <Check className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" className="h-9 w-9 p-0" onClick={() => { setEditingName(false); setEditName(category.name); }}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h2 className="text-lg font-semibold truncate">{category.name}</h2>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0 shrink-0 text-muted-foreground hover:text-white" onClick={() => setEditingName(true)} title="Rename category">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* ─── Stats + Inline Settings ─────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Entries (read-only) */}
        <div className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-2.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Entries</span>
          <span className="text-lg font-semibold tabular-nums">{entriesData?.total ?? category.user_count}</span>
        </div>
        {/* Max Entries (always shown, inline editable) */}
        <div className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-2.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Max Entries</span>
          <span className="text-lg font-semibold tabular-nums">{category.slot_limit ?? "Unlimited"}</span>
          <Input
            type="number"
            min={1}
            className="h-7 text-xs mt-1"
            placeholder="Set limit..."
            defaultValue={category.slot_limit ?? ""}
            onBlur={(e) => {
              const val = e.target.value.trim();
              const newLimit = val ? parseInt(val, 10) : null;
              if (newLimit !== category.slot_limit) {
                saveField({ id: category.id, slot_limit: newLimit });
              }
            }}
          />
        </div>
        {/* Squad Group (inline dropdown) */}
        <div className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-2.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Squad Group</span>
          <Select
            value={category.squad_group ?? ""}
            onValueChange={(val) => saveField({ id: category.id, squad_group: val || null })}
          >
            <SelectTrigger className="h-7 text-xs mt-1">
              <SelectValue placeholder="Default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">Default</SelectItem>
              {(groups ?? []).map((g) => (
                <SelectItem key={g.group_name} value={g.group_name}>{g.group_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Whitelist (only if >1 manual) */}
        {(allWhitelists?.filter(wl => wl.is_manual)?.length ?? 0) > 1 && (
          <div className="flex flex-col gap-0.5 rounded-xl border border-white/[0.10] bg-white/[0.02] px-4 py-2.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Whitelist</span>
            <Select
              value={String(whitelist.id)}
              onValueChange={(val) => {
                const newId = Number(val);
                if (newId !== whitelist.id) saveField({ id: category.id, whitelist_id: newId });
              }}
            >
              <SelectTrigger className="h-7 text-xs mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allWhitelists!.filter(wl => wl.is_manual).map((wl) => (
                  <SelectItem key={wl.id} value={String(wl.id)}>{wl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* ─── Tags (chip UI with tab-to-create) ───────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground/60 mr-1">Tags</span>
        {currentTags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 pl-2.5 pr-1 py-0.5 text-xs text-violet-400">
            {tag}
            <button
              className="rounded-full p-0.5 hover:bg-violet-500/20 transition-colors"
              onClick={() => removeTag(tag)}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Tab" || e.key === "Enter") && tagInput.trim()) {
              e.preventDefault();
              addTag(tagInput);
              setTagInput("");
            }
            if (e.key === "Backspace" && !tagInput && currentTags.length > 0) {
              removeTag(currentTags[currentTags.length - 1]);
            }
          }}
          placeholder={currentTags.length === 0 ? "Add tags..." : ""}
          className="h-7 w-32 text-xs border-none bg-transparent shadow-none focus-visible:ring-0 px-1"
        />
      </div>

      {/* ─── Actions bar (Add, Import, Export) ─────────────────────────── */}
      {!addEntryOpen && !importOpen && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-9 text-sm" onClick={() => setAddEntryOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add Entry
          </Button>
          <Button variant="outline" size="sm" className="h-9 text-sm" onClick={() => setImportOpen(true)}>
            <Upload className="mr-1.5 h-4 w-4" />
            Import CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 text-sm"
            onClick={() => {
              window.open(`/api/admin/whitelists/${whitelist.id}/categories/${category.id}/entries/export`, "_blank");
            }}
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export CSV
          </Button>
        </div>
      )}

      {/* ─── Add entry form ──────────────────────────────────────────── */}
      {addEntryOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Add Entry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm">Steam ID <span className="text-red-400">*</span></Label>
              <Input value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="76561198..." className="font-mono text-sm" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Discord ID <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder="123456789012345678" className="font-mono text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Discord Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={discordName} onChange={(e) => setDiscordName(e.target.value)} placeholder="Username" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={entryNotes} onChange={(e) => setEntryNotes(e.target.value)} placeholder="Internal note" className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Expiry Date <span className="text-muted-foreground">(optional)</span></Label>
              <Input type="date" value={entryExpiry} onChange={(e) => setEntryExpiry(e.target.value)} className="text-sm" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddEntry} disabled={addEntry.isPending || !steamId.trim()}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddEntryOpen(false); setSteamId(""); setDiscordId(""); setDiscordName(""); setEntryNotes(""); setEntryExpiry(""); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Import CSV form ─────────────────────────────────────────── */}
      {importOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Import CSV</CardTitle>
            <p className="text-sm text-muted-foreground">
              One row per entry. Columns: <code className="font-mono text-xs">steam_id, discord_id, discord_name, notes, expires_at</code>
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="w-full h-40 rounded-md border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-white/20"
              placeholder={"76561198000000001,123456789012345678,PlayerName,,2026-12-31\n76561198000000002,,,some note,"}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            {importResult && (
              <div className="space-y-1 text-sm">
                {(importResult.added + importResult.updated) > 0 && (
                  <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {importResult.added} added, {importResult.updated} updated
                  </div>
                )}
                {importResult.errors.length > 0 && (
                  <div className="space-y-0.5">
                    {importResult.errors.map((e) => (
                      <div key={e.row} className="flex items-start gap-1.5 text-red-400">
                        <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                        Row {e.row}: {e.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" disabled={importEntries.isPending || !csvText.trim()} onClick={() => {
                importEntries.mutate(csvText, {
                  onSuccess: (res) => {
                    setImportResult(res);
                    if (res.added + res.updated > 0) { toast.success(`Imported ${res.added + res.updated} entries`); setCsvText(""); }
                    if (res.errors.length > 0) toast.warning(`${res.errors.length} row(s) had errors`);
                  },
                  onError: () => toast.error("Import failed"),
                });
              }}>
                {importEntries.isPending ? "Importing\u2026" : "Import"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setImportOpen(false); setCsvText(""); setImportResult(null); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Managers section ─────────────────────────────────────────── */}
      <ManagersSection whitelistId={whitelist.id} categoryId={category.id} />

      <Separator className="bg-white/[0.06]" />

      {/* Search + expiry filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or Steam ID\u2026"
            className="pl-9 h-9 text-sm"
          />
        </div>
        <div className="flex rounded-md border border-border text-sm">
          {(["all", "active", "expiring-soon", "expired"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setExpiryFilter(f)}
              className={cn(
                "px-3 h-9 first:rounded-l-md last:rounded-r-md capitalize transition-colors",
                expiryFilter === f
                  ? "bg-white/[0.08] text-white"
                  : "text-muted-foreground hover:text-white/70"
              )}
            >
              {f === "expiring-soon" ? "Soon" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Bulk action bar ──────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <div className="h-4 w-px bg-white/10" />
          <AlertDialog>
            <AlertDialogTrigger render={
              <Button size="sm" variant="outline" className="h-8 text-sm text-red-400 hover:text-red-300" />
            }>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {selectedIds.size} entries?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently remove the selected entries. This cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => {
                  bulkDelete.mutate([...selectedIds], {
                    onSuccess: (res) => {
                      toast.success(`Deleted ${res.deleted} entries${res.unassigned > 0 ? `, unassigned ${res.unassigned}` : ""}`);
                      setSelectedIds(new Set());
                    },
                    onError: () => toast.error("Failed to delete entries"),
                  });
                }}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {otherCategories.length > 0 && (
            <>
              <Button size="sm" variant="outline" className="h-8 text-sm" onClick={() => setShowMoveDialog(true)}>
                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                Move to...
              </Button>
              {showMoveDialog && (
                <div className="flex items-center gap-2">
                  <Select value={moveTargetCatId != null ? String(moveTargetCatId) : ""} onValueChange={(v) => setMoveTargetCatId(Number(v))}>
                    <SelectTrigger className="h-8 w-40 text-sm">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {otherCategories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-8" disabled={!moveTargetCatId} onClick={() => {
                    if (!moveTargetCatId) return;
                    bulkMove.mutate({ discord_ids: [...selectedIds], target_category_id: moveTargetCatId }, {
                      onSuccess: (res) => {
                        toast.success(`Moved ${res.moved} entries`);
                        setSelectedIds(new Set());
                        setShowMoveDialog(false);
                        setMoveTargetCatId(null);
                      },
                      onError: () => toast.error("Failed to move entries"),
                    });
                  }}>Move</Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => { setShowMoveDialog(false); setMoveTargetCatId(null); }}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </>
          )}
          <button className="ml-auto text-xs text-muted-foreground hover:text-white" onClick={() => setSelectedIds(new Set())}>Clear</button>
        </div>
      )}

      {/* Entry list */}
      {entriesLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !entriesData || filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-10 text-center">
          <p className="text-sm font-medium">{expiryFilter !== "all" ? `No ${expiryFilter} entries` : "No entries yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {expiryFilter !== "all" ? "Try changing the filter above." : "Add an entry above to get started."}
          </p>
        </div>
      ) : (
        <>
          {/* Select all */}
          <div className="flex items-center gap-2 px-5 py-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={selectedIds.size > 0 && selectedIds.size === filteredEntries.length}
              onCheckedChange={() => {
                if (selectedIds.size === filteredEntries.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filteredEntries.map(e => e.discord_id)));
                }
              }}
              className="h-4 w-4"
            />
            <span>{selectedIds.size > 0 ? `${selectedIds.size} of ${filteredEntries.length}` : "Select all"}</span>
          </div>
          <div className="rounded-xl border border-white/[0.10] overflow-hidden divide-y divide-white/[0.04]">
            {filteredEntries.map((entry) => (
              <EntryRow
                key={`${entry.discord_id}::${entry.steam_ids?.[0] ?? ""}`}
                entry={entry}
                selected={selectedIds.has(entry.discord_id)}
                onToggle={() => {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    if (next.has(entry.discord_id)) next.delete(entry.discord_id);
                    else next.add(entry.discord_id);
                    return next;
                  });
                }}
                onRemove={() =>
                  removeEntry.mutate(entry.discord_id, {
                    onSuccess: () => toast.success("Entry removed"),
                    onError:   () => toast.error("Failed to remove entry"),
                  })
                }
              />
            ))}
          </div>
        </>
      )}

      {/* Pagination */}
      {entryTotalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setEntryPage(Math.max(1, entryPage - 1))} disabled={entryPage <= 1}>
            <ChevronLeft className="mr-1 h-4 w-4" />Prev
          </Button>
          <span>Page {entryPage} of {entryTotalPages}</span>
          <Button size="sm" variant="ghost" className="h-9" onClick={() => setEntryPage(Math.min(entryTotalPages, entryPage + 1))} disabled={entryPage >= entryTotalPages}>
            Next<ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
