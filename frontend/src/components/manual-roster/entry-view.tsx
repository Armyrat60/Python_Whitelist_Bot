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
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  useCategoryEntries,
  useAddCategoryEntry,
  useRemoveCategoryEntry,
  useImportCategoryEntries,
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

function EntryRow({ entry, onRemove }: { entry: CategoryEntry; onRemove: () => void }) {
  const steamId    = entry.steam_ids?.[0] ?? "\u2014";
  const noDiscord  = entry.discord_name === "[No Discord]" || entry.created_via === "manual_steam_only";
  const expiredSoon = isExpiredOrSoon(entry.expires_at);

  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-white/[0.01] hover:bg-white/[0.03] text-sm">
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
  const importEntries = useImportCategoryEntries(whitelist.id, category.id);

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

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" className="h-9 shrink-0 gap-1.5 px-3 text-sm" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" />
          Back
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold truncate">{category.name}</h2>
          <p className="text-sm text-muted-foreground">
            {category.slot_limit != null
              ? `${entriesData?.total ?? category.user_count} entries / ${category.slot_limit} max`
              : `${entriesData?.total ?? category.user_count ?? 0} entries`}
          </p>
        </div>
      </div>

      {/* ─── Actions bar (Add, Import, Managers) ─────────────────────── */}
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
              <Input
                value={steamId}
                onChange={(e) => setSteamId(e.target.value)}
                placeholder="76561198..."
                className="font-mono text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Discord ID <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={discordId}
                onChange={(e) => setDiscordId(e.target.value)}
                placeholder="123456789012345678"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Discord Name <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={discordName}
                onChange={(e) => setDiscordName(e.target.value)}
                placeholder="Username"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Notes <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                value={entryNotes}
                onChange={(e) => setEntryNotes(e.target.value)}
                placeholder="Internal note"
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">Expiry Date <span className="text-muted-foreground">(optional)</span></Label>
              <Input
                type="date"
                value={entryExpiry}
                onChange={(e) => setEntryExpiry(e.target.value)}
                className="text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAddEntry} disabled={addEntry.isPending || !steamId.trim()}>
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setAddEntryOpen(false); setSteamId(""); setDiscordId(""); setDiscordName(""); setEntryNotes(""); setEntryExpiry(""); }}>
                Cancel
              </Button>
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
              <Button
                size="sm"
                disabled={importEntries.isPending || !csvText.trim()}
                onClick={() => {
                  importEntries.mutate(csvText, {
                    onSuccess: (res) => {
                      setImportResult(res);
                      if (res.added + res.updated > 0) {
                        toast.success(`Imported ${res.added + res.updated} entries`);
                        setCsvText("");
                      }
                      if (res.errors.length > 0) toast.warning(`${res.errors.length} row(s) had errors`);
                    },
                    onError: () => toast.error("Import failed"),
                  });
                }}
              >
                {importEntries.isPending ? "Importing\u2026" : "Import"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setImportOpen(false); setCsvText(""); setImportResult(null); }}>
                Cancel
              </Button>
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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or Steam ID\u2026"
            className="pl-8 h-8 text-xs"
          />
        </div>
        <div className="flex rounded-md border border-border text-xs">
          {(["all", "active", "expiring-soon", "expired"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setExpiryFilter(f)}
              className={cn(
                "px-2.5 h-8 first:rounded-l-md last:rounded-r-md capitalize transition-colors",
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

      {/* Entry list */}
      {entriesLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !entriesData || filteredEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-10 text-center">
          <p className="text-sm font-medium">{expiryFilter !== "all" ? `No ${expiryFilter} entries` : "No entries yet"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {expiryFilter !== "all" ? "Try changing the filter above." : "Add a member below to get started."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.10] overflow-hidden divide-y divide-white/[0.04]">
          {filteredEntries.map((entry) => (
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

    </div>
  );
}
