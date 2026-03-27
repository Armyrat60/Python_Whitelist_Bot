"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Upload, Download, FileUp, Link2, CheckCircle2, AlertCircle, Loader2, UserCheck, RefreshCw, Users } from "lucide-react";
import { useWhitelists } from "@/hooks/use-settings";
import { api } from "@/lib/api";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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

const EXPORT_FORMATS = [
  { value: "csv", label: "CSV" },
  { value: "cfg", label: "Squad RemoteAdminList" },
  { value: "json", label: "JSON" },
];

const EXPORT_FILTERS = [
  { value: "active", label: "Active only" },
  { value: "all", label: "All" },
  { value: "expired", label: "Expired" },
];

export default function ImportExportPage() {
  return (
    <div className="space-y-6">
      <Tabs defaultValue="import">
        <TabsList>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
          <TabsTrigger value="reconcile">
            <Link2 className="mr-1.5 h-3.5 w-3.5" />
            Reconcile
          </TabsTrigger>
          <TabsTrigger value="role-sync">
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Role Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
        <TabsContent value="reconcile">
          <ReconcileTab />
        </TabsContent>
        <TabsContent value="role-sync">
          <RoleSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT TAB
// ═══════════════════════════════════════════════════════════════════════════

interface PreviewUser {
  discord_name?: string;
  discord_id?: string;
  steam_ids?: string[];
  eos_ids?: string[];
  plan?: string;
  status?: string;
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

function ImportTab() {
  const { data: whitelists } = useWhitelists();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [targetWhitelist, setTargetWhitelist] = useState("");
  const [format, setFormat] = useState("auto");
  const [duplicateMode, setDuplicateMode] = useState("merge");
  const [preview, setPreview] = useState<PreviewUser[]>([]);
  const [summary, setSummary] = useState<PreviewSummary | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    if (!whitelists?.length || targetWhitelist) return;
    const def = whitelists.find((w: { slug: string }) => w.slug === "default") ?? whitelists[0];
    if (def) setTargetWhitelist(def.slug);
  }, [whitelists]);

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setPasteContent(""); }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) { setFile(selected); setPasteContent(""); }
  }

  function buildFormData() {
    const fd = new FormData();
    if (file) fd.append("file", file);
    else fd.append("content", pasteContent);
    fd.append("format", format);
    fd.append("whitelist_slug", targetWhitelist);
    return fd;
  }

  async function handlePreview() {
    if (!file && !pasteContent.trim()) { toast.error("Upload a file or paste content first"); return; }
    if (!targetWhitelist) { toast.error("Select a target whitelist"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setPreviewing(true);
    try {
      const res = await fetch("/api/admin/import/preview", {
        method: "POST", credentials: "include", body: buildFormData(),
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
    if (!file && !pasteContent.trim()) { toast.error("Upload a file or paste content first"); return; }
    if (!targetWhitelist) { toast.error("Select a target whitelist"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setImporting(true);
    try {
      const fd = buildFormData();
      fd.append("duplicate_mode", duplicateMode);
      const res = await fetch("/api/admin/import", {
        method: "POST", credentials: "include", body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      // Count how many imported entries have no real Discord ID (orphans = steam-only imports)
      const orphans = preview.filter(
        (u) => u.status === "new" && (!u.discord_id || u.discord_id === "—")
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
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function handleReset() {
    setPreview([]); setSummary(null); setImportResult(null); setFile(null); setPasteContent("");
  }

  const hasData = !!(file || pasteContent.trim());

  return (
    <div className="space-y-4 pt-4">
      {/* ── Controls row at top ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Target Whitelist</Label>
          <Select value={targetWhitelist} onValueChange={(v) => setTargetWhitelist(v ?? "")}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Select whitelist" /></SelectTrigger>
            <SelectContent>
              {whitelists?.map((wl) => (
                <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
        </div>
      </div>

      {/* ── Upload + Paste ── */}
      <div className="grid gap-4 lg:grid-cols-2">
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
              onChange={(e) => { setPasteContent(e.target.value); if (e.target.value) setFile(null); }}
              placeholder={"Paste any format:\n\nAdmin=76561198212353664:reserve //Name\n76561198212353664\ndiscord_name,steam_id\nname,discord_id  ← use Reconcile tab"}
              className="min-h-[148px] font-mono text-xs"
            />
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
        </div>
      )}

      {/* ── Preview / Results table ── */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {importResult ? `Import Results — ${preview.length} entries` : `Preview — ${preview.length} entries`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-white/[0.06]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Discord ID</TableHead>
                    <TableHead>Steam ID(s)</TableHead>
                    <TableHead>EOS ID(s)</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 200).map((user, i) => (
                    <TableRow key={i} className={!user.discord_id || user.discord_id === "—" ? "opacity-60" : ""}>
                      <TableCell className="text-xs">{user.discord_name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {user.discord_id || <span className="text-amber-400/70 text-[10px]">no Discord ID</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{user.steam_ids?.length ? user.steam_ids.join(", ") : "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{user.eos_ids?.length ? user.eos_ids.join(", ") : "—"}</TableCell>
                      <TableCell className="text-xs">
                        <span className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-medium",
                          user.status === "new"      && "bg-emerald-500/15 text-emerald-400",
                          user.status === "existing" && "bg-amber-500/15 text-amber-400",
                          user.status === "invalid"  && "bg-red-500/15 text-red-400",
                          user.status === "duplicate" && "bg-white/5 text-muted-foreground",
                        )}>
                          {user.status ?? "new"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
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

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT TAB
// ═══════════════════════════════════════════════════════════════════════════

function ExportTab() {
  const { data: whitelists, isLoading } = useWhitelists();
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState("csv");
  const [filter, setFilter] = useState("active");

  function toggleWhitelist(slug: string) {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  async function handleExport() {
    if (selectedSlugs.length === 0) {
      toast.error("Select at least one whitelist");
      return;
    }

    try {
      const params = new URLSearchParams({
        slugs: selectedSlugs.join(","),
        format: exportFormat,
        filter,
      });
      const url = `/api/admin/export?${params.toString()}`;

      // Trigger download
      const link = document.createElement("a");
      link.href = url;
      link.download = `whitelist-export.${exportFormat === "cfg" ? "cfg" : exportFormat}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success("Export started");
    } catch {
      toast.error("Export failed");
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4 pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-4">
      {/* Whitelist Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Whitelists</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {whitelists?.map((wl) => (
              <label
                key={wl.slug}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.06] px-3 py-2 transition-colors hover:bg-white/5"
              >
                <Checkbox
                  checked={selectedSlugs.includes(wl.slug)}
                  onCheckedChange={() => toggleWhitelist(wl.slug)}
                />
                <span className="text-sm font-medium">{wl.name}</span>
                {!wl.enabled && (
                  <span className="text-xs text-muted-foreground">
                    (disabled)
                  </span>
                )}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Export Options */}
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label>Format</Label>
          <Select value={exportFormat} onValueChange={(v) => setExportFormat(v ?? "csv")}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPORT_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Filter</Label>
          <Select value={filter} onValueChange={(v) => setFilter(v ?? "active")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPORT_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button onClick={handleExport} disabled={selectedSlugs.length === 0}>
        <Download className="mr-1.5 h-3.5 w-3.5" />
        Download Export
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RECONCILE TAB
// ═══════════════════════════════════════════════════════════════════════════

interface ReconcileResult {
  orphan_discord_id: number;
  orphan_name: string;
  whitelist_slug: string;
  whitelist_name: string;
  identifiers: string[];
  match: { discord_name: string; discord_id: number } | null;
  confidence: number;
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 1.0) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)", color: "var(--accent-primary)" }}>Exact</span>;
  if (score >= 0.9) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/15 text-emerald-400">High {Math.round(score * 100)}%</span>;
  if (score >= 0.5) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-400">Low {Math.round(score * 100)}%</span>;
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-white/5 text-muted-foreground">No match</span>;
}

function ReconcileTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ReconcileResult[] | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(0);

  // Per-row state: checked = will apply, overrides for manual ID/name entry
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [overrideId, setOverrideId] = useState<Record<number, string>>({});
  const [overrideName, setOverrideName] = useState<Record<number, string>>({});

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setPasteContent(""); }
  }

  async function handlePreview() {
    setPreviewing(true);
    setResults(null);
    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      } else if (pasteContent.trim()) {
        formData.append("content", pasteContent);
      } else {
        toast.error("Upload a Discord member file or paste the content");
        return;
      }

      const res = await fetch("/api/admin/reconcile/preview", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");

      setMembersLoaded(data.members_loaded ?? 0);
      setResults(data.results ?? []);

      // Auto-check rows with confidence >= 0.9
      const initialChecked: Record<number, boolean> = {};
      for (const r of (data.results ?? []) as ReconcileResult[]) {
        initialChecked[r.orphan_discord_id] = r.confidence >= 0.9;
      }
      setChecked(initialChecked);
      setOverrideId({});
      setOverrideName({});

      toast.success(`Found ${data.orphans_found} orphan(s) — ${data.members_loaded} members loaded`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (!results) return;
    setApplying(true);
    try {
      const matches = results
        .filter((r) => checked[r.orphan_discord_id])
        .map((r) => {
          const oid = overrideId[r.orphan_discord_id];
          const oname = overrideName[r.orphan_discord_id];
          const realId = oid ? parseInt(oid) : r.match?.discord_id ?? 0;
          const realName = oname || r.match?.discord_name || r.orphan_name;
          return {
            orphan_discord_id: r.orphan_discord_id,
            real_discord_id: realId,
            real_discord_name: realName,
          };
        })
        .filter((m) => m.real_discord_id > 0);

      if (matches.length === 0) {
        toast.error("No valid matches selected");
        return;
      }

      const res = await fetch("/api/admin/reconcile/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");

      toast.success(`Applied ${data.applied} match(es) — ${data.errors} error(s)`);
      setResults(null);
      setFile(null);
      setPasteContent("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="space-y-6 pt-4">
      {/* Explanation */}
      <div
        className="rounded-lg border p-4 text-sm"
        style={{
          borderColor: "color-mix(in srgb, var(--accent-secondary) 25%, transparent)",
          background: "color-mix(in srgb, var(--accent-secondary) 5%, transparent)",
        }}
      >
        <div className="flex items-start gap-3">
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--accent-secondary)" }} />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Link imported Steam IDs to Discord members</p>
            <p className="text-muted-foreground">
              When you import a Squad CFG or Steam-ID-only list, entries are saved as "orphans" with no Discord link.
              Upload your Discord server member list (<span className="font-mono">User,ID</span> format — exported from your server) and this tool will match orphan names to real Discord IDs.
            </p>
            <p className="text-xs text-muted-foreground">
              Auto-check applies to matches ≥ 90% confidence. Review low-confidence rows and enter a Discord ID manually if needed.
            </p>
          </div>
        </div>
      </div>

      {/* Upload / Paste */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Upload Discord Member List</CardTitle></CardHeader>
          <CardContent>
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/[0.10] p-8 text-center transition-colors hover:border-white/[0.20] cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-8 w-8 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Click to upload a <span className="font-mono">User,ID</span> CSV / TXT</p>
                  <p className="text-xs text-muted-foreground">e.g. exported from Discord server member list</p>
                </>
              )}
              <input ref={fileRef} type="file" className="hidden" accept=".csv,.txt" onChange={handleFileSelect} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Or Paste Member List</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              value={pasteContent}
              onChange={(e) => { setPasteContent(e.target.value); setFile(null); }}
              placeholder={"User,ID\narmyrat60,268871213479231489\ngreyhat12334,1286894254710329457\n..."}
              className="min-h-[140px] font-mono text-xs"
            />
          </CardContent>
        </Card>
      </div>

      <Button onClick={handlePreview} disabled={previewing || (!file && !pasteContent.trim())}>
        {previewing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
        Preview Matches
      </Button>

      {/* Results table */}
      {results !== null && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Match Results</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {results.length} orphan(s) found · {membersLoaded} members loaded · {checkedCount} selected
              </p>
            </div>
            <Button
              onClick={handleApply}
              disabled={applying || checkedCount === 0}
              size="sm"
              style={{ background: "var(--accent-primary)", color: "#000" }}
            >
              {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Apply {checkedCount} Match{checkedCount !== 1 ? "es" : ""}
            </Button>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No orphan records found — all entries are already linked to Discord members.</p>
            ) : (
              <div className="rounded-lg border border-white/[0.06]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 cursor-pointer rounded"
                          checked={checkedCount === results.length && results.length > 0}
                          onChange={(e) => {
                            const all: Record<number, boolean> = {};
                            results.forEach((r) => { all[r.orphan_discord_id] = e.target.checked; });
                            setChecked(all);
                          }}
                        />
                      </TableHead>
                      <TableHead>Orphan Name</TableHead>
                      <TableHead>Whitelist</TableHead>
                      <TableHead>Steam / EOS IDs</TableHead>
                      <TableHead>Best Match</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Override Discord ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.orphan_discord_id} className={checked[r.orphan_discord_id] ? "row-selected" : "row-hover"}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 cursor-pointer rounded"
                            checked={!!checked[r.orphan_discord_id]}
                            onChange={(e) => setChecked((prev) => ({ ...prev, [r.orphan_discord_id]: e.target.checked }))}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{r.orphan_name || <span className="text-muted-foreground">(unknown)</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.whitelist_name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {r.identifiers.length > 0 ? r.identifiers.map((id) => (
                              <span key={id} className="font-mono text-[10px] rounded px-1 py-0.5 bg-white/5 text-muted-foreground">{id}</span>
                            )) : <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.match ? (
                            <div>
                              <p className="text-sm font-medium">{r.match.discord_name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{r.match.discord_id}</p>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <AlertCircle className="h-3.5 w-3.5" /> No match
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ConfidenceBadge score={r.confidence} />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Input
                              placeholder="Discord ID"
                              className="h-6 w-40 font-mono text-xs"
                              value={overrideId[r.orphan_discord_id] ?? ""}
                              onChange={(e) => setOverrideId((prev) => ({ ...prev, [r.orphan_discord_id]: e.target.value }))}
                            />
                            <Input
                              placeholder="Discord name"
                              className="h-6 w-40 text-xs"
                              value={overrideName[r.orphan_discord_id] ?? ""}
                              onChange={(e) => setOverrideName((prev) => ({ ...prev, [r.orphan_discord_id]: e.target.value }))}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROLE SYNC TAB
// ═══════════════════════════════════════════════════════════════════════════

interface RoleSyncMember {
  discord_id: string;
  discord_name: string;
}

interface RoleSyncResult {
  role_name: string;
  whitelist_slug: string;
  total_role_members: number;
  added: RoleSyncMember[];
  already_exist: number;
  dry_run: boolean;
}

function RoleSyncTab() {
  const { data: whitelists } = useWhitelists();
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [targetWhitelist, setTargetWhitelist] = useState("");
  const [result, setResult] = useState<RoleSyncResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-select default whitelist
  useEffect(() => {
    if (!whitelists?.length || targetWhitelist) return;
    const def = whitelists.find((w: { slug: string }) => w.slug === "default") ?? whitelists[0];
    if (def) setTargetWhitelist(def.slug);
  }, [whitelists]);

  // Load Discord roles
  useEffect(() => {
    setRolesLoading(true);
    fetch("/api/admin/roles", { credentials: "include" })
      .then(async (r) => {
        const text = await r.text();
        let d: Record<string, unknown> = {};
        try { d = JSON.parse(text); } catch { /* ignore parse error */ }
        if (!r.ok) {
          toast.error((d.error as string) || `Failed to load roles: ${r.status} ${r.statusText}`);
          return;
        }
        setRoles((d.roles as { id: string; name: string }[]) ?? []);
      })
      .catch(() => toast.error("Failed to load Discord roles"))
      .finally(() => setRolesLoading(false));
  }, []);

  async function runSync(dry_run: boolean) {
    if (!selectedRole) { toast.error("Select a Discord role"); return; }
    if (!targetWhitelist) { toast.error("Select a target whitelist"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/role-sync/pull", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: selectedRole, whitelist_slug: targetWhitelist, dry_run }),
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* proxy returned plain-text error */ }
      if (!res.ok) throw new Error((data.error as string) || `Server error: ${res.status} ${res.statusText}`);
      setResult(data as unknown as RoleSyncResult);
      if (!dry_run) {
        toast.success(`Pulled ${(data.added as unknown[])?.length ?? 0} members into ${targetWhitelist}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 pt-4">
      {/* How it works info */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm text-muted-foreground">
            Pull all current members of a Discord role into a whitelist. Members are added with
            their Discord ID — they still need to self-register their Steam ID via the bot.
            The bot also automatically adds/removes members in real-time as roles change, and
            runs a daily reconciliation to catch any gaps.
          </p>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Discord Role</Label>
          <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v ?? "")} disabled={rolesLoading}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder={rolesLoading ? "Loading…" : "Select role"} />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="flex items-center gap-2">
                    <Users className="h-3 w-3 opacity-50" />
                    {r.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Target Whitelist</Label>
          <Select value={targetWhitelist} onValueChange={(v) => setTargetWhitelist(v ?? "")}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="Select whitelist" />
            </SelectTrigger>
            <SelectContent>
              {whitelists?.map((wl) => (
                <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2 pb-0.5">
          <Button variant="outline" onClick={() => runSync(true)} disabled={loading}>
            {loading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Preview
          </Button>
          <Button onClick={() => runSync(false)} disabled={loading || !result}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Pull Members
          </Button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              {result.dry_run ? "Preview" : "Result"} — @{result.role_name} → {result.whitelist_slug}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{result.total_role_members} total in role</span>
              <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
                {result.added.length} {result.dry_run ? "would be added" : "added"}
              </span>
              <span className="rounded-md bg-white/5 px-3 py-1 text-xs text-muted-foreground">{result.already_exist} already in whitelist</span>
            </div>

            {result.added.length > 0 && (
              <div className="rounded-lg border border-white/[0.06]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Discord ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.added.slice(0, 100).map((m) => (
                      <TableRow key={m.discord_id}>
                        <TableCell className="text-xs">{m.discord_name}</TableCell>
                        <TableCell className="font-mono text-xs">{m.discord_id}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {result.added.length > 100 && (
                  <p className="px-4 py-2 text-xs text-muted-foreground">Showing 100 of {result.added.length}</p>
                )}
              </div>
            )}

            {result.dry_run && result.added.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Click <strong>Pull Members</strong> to apply these changes.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
