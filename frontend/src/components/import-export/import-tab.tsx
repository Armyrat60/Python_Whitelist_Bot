"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { toast } from "sonner";
import { Upload, FileUp, Link2, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Trash2, X, Check } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

const IMPORT_FORMATS = [
  { value: "auto",           label: "Auto-detect" },
  { value: "squad_cfg",      label: "Squad Admin CFG  (Admin=steamid:role //name)" },
  { value: "csv",            label: "CSV with headers" },
  { value: "plain_ids",      label: "Plain ID list  (one Steam64 / EOS ID per line)" },
  { value: "discord_members",label: "Discord member list  → use Reconcile tab" },
];

const DUPLICATE_MODES = [
  { value: "skip",      label: "Skip duplicates" },
  { value: "merge",     label: "Merge IDs" },
  { value: "overwrite", label: "Overwrite existing" },
];

interface PreviewUser {
  discord_name?: string;
  discord_id?: string;
  steam_ids?: string[];
  eos_ids?: string[];
  plan?: string;
  category?: string;
  squad_group?: string;
  clan_tag?: string;
  status?: string;
  matched_name?: string;
  match_score?: number;
  excluded?: boolean;
}

interface PreviewSummary {
  total_users: number;
  total_ids: number;
  new: number;
  existing: number;
  invalid: number;
}

interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  orphans: number;
}

type SortField = "name" | "category" | "squad_group" | "status" | "steam_id";
type SortDir = "asc" | "desc";

