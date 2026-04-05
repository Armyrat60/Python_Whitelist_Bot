"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Upload, FileUp, Link2, Loader2 } from "lucide-react";

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
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
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
  status?: string;
  matched_name?: string;
  match_score?: number;
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
  orphans: number; // entries added without a real discord_id
}

export default function ImportTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const [defaultCategory, setDefaultCategory] = useState("");

  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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
      setPreview(data.users ?? []);
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
    if (!file && !pasteContent.trim() && !importUrl.trim()) { toast.error("Upload a file, paste content, or enter a URL"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setImporting(true);
    try {
      const content = await readContent();
      const effectiveCatMap = Object.keys(categoryMap).length > 0 ? categoryMap : undefined;
      const res = await fetch("/api/admin/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content, format, duplicate_mode: duplicateMode,
          url: importUrl.trim() || undefined,
          category_map: effectiveCatMap,
          default_category: defaultCategory || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      // Count how many imported entries have no real Discord ID AND no name match (true orphans)
      const orphans = preview.filter(
        (u) => u.status === "new" && (!u.discord_id || u.discord_id === "—") && !u.matched_name
      ).length;
      const result: ImportResult = {
        added: data.added ?? 0,
        updated: data.updated ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? 0,
        orphans,
      };
      setImportResult(result);
      // Keep preview visible as "results" — just clear the source file/paste
      setFile(null);
      setPasteContent("");
      toast.success(`Imported ${result.added + result.updated} entries — ${result.added} new, ${result.updated} updated, ${result.skipped} skipped`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      toast.error(msg, {
        action: {
          label: "Retry",
          onClick: () => handleImport(),
        },
        duration: 8000,
      });
    } finally {
      setImporting(false);
    }
  }

  function handleReset() {
    setPreview([]); setSummary(null); setImportResult(null); setFile(null); setPasteContent(""); setImportUrl("");
    setCategoryMap({}); setDefaultCategory("");
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

  const hasData = !!(file || pasteContent.trim() || importUrl.trim());

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
          <Button onClick={handleImport} disabled={importing || !hasData}>
            {importing
              ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Importing…</>
              : <><Upload className="mr-1.5 h-3.5 w-3.5" />Import</>}
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
              <span className="text-sm font-semibold text-emerald-400">✓ Import Complete</span>
              <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">{importResult.added} added</span>
              {importResult.updated > 0 && <span className="rounded-md bg-amber-500/10 px-3 py-1 text-xs text-amber-400">{importResult.updated} updated</span>}
              {importResult.skipped > 0 && <span className="rounded-md bg-white/5 px-3 py-1 text-xs text-muted-foreground">{importResult.skipped} skipped</span>}
              {importResult.errors > 0 && <span className="rounded-md bg-red-500/10 px-3 py-1 text-xs text-red-400">{importResult.errors} errors</span>}
              {importResult.orphans > 0 && (
                <span className="rounded-md bg-amber-500/10 px-3 py-1 text-xs text-amber-400" title="Entries added without a Discord ID — use Reconcile tab to link them">
                  ⚠ {importResult.orphans} unlinked (no Discord ID)
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
        </div>
      )}

      {/* ── Category Mapping (shown after preview, before import) ── */}
      {preview.length > 0 && !importResult && (() => {
        const detectedCats = [...new Set(preview.map((u) => u.category).filter(Boolean))] as string[];
        const hasUncategorized = preview.some((u) => !u.category);
        if (detectedCats.length === 0 && !hasUncategorized) return null;
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Category / Group Mapping</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detectedCats.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Rename or reassign detected groups before importing:</p>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {detectedCats.map((cat) => (
                      <div key={cat} className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-sky-500/10 px-2 py-1 text-xs text-sky-400 font-mono">{cat}</span>
                        <span className="text-xs text-muted-foreground">→</span>
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
                    ))}
                  </div>
                </div>
              )}
              {hasUncategorized && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs shrink-0">Default group for uncategorized entries:</Label>
                  <Input
                    className="h-7 w-48 text-xs"
                    placeholder="(no group)"
                    value={defaultCategory}
                    onChange={(e) => setDefaultCategory(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* ── Preview / Results table ── */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {importResult ? `Import Results — ${preview.length} entries` : `Preview — ${preview.length} entries`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-white/[0.10]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name (from file)</TableHead>
                    <TableHead>Linked Discord</TableHead>
                    <TableHead>Steam ID(s)</TableHead>
                    {preview.some((u) => u.category) && <TableHead>Category</TableHead>}
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 200).map((user, i) => {
                    const hasDiscord = !!(user.discord_id && user.discord_id !== "—");
                    const isMatched = !!user.matched_name;
                    return (
                      <TableRow key={i} className={!hasDiscord && !isMatched ? "opacity-60" : ""}>
                        <TableCell className="text-xs">{user.discord_name || "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {isMatched ? (
                            <span className="text-sky-400" title={`Auto-matched (${Math.round((user.match_score ?? 0) * 100)}% confidence)`}>
                              ✓ {user.matched_name}
                            </span>
                          ) : hasDiscord ? (
                            user.discord_id
                          ) : (
                            <span className="text-amber-400/70 text-[10px]">orphan</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{user.steam_ids?.length ? user.steam_ids.join(", ") : "—"}</TableCell>
                        {preview.some((u) => u.category) && (
                          <TableCell className="text-xs">{user.category || "—"}</TableCell>
                        )}
                        <TableCell className="text-xs">
                          <span className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium",
                            user.status === "new"       && "bg-emerald-500/15 text-emerald-400",
                            user.status === "existing"  && "bg-amber-500/15 text-amber-400",
                            user.status === "invalid"   && "bg-red-500/15 text-red-400",
                            user.status === "duplicate" && "bg-white/5 text-muted-foreground",
                          )}>
                            {isMatched && user.status !== "existing" ? "linked" : (user.status ?? "new")}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {preview.length > 200 && (
              <p className="mt-2 text-xs text-muted-foreground">Showing 200 of {preview.length}</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