export default function ImportTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [format, setFormat] = useState("auto");
  const [duplicateMode, setDuplicateMode] = useState("merge");
  const [preview, setPreview] = useState<PreviewUser[]>([]);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [groupMap, setGroupMap] = useState<Record<string, string>>({});
  const [defaultCategory, setDefaultCategory] = useState("");

  // Sorting
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Selection
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());

  // Inline edit
  const [editingCell, setEditingCell] = useState<{ row: number; field: "category" | "squad_group" } | null>(null);
  const [editValue, setEditValue] = useState("");

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  // Derived: detect columns that have data
  const hasCategories = preview.some((u) => u.category);
  const hasSquadGroups = preview.some((u) => u.squad_group);

  // Sorted preview
  const sortedPreview = useMemo(() => {
    if (!sortField) return preview;
    const sorted = [...preview];
    sorted.sort((a, b) => {
      let aVal = "";
      let bVal = "";
      switch (sortField) {
        case "name": aVal = a.discord_name || ""; bVal = b.discord_name || ""; break;
        case "category": aVal = a.category || ""; bVal = b.category || ""; break;
        case "squad_group": aVal = a.squad_group || ""; bVal = b.squad_group || ""; break;
        case "status": aVal = a.status || ""; bVal = b.status || ""; break;
        case "steam_id": aVal = a.steam_ids?.[0] || ""; bVal = b.steam_ids?.[0] || ""; break;
      }
      const cmp = aVal.localeCompare(bVal, undefined, { sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return sorted;
  }, [preview, sortField, sortDir]);

  // Virtual scroll
  const rowVirtualizer = useVirtualizer({
    count: sortedPreview.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 36,
    overscan: 20,
  });

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowUpDown className="ml-1 h-3 w-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="ml-1 h-3 w-3" /> : <ArrowDown className="ml-1 h-3 w-3" />;
  }

  function validateAndSetFile(f: File) {
    if (f.size > MAX_FILE_SIZE) {
      toast.error(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }
    setFile(f);
    setPasteContent("");
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) validateAndSetFile(dropped);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) validateAndSetFile(selected);
  }

  async function readContent(): Promise<string> {
    if (file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string ?? "");
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
      });
    }
    return pasteContent;
  }

  async function handlePreview() {
    if (!file && !pasteContent.trim() && !importUrl.trim()) { toast.error("Upload a file, paste content, or enter a URL"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setPreviewing(true);
    setSelectedRows(new Set());
    try {
      const content = await readContent();
      const res = await fetch("/api/admin/import/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format, url: importUrl.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");
      setPreview((data.users ?? []).map((u: PreviewUser) => ({ ...u, excluded: false })));
      setSummary(data.summary ?? null);
      const s = data.summary;
      toast.success(`Preview: ${s?.total_users ?? data.users?.length ?? 0} entries — ${s?.new ?? 0} new, ${s?.existing ?? 0} existing, ${s?.invalid ?? 0} invalid`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport() {
    if (!file && !pasteContent.trim() && !importUrl.trim() && preview.length === 0) { toast.error("Upload a file, paste content, or enter a URL"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setImporting(true);
    try {
      const content = await readContent();
      const effectiveCatMap = Object.keys(categoryMap).length > 0 ? categoryMap : undefined;
      const effectiveGroupMap = Object.keys(groupMap).length > 0 ? groupMap : undefined;

      // If preview has been edited, send the modified user list directly
      const activeUsers = preview.filter((u) => !u.excluded);

      const res = await fetch("/api/admin/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: preview.length > 0 ? undefined : content,
          format,
          duplicate_mode: duplicateMode,
          url: preview.length > 0 ? undefined : (importUrl.trim() || undefined),
          category_map: effectiveCatMap,
          group_map: effectiveGroupMap,
          default_category: defaultCategory || undefined,
          users: preview.length > 0 ? activeUsers : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      const orphans = preview.filter(
        (u) => !u.excluded && u.status === "new" && (!u.discord_id || u.discord_id === "—") && !u.matched_name
      ).length;
      const result: ImportResult = {
        added: data.added ?? 0,
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? 0,
        orphans,
      };
      setImportResult(result);
      setFile(null);
      setPasteContent("");
      toast.success(`Imported ${result.added + result.updated} entries — ${result.added} new, ${result.updated} updated, ${result.skipped} skipped`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg, {
        action: { label: "Retry", onClick: () => handleImport() },
        duration: 8000,
      });
    } finally {
      setImporting(false);
    }
  }

  function handleReset() {
    setPreview([]); setSummary(null); setImportResult(null); setFile(null); setPasteContent(""); setImportUrl("");
    setCategoryMap({}); setGroupMap({}); setDefaultCategory("");
    setSelectedRows(new Set()); setEditingCell(null); setSortField(null);
  }

  async function handleUndo() {
    setUndoing(true);
    try {
      const res = await fetch("/api/admin/import/undo", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Undo failed");
      toast.success(`Undo complete — removed ${data.removed} imported entries`);
      handleReset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Undo failed");
    } finally {
      setUndoing(false);
    }
  }

  // ── Selection helpers ──
  const toggleRow = useCallback((idx: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (selectedRows.size === sortedPreview.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(sortedPreview.map((_, i) => i)));
    }
  }, [selectedRows.size, sortedPreview]);

  // ── Bulk actions ──
  function bulkSetCategory(cat: string) {
    const sorted = sortedPreview;
    setPreview((prev) => {
      const next = [...prev];
      for (const idx of selectedRows) {
        const user = sorted[idx];
        if (!user) continue;
        const realIdx = prev.indexOf(user);
        if (realIdx >= 0) next[realIdx] = { ...next[realIdx], category: cat };
      }
      return next;
    });
    setSelectedRows(new Set());
    toast.success(`Updated ${selectedRows.size} entries`);
  }

  function bulkSetSquadGroup(group: string) {
    const sorted = sortedPreview;
    setPreview((prev) => {
      const next = [...prev];
      for (const idx of selectedRows) {
        const user = sorted[idx];
        if (!user) continue;
        const realIdx = prev.indexOf(user);
        if (realIdx >= 0) next[realIdx] = { ...next[realIdx], squad_group: group };
      }
      return next;
    });
    setSelectedRows(new Set());
    toast.success(`Updated ${selectedRows.size} entries`);
  }

  function bulkToggleExclude() {
    const sorted = sortedPreview;
    setPreview((prev) => {
      const next = [...prev];
      for (const idx of selectedRows) {
        const user = sorted[idx];
        if (!user) continue;
        const realIdx = prev.indexOf(user);
        if (realIdx >= 0) next[realIdx] = { ...next[realIdx], excluded: !next[realIdx].excluded };
      }
      return next;
    });
    setSelectedRows(new Set());
  }

  function bulkDelete() {
    const sorted = sortedPreview;
    const toRemove = new Set(Array.from(selectedRows).map((idx) => sorted[idx]));
    setPreview((prev) => prev.filter((u) => !toRemove.has(u)));
    setSelectedRows(new Set());
    toast.success(`Removed ${toRemove.size} entries from preview`);
  }

  // ── Inline edit ──
  function startEdit(row: number, field: "category" | "squad_group") {
    const user = sortedPreview[row];
    setEditingCell({ row, field });
    setEditValue(user?.[field] || "");
  }

  function commitEdit() {
    if (!editingCell) return;
    const user = sortedPreview[editingCell.row];
    if (!user) { setEditingCell(null); return; }
    setPreview((prev) => {
      const next = [...prev];
      const realIdx = prev.indexOf(user);
      if (realIdx >= 0) next[realIdx] = { ...next[realIdx], [editingCell.field]: editValue };
      return next;
    });
    setEditingCell(null);
  }

  const hasData = !!(file || pasteContent.trim() || importUrl.trim());
  const activeCount = preview.filter((u) => !u.excluded).length;
  const excludedCount = preview.length - activeCount;

  // ── Bulk action UI state ──
  const [bulkCatInput, setBulkCatInput] = useState("");
  const [bulkGroupInput, setBulkGroupInput] = useState("");
  const [showBulkCat, setShowBulkCat] = useState(false);
  const [showBulkGroup, setShowBulkGroup] = useState(false);

  return (
    <div className="space-y-4 pt-4">
      {/* ── Info banner ── */}
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 px-4 py-2.5 text-xs text-sky-200/80">
        Imports go to the <strong>Imported</strong> manual roster. Manage entries in <a href="/dashboard/manual-roster" className="underline hover:text-sky-300">Manual Roster</a>.
      </div>

      {/* ── Controls row at top ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v ?? "auto")}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {IMPORT_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Duplicate Handling</Label>
          <Select value={duplicateMode} onValueChange={(v) => setDuplicateMode(v ?? "merge")}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DUPLICATE_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 pb-0.5">
          <Button variant="outline" onClick={handlePreview} disabled={!hasData || previewing}>
            {previewing ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Previewing…</> : "Preview"}
          </Button>
          <Button onClick={handleImport} disabled={importing || (!hasData && preview.length === 0)}>
            {importing
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Importing…</>
              : <><Upload className="mr-1.5 h-3.5 w-3.5" />Import{activeCount > 0 ? ` (${activeCount})` : ""}</>}
          </Button>
          <Button variant="outline" className="text-red-400 hover:text-red-300" onClick={handleUndo} disabled={undoing}>
            {undoing ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Undoing…</> : "Undo Last Import"}
          </Button>
        </div>
      </div>

      {/* ── Upload + Paste + URL ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Upload File</CardTitle></CardHeader>
          <CardContent>
            <div
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors select-none",
                isDragOver
                  ? "border-[color:var(--accent-primary)] bg-[color:var(--accent-primary)]/5"
                  : file
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-white/[0.10] hover:border-white/[0.22]"
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className={cn("h-8 w-8", file ? "text-emerald-400" : "text-muted-foreground")} />
              {file
                ? <p className="text-sm font-medium text-emerald-400">{file.name}</p>
                : <>
                    <p className="text-sm text-muted-foreground">Drag & drop a file here, or click to browse</p>
                    <p className="text-xs text-muted-foreground">CSV · CFG · TXT</p>
                  </>
              }
              <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.cfg,.txt" onChange={handleFileSelect} />
            </div>
            {file && (
              <button className="mt-2 text-xs text-muted-foreground hover:text-white" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                Clear file
              </button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Or Paste Content</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              value={pasteContent}
              onChange={(e) => { setPasteContent(e.target.value); if (e.target.value) { setFile(null); setImportUrl(""); } }}
              placeholder={"Paste any format:\n\nAdmin=76561198212353664:reserve //Name\n76561198212353664\ndiscord_name,steam_id\nname,discord_id  ← use Reconcile tab"}
              className="min-h-[148px] font-mono text-xs"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Or Import from URL</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Input
                value={importUrl}
                onChange={(e) => { setImportUrl(e.target.value); if (e.target.value) { setFile(null); setPasteContent(""); } }}
                placeholder="https://staff.example.com/wl"
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Paste a link to a whitelist file. Supports Squad CFG, CSV, or plain ID lists. The server will fetch and parse it.
              </p>
              {importUrl.trim() && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <Link2 className="h-3 w-3" />
                  URL ready — click Preview or Import
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Import result banner ── */}
      {importResult && (
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-emerald-400">Import Complete</span>
              <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">{importResult.added} added</span>
              {importResult.updated > 0 && <span className="rounded-md bg-amber-500/10 px-3 py-1 text-xs text-amber-400">{importResult.updated} updated</span>}
              {importResult.skipped > 0 && <span className="rounded-md bg-white/5 px-3 py-1 text-xs text-muted-foreground">{importResult.skipped} skipped</span>}
              {importResult.errors > 0 && <span className="rounded-md bg-red-500/10 px-3 py-1 text-xs text-red-400">{importResult.errors} errors</span>}
              {importResult.orphans > 0 && (
                <span className="rounded-md bg-amber-500/10 px-3 py-1 text-xs text-amber-400" title="Entries added without a Discord ID — use Reconcile tab to link them">
                  {importResult.orphans} unlinked (no Discord ID)
                </span>
              )}
              <Button size="sm" variant="outline" className="ml-auto" onClick={handleReset}>
                New Import
              </Button>
            </div>
            {importResult.orphans > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                These entries have Steam IDs but no Discord account linked yet. Members can claim their record when they click the panel, or use the <strong>Reconcile</strong> tab to match them manually.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Preview / Result summary chips ── */}
      {summary && !importResult && (
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{summary.total_users} total</span>
          <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">{summary.new} new</span>
          {summary.existing > 0 && <span className="rounded-md bg-amber-500/10 px-3 py-1 text-xs text-amber-400">{summary.existing} existing</span>}
          {summary.invalid > 0 && <span className="rounded-md bg-red-500/10 px-3 py-1 text-xs text-red-400">{summary.invalid} invalid</span>}
          <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{summary.total_ids} IDs</span>
          {(() => {
            const cats = new Set(preview.map((u) => u.category).filter(Boolean));
            return cats.size > 0 ? <span className="rounded-md bg-sky-500/10 px-3 py-1 text-xs text-sky-400">{cats.size} categories</span> : null;
          })()}
          {(() => {
            const groups = new Set(preview.map((u) => u.squad_group).filter(Boolean));
            return groups.size > 0 ? <span className="rounded-md bg-violet-500/10 px-3 py-1 text-xs text-violet-400">{groups.size} squad groups</span> : null;
          })()}
          {excludedCount > 0 && <span className="rounded-md bg-red-500/10 px-3 py-1 text-xs text-red-400">{excludedCount} excluded</span>}
        </div>
      )}

      {/* ── Category & Group Mapping ── */}
      {preview.length > 0 && !importResult && (() => {
        const detectedCats = [...new Set(preview.map((u) => u.category).filter(Boolean))] as string[];
        const detectedGroups = [...new Set(preview.map((u) => u.squad_group).filter(Boolean))] as string[];
        const hasUncategorized = preview.some((u) => !u.category);
        if (detectedCats.length === 0 && detectedGroups.length === 0 && !hasUncategorized) return null;
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Category / Group Mapping</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {detectedCats.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Rename detected categories before importing (parsed from bracket tags like [DMH]):</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {detectedCats.map((cat) => {
                      const count = preview.filter((u) => u.category === cat).length;
                      return (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-400 font-mono">{cat} <span className="text-muted-foreground">({count})</span></span>
                          <span className="text-xs text-muted-foreground">&rarr;</span>
                          <Input
                            className="h-7 text-xs flex-1"
                            placeholder={cat}
                            value={categoryMap[cat] ?? ""}
                            onChange={(e) => setCategoryMap((prev) => {
                              const next = { ...prev };
                              if (e.target.value) next[cat] = e.target.value;
                              else delete next[cat];
                              return next;
                            })}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {detectedGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Detected Squad groups (from CFG role after colon). Rename or keep as-is:</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {detectedGroups.map((grp) => {
                      const count = preview.filter((u) => u.squad_group === grp).length;
                      return (
                        <div key={grp} className="flex items-center gap-2">
                          <span className="shrink-0 rounded bg-violet-500/10 px-2 py-1 text-xs text-violet-400 font-mono">{grp} <span className="text-muted-foreground">({count})</span></span>
                          <span className="text-xs text-muted-foreground">&rarr;</span>
                          <Input
                            className="h-7 text-xs flex-1"
                            placeholder={grp}
                            value={groupMap[grp] ?? ""}
                            onChange={(e) => setGroupMap((prev) => {
                              const next = { ...prev };
                              if (e.target.value) next[grp] = e.target.value;
                              else delete next[grp];
                              return next;
                            })}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {hasUncategorized && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">Default category for uncategorized entries:</Label>
                  <Input
                    className="h-7 w-48 text-xs"
                    placeholder="(no category)"
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ── Bulk action toolbar ── */}
      {selectedRows.size > 0 && !importResult && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2">
          <span className="text-xs font-medium">{selectedRows.size} selected</span>
          <div className="h-4 w-px bg-white/10" />

          {/* Change Category */}
          {showBulkCat ? (
            <div className="flex items-center gap-1">
              <Input
                className="h-7 w-32 text-xs"
                placeholder="New category"
                value={bulkCatInput}
                onChange={(e) => setBulkCatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && bulkCatInput.trim()) { bulkSetCategory(bulkCatInput.trim()); setShowBulkCat(false); setBulkCatInput(""); } }}
                autoFocus
              />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { if (bulkCatInput.trim()) { bulkSetCategory(bulkCatInput.trim()); setShowBulkCat(false); setBulkCatInput(""); } }}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowBulkCat(false); setBulkCatInput(""); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowBulkCat(true)}>
              Set Category
            </Button>
          )}

          {/* Change Squad Group */}
          {hasSquadGroups && (
            showBulkGroup ? (
              <div className="flex items-center gap-1">
                <Input
                  className="h-7 w-32 text-xs"
                  placeholder="New group"
                  value={bulkGroupInput}
                  onChange={(e) => setBulkGroupInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && bulkGroupInput.trim()) { bulkSetSquadGroup(bulkGroupInput.trim()); setShowBulkGroup(false); setBulkGroupInput(""); } }}
                  autoFocus
                />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { if (bulkGroupInput.trim()) { bulkSetSquadGroup(bulkGroupInput.trim()); setShowBulkGroup(false); setBulkGroupInput(""); } }}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowBulkGroup(false); setBulkGroupInput(""); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowBulkGroup(true)}>
                Set Group
              </Button>
            )
          )}

          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={bulkToggleExclude}>
            Toggle Exclude
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs text-red-400 hover:text-red-300" onClick={bulkDelete}>
            <Trash2 className="mr-1 h-3 w-3" />Remove
          </Button>

          <button className="ml-auto text-xs text-muted-foreground hover:text-white" onClick={() => setSelectedRows(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {/* ── Preview / Results table with virtual scroll ── */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {importResult ? `Import Results — ${preview.length} entries` : `Preview — ${preview.length} entries`}
              {excludedCount > 0 && !importResult && (
                <span className="ml-2 text-xs font-normal text-red-400">({excludedCount} excluded)</span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-white/[0.10]">
              {/* Header */}
              <div className="flex items-center border-b border-white/[0.10] bg-white/[0.02] text-xs font-medium text-muted-foreground">
                <div className="w-10 shrink-0 px-2 py-2">
                  <Checkbox
                    checked={selectedRows.size > 0 && selectedRows.size === sortedPreview.length}
                    onCheckedChange={toggleAll}
                    className="h-3.5 w-3.5"
                  />
                </div>
                <button className="flex w-[180px] shrink-0 items-center px-3 py-2 text-left hover:text-white" onClick={() => toggleSort("name")}>
                  Name <SortIcon field="name" />
                </button>
                <div className="w-[160px] shrink-0 px-3 py-2">Linked Discord</div>
                <button className="flex w-[160px] shrink-0 items-center px-3 py-2 text-left hover:text-white" onClick={() => toggleSort("steam_id")}>
                  Steam ID(s) <SortIcon field="steam_id" />
                </button>
                {hasCategories && (
                  <button className="flex w-[120px] shrink-0 items-center px-3 py-2 text-left hover:text-white" onClick={() => toggleSort("category")}>
                    Category <SortIcon field="category" />
                  </button>
                )}
                {hasSquadGroups && (
                  <button className="flex w-[100px] shrink-0 items-center px-3 py-2 text-left hover:text-white" onClick={() => toggleSort("squad_group")}>
                    Group <SortIcon field="squad_group" />
                  </button>
                )}
                <button className="flex w-[80px] shrink-0 items-center px-3 py-2 text-left hover:text-white" onClick={() => toggleSort("status")}>
                  Status <SortIcon field="status" />
                </button>
              </div>

              {/* Virtualized rows */}
              <div
                ref={scrollContainerRef}
                className="overflow-auto"
                style={{ maxHeight: "520px" }}
              >
                <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}>
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const user = sortedPreview[virtualRow.index];
                    if (!user) return null;
                    const hasDiscord = !!(user.discord_id && user.discord_id !== "—");
                    const isMatched = !!user.matched_name;
                    const isExcluded = !!user.excluded;
                    const isSelected = selectedRows.has(virtualRow.index);
                    const isEditingCat = editingCell?.row === virtualRow.index && editingCell?.field === "category";
                    const isEditingGroup = editingCell?.row === virtualRow.index && editingCell?.field === "squad_group";

                    return (
                      <div
                        key={virtualRow.index}
                        className={cn(
                          "absolute left-0 right-0 flex items-center border-b border-white/[0.05] text-xs",
                          isExcluded && "opacity-30 line-through",
                          isSelected && !isExcluded && "bg-sky-500/5",
                          !hasDiscord && !isMatched && !isExcluded && "opacity-60",
                        )}
                        style={{
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        <div className="w-10 shrink-0 px-2">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleRow(virtualRow.index)}
                            className="h-3.5 w-3.5"
                          />
                        </div>
                        <div className="w-[180px] shrink-0 truncate px-3">{user.discord_name || "—"}</div>
                        <div className="w-[160px] shrink-0 truncate px-3 font-mono">
                          {isMatched ? (
                            <span className="text-sky-400" title={`Auto-matched (${Math.round((user.match_score ?? 0) * 100)}% confidence)`}>
                              {user.matched_name}
                            </span>
                          ) : hasDiscord ? (
                            user.discord_id
                          ) : (
                            <span className="text-amber-400/70 text-[10px]">orphan</span>
                          )}
                        </div>
                        <div className="w-[160px] shrink-0 truncate px-3 font-mono">{user.steam_ids?.length ? user.steam_ids.join(", ") : "—"}</div>
                        {hasCategories && (
                          <div className="w-[120px] shrink-0 truncate px-3">
                            {isEditingCat ? (
                              <Input
                                className="h-6 text-xs"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
                                autoFocus
                              />
                            ) : (
                              <span
                                className="cursor-pointer rounded px-1 hover:bg-white/5"
                                onClick={() => !importResult && startEdit(virtualRow.index, "category")}
                                title="Click to edit"
                              >
                                {user.category || "—"}
                              </span>
                            )}
                          </div>
                        )}
                        {hasSquadGroups && (
                          <div className="w-[100px] shrink-0 truncate px-3">
                            {isEditingGroup ? (
                              <Input
                                className="h-6 text-xs"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingCell(null); }}
                                autoFocus
                              />
                            ) : (
                              <span
                                className="cursor-pointer rounded px-1 hover:bg-white/5"
                                onClick={() => !importResult && startEdit(virtualRow.index, "squad_group")}
                                title="Click to edit"
                              >
                                {user.squad_group || "—"}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="w-[80px] shrink-0 px-3">
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            user.status === "new"       && "bg-emerald-500/15 text-emerald-400",
                            user.status === "existing"  && "bg-amber-500/15 text-amber-400",
                            user.status === "invalid"   && "bg-red-500/15 text-red-400",
                            user.status === "duplicate" && "bg-white/5 text-muted-foreground",
                          )}>
                            {isMatched && user.status !== "existing" ? "linked" : (user.status ?? "new")}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
