"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Upload,
  Download,
  FileUp,
  Link2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  UserCheck,
  RefreshCw,
  Users,
  Trash2,
  Clock,
  X,
} from "lucide-react";
import {
  useWhitelists,
} from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

// ─── Tab definition ────────────────────────────────────────────────────────

type Tab = "import-export";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }> }[] = [
  { id: "import-export", label: "Import / Export", icon: Upload },
];

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT — constants & types
// ═══════════════════════════════════════════════════════════════════════════

const IMPORT_FORMATS = [
  { value: "auto",            label: "Auto-detect" },
  { value: "squad_cfg",       label: "Squad Admin CFG  (Admin=steamid:role //name)" },
  { value: "csv",             label: "CSV with headers" },
  { value: "plain_ids",       label: "Plain ID list  (one Steam64 / EOS ID per line)" },
  { value: "discord_members", label: "Discord member list  → use Reconcile tab" },
];

const DUPLICATE_MODES = [
  { value: "skip",      label: "Skip duplicates" },
  { value: "merge",     label: "Merge IDs" },
  { value: "overwrite", label: "Overwrite existing" },
];

const EXPORT_FORMATS = [
  { value: "csv",  label: "CSV" },
  { value: "cfg",  label: "Squad RemoteAdminList" },
  { value: "json", label: "JSON" },
];

const EXPORT_FILTERS = [
  { value: "active",  label: "Active only" },
  { value: "all",     label: "All" },
  { value: "expired", label: "Expired" },
];

interface PreviewUser {
  discord_name?: string;
  discord_id?: string;
  steam_ids?: string[];
  eos_ids?: string[];
  plan?: string;
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
  orphans: number;
}

interface ReconcileResult {
  orphan_discord_id: number;
  orphan_name: string;
  whitelist_slug: string;
  whitelist_name: string;
  identifiers: string[];
  match: { discord_name: string; discord_id: number } | null;
  confidence: number;
}

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


// ═══════════════════════════════════════════════════════════════════════════
// RECONCILE — helper component
// ═══════════════════════════════════════════════════════════════════════════

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 1.0) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)", color: "var(--accent-primary)" }}>Exact</span>;
  if (score >= 0.9) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/15 text-emerald-400">High {Math.round(score * 100)}%</span>;
  if (score >= 0.5) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-400">Low {Math.round(score * 100)}%</span>;
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-white/5 text-muted-foreground">No match</span>;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export function DataContent() {
  const [activeTab, setActiveTab] = useState<Tab>("import-export");

  // ── Import/Export state ──────────────────────────────────────────────────
  const { data: whitelists } = useWhitelists();

  // ImportTab state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
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

  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  function validateAndSetFile(f: File) {
    if (f.size > MAX_FILE_SIZE) {
      toast.error(`File too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`);
      return;
    }
    setImportFile(f);
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
    if (importFile) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string ?? "");
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(importFile);
      });
    }
    return pasteContent;
  }

  async function handlePreview() {
    if (!importFile && !pasteContent.trim()) { toast.error("Upload a file or paste content first"); return; }
    if (!targetWhitelist) { toast.error("Select a target whitelist"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setPreviewing(true);
    try {
      const content = await readContent();
      const res = await fetch("/api/admin/import/preview", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format, whitelist_slug: targetWhitelist }),
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
    if (!importFile && !pasteContent.trim()) { toast.error("Upload a file or paste content first"); return; }
    if (!targetWhitelist) { toast.error("Select a target whitelist"); return; }
    if (format === "discord_members") { toast.error("Discord member lists go in the Reconcile tab"); return; }
    setImporting(true);
    try {
      const content = await readContent();
      const res = await fetch("/api/admin/import", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, format, whitelist_slug: targetWhitelist, duplicate_mode: duplicateMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
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
      setImportFile(null);
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
    setPreview([]); setSummary(null); setImportResult(null); setImportFile(null); setPasteContent("");
  }

  // ExportTab state
  const [selectedSlugs, setSelectedSlugs] = useState<string[]>([]);
  const [exportFormat, setExportFormat] = useState("csv");
  const [exportFilter, setExportFilter] = useState("active");

  function toggleWhitelist(slug: string) {
    setSelectedSlugs((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  }

  async function handleExport() {
    if (selectedSlugs.length === 0) { toast.error("Select at least one whitelist"); return; }
    try {
      const params = new URLSearchParams({ slugs: selectedSlugs.join(","), format: exportFormat, filter: exportFilter });
      const url = `/api/admin/export?${params.toString()}`;
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

  // ReconcileTab state
  const reconcileFileRef = useRef<HTMLInputElement>(null);
  const [reconcileFile, setReconcileFile] = useState<File | null>(null);
  const [reconcilePaste, setReconcilePaste] = useState("");
  const [reconcilePreviewing, setReconcilePreviewing] = useState(false);
  const [reconcileApplying, setReconcileApplying] = useState(false);
  const [reconcileResults, setReconcileResults] = useState<ReconcileResult[] | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(0);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [overrideId, setOverrideId] = useState<Record<number, string>>({});
  const [overrideName, setOverrideName] = useState<Record<number, string>>({});

  function handleReconcileFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setReconcileFile(f); setReconcilePaste(""); }
  }

  async function handleReconcilePreview() {
    setReconcilePreviewing(true);
    setReconcileResults(null);
    try {
      const formData = new FormData();
      if (reconcileFile) {
        formData.append("file", reconcileFile);
      } else if (reconcilePaste.trim()) {
        formData.append("content", reconcilePaste);
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
      setReconcileResults(data.results ?? []);
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
      setReconcilePreviewing(false);
    }
  }

  async function handleReconcileApply() {
    if (!reconcileResults) return;
    setReconcileApplying(true);
    try {
      const matches = reconcileResults
        .filter((r) => checked[r.orphan_discord_id])
        .map((r) => {
          const oid = overrideId[r.orphan_discord_id];
          const oname = overrideName[r.orphan_discord_id];
          const realId = oid ? parseInt(oid) : r.match?.discord_id ?? 0;
          const realName = oname || r.match?.discord_name || r.orphan_name;
          return { orphan_discord_id: r.orphan_discord_id, real_discord_id: realId, real_discord_name: realName };
        })
        .filter((m) => m.real_discord_id > 0);
      if (matches.length === 0) { toast.error("No valid matches selected"); return; }
      const res = await fetch("/api/admin/reconcile/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");
      toast.success(`Applied ${data.applied} match(es) — ${data.errors} error(s)`);
      setReconcileResults(null);
      setReconcileFile(null);
      setReconcilePaste("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setReconcileApplying(false);
    }
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  // RoleSyncTab state
  const [roles, setRoles] = useState<{ id: string; name: string }[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState("");
  const [roleSyncTargetWhitelist, setRoleSyncTargetWhitelist] = useState("");
  const [roleSyncResult, setRoleSyncResult] = useState<RoleSyncResult | null>(null);
  const [roleSyncLoading, setRoleSyncLoading] = useState(false);

  useEffect(() => {
    if (!whitelists?.length || roleSyncTargetWhitelist) return;
    const def = whitelists.find((w: { slug: string }) => w.slug === "default") ?? whitelists[0];
    if (def) setRoleSyncTargetWhitelist(def.slug);
  }, [whitelists]);

  useEffect(() => {
    setRolesLoading(true);
    fetch("/api/admin/roles", { credentials: "include" })
      .then(async (r) => {
        const text = await r.text();
        let d: Record<string, unknown> = {};
        try { d = JSON.parse(text); } catch { /* ignore parse error */ }
        if (!r.ok) { toast.error((d.error as string) || `Failed to load roles: ${r.status} ${r.statusText}`); return; }
        setRoles((d.roles as { id: string; name: string }[]) ?? []);
      })
      .catch(() => toast.error("Failed to load Discord roles"))
      .finally(() => setRolesLoading(false));
  }, []);

  async function runRoleSync(dry_run: boolean) {
    if (!selectedRole) { toast.error("Select a Discord role"); return; }
    if (!roleSyncTargetWhitelist) { toast.error("Select a target whitelist"); return; }
    setRoleSyncLoading(true);
    try {
      const res = await fetch("/api/admin/role-sync/pull", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: selectedRole, whitelist_slug: roleSyncTargetWhitelist, dry_run }),
      });
      const text = await res.text();
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(text); } catch { /* proxy returned plain-text error */ }
      if (!res.ok) throw new Error((data.error as string) || `Server error: ${res.status} ${res.statusText}`);
      setRoleSyncResult(data as unknown as RoleSyncResult);
      if (!dry_run) {
        toast.success(`Pulled ${(data.added as unknown[])?.length ?? 0} members into ${roleSyncTargetWhitelist}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Role sync failed");
    } finally {
      setRoleSyncLoading(false);
    }
  }

  // Audit tab has been moved to Settings > Audit Log

  // ── Render ───────────────────────────────────────────────────────────────

  const hasImportData = !!(importFile || pasteContent.trim());

  return (
    <div>
      {/* Tab nav */}
      <div className="flex gap-1 border-b border-white/[0.10] mb-6">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
                active
                  ? "border-[var(--accent-primary)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground/80"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          IMPORT / EXPORT TAB
      ══════════════════════════════════════════════════════════════════ */}
      {activeTab === "import-export" && (
        <div className="space-y-6">
          {/* Inner sub-tabs using shadcn Tabs (preserved from original) */}
          <ImportExportContent
            whitelists={whitelists}
            fileInputRef={fileInputRef}
            isDragOver={isDragOver}
            setIsDragOver={setIsDragOver}
            importFile={importFile}
            pasteContent={pasteContent}
            setPasteContent={setPasteContent}
            targetWhitelist={targetWhitelist}
            setTargetWhitelist={setTargetWhitelist}
            format={format}
            setFormat={setFormat}
            duplicateMode={duplicateMode}
            setDuplicateMode={setDuplicateMode}
            preview={preview}
            summary={summary}
            importResult={importResult}
            importing={importing}
            previewing={previewing}
            hasImportData={hasImportData}
            onFileDrop={handleFileDrop}
            onFileSelect={handleFileSelect}
            onPreview={handlePreview}
            onImport={handleImport}
            onReset={handleReset}
            // Export
            selectedSlugs={selectedSlugs}
            exportFormat={exportFormat}
            setExportFormat={setExportFormat}
            exportFilter={exportFilter}
            setExportFilter={setExportFilter}
            toggleWhitelist={toggleWhitelist}
            onExport={handleExport}
            // Reconcile
            reconcileFileRef={reconcileFileRef}
            reconcileFile={reconcileFile}
            reconcilePaste={reconcilePaste}
            setReconcilePaste={setReconcilePaste}
            reconcilePreviewing={reconcilePreviewing}
            reconcileApplying={reconcileApplying}
            reconcileResults={reconcileResults}
            membersLoaded={membersLoaded}
            checked={checked}
            setChecked={setChecked}
            overrideId={overrideId}
            setOverrideId={setOverrideId}
            overrideName={overrideName}
            setOverrideName={setOverrideName}
            checkedCount={checkedCount}
            onReconcileFileSelect={handleReconcileFileSelect}
            onReconcilePreview={handleReconcilePreview}
            onReconcileApply={handleReconcileApply}
            // Role sync
            roles={roles}
            rolesLoading={rolesLoading}
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            roleSyncTargetWhitelist={roleSyncTargetWhitelist}
            setRoleSyncTargetWhitelist={setRoleSyncTargetWhitelist}
            roleSyncResult={roleSyncResult}
            roleSyncLoading={roleSyncLoading}
            onRunRoleSync={runRoleSync}
          />
        </div>
      )}

      {/* Audit Log has been moved to its own Settings tab */}

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT / EXPORT — inline content component (avoids re-declaring sub-tabs
// as top-level exports; keeps all logic in the parent for shared state)
// ═══════════════════════════════════════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ImportExportContent(props: any) {
  const {
    whitelists,
    fileInputRef,
    isDragOver, setIsDragOver,
    importFile,
    pasteContent, setPasteContent,
    targetWhitelist, setTargetWhitelist,
    format, setFormat,
    duplicateMode, setDuplicateMode,
    preview, summary, importResult,
    importing, previewing, hasImportData,
    onFileDrop, onFileSelect, onPreview, onImport, onReset,
    // export
    selectedSlugs, exportFormat, setExportFormat, exportFilter, setExportFilter,
    toggleWhitelist, onExport,
    // reconcile
    reconcileFileRef, reconcileFile, reconcilePaste, setReconcilePaste,
    reconcilePreviewing, reconcileApplying, reconcileResults,
    membersLoaded, checked, setChecked, overrideId, setOverrideId,
    overrideName, setOverrideName, checkedCount,
    onReconcileFileSelect, onReconcilePreview, onReconcileApply,
    // role sync
    roles, rolesLoading, selectedRole, setSelectedRole,
    roleSyncTargetWhitelist, setRoleSyncTargetWhitelist,
    roleSyncResult, roleSyncLoading, onRunRoleSync,
  } = props;

  const [innerTab, setInnerTab] = useState<"import" | "export" | "reconcile" | "role-sync">("import");

  const INNER_TABS = [
    { id: "import" as const,    label: "Import" },
    { id: "export" as const,    label: "Export" },
    { id: "reconcile" as const, label: "Reconcile" },
    { id: "role-sync" as const, label: "Role Sync" },
  ];

  return (
    <div className="space-y-4">
      {/* Inner tab nav */}
      <div className="flex gap-1 border-b border-white/[0.10]">
        {INNER_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setInnerTab(t.id)}
            className={cn(
              "border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
              innerTab === t.id
                ? "border-[var(--accent-primary)] text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground/80"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Import ── */}
      {innerTab === "import" && (
        <div className="space-y-4 pt-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Target Whitelist</Label>
              <Select value={targetWhitelist} onValueChange={(v) => setTargetWhitelist(v ?? "")}>
                <SelectTrigger className="w-44"><SelectValue placeholder="Select whitelist" /></SelectTrigger>
                <SelectContent>
                  {whitelists?.map((wl: { slug: string; name: string }) => (
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
              <Button variant="outline" onClick={onPreview} disabled={!hasImportData || previewing}>
                {previewing ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Previewing…</> : "Preview"}
              </Button>
              <Button onClick={onImport} disabled={importing || !hasImportData}>
                {importing
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Importing…</>
                  : <><Upload className="mr-1.5 h-3.5 w-3.5" />Import</>}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-sm font-medium">Upload File</CardTitle></CardHeader>
              <CardContent>
                <div
                  className={cn(
                    "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors select-none",
                    isDragOver
                      ? "border-[color:var(--accent-primary)] bg-[color:var(--accent-primary)]/5"
                      : importFile
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-white/[0.10] hover:border-white/[0.22]"
                  )}
                  onDragOver={(e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={onFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className={cn("h-8 w-8", importFile ? "text-emerald-400" : "text-muted-foreground")} />
                  {importFile
                    ? <p className="text-sm font-medium text-emerald-400">{importFile.name}</p>
                    : <>
                        <p className="text-sm text-muted-foreground">Drag &amp; drop a file here, or click to browse</p>
                        <p className="text-xs text-muted-foreground">CSV · CFG · TXT</p>
                      </>
                  }
                  <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.cfg,.txt" onChange={onFileSelect} />
                </div>
                {importFile && (
                  <button className="mt-2 text-xs text-muted-foreground hover:text-white" onClick={(e: React.MouseEvent) => { e.stopPropagation(); /* handled in parent */ }}>
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
                  onChange={(e) => { setPasteContent(e.target.value); }}
                  placeholder={"Paste any format:\n\nAdmin=76561198212353664:reserve //Name\n76561198212353664\ndiscord_name,steam_id\nname,discord_id  ← use Reconcile tab"}
                  className="min-h-[148px] font-mono text-xs"
                />
              </CardContent>
            </Card>
          </div>

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
                  <Button size="sm" variant="outline" className="ml-auto" onClick={onReset}>New Import</Button>
                </div>
                {importResult.orphans > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    These entries have Steam IDs but no Discord account linked yet. Members can claim their record when they click the panel, or use the <strong>Reconcile</strong> tab to match them manually.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {summary && !importResult && (
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{summary.total_users} total</span>
              <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">{summary.new} new</span>
              {summary.existing > 0 && <span className="rounded-md bg-amber-500/10 px-3 py-1 text-xs text-amber-400">{summary.existing} existing</span>}
              {summary.invalid > 0 && <span className="rounded-md bg-red-500/10 px-3 py-1 text-xs text-red-400">{summary.invalid} invalid</span>}
              <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{summary.total_ids} IDs</span>
            </div>
          )}

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
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.slice(0, 200).map((user: PreviewUser, i: number) => {
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
      )}

      {/* ── Export ── */}
      {innerTab === "export" && (
        <div className="space-y-6 pt-4">
          <Card>
            <CardHeader><CardTitle>Select Whitelists</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {whitelists?.map((wl: { slug: string; name: string; enabled: boolean }) => (
                  <label
                    key={wl.slug}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.10] px-3 py-2 transition-colors hover:bg-white/5"
                  >
                    <Checkbox
                      checked={selectedSlugs.includes(wl.slug)}
                      onCheckedChange={() => toggleWhitelist(wl.slug)}
                    />
                    <span className="text-sm font-medium">{wl.name}</span>
                    {!wl.enabled && <span className="text-xs text-muted-foreground">(disabled)</span>}
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>Format</Label>
              <Select value={exportFormat} onValueChange={(v) => setExportFormat(v ?? "csv")}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPORT_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Filter</Label>
              <Select value={exportFilter} onValueChange={(v) => setExportFilter(v ?? "active")}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPORT_FILTERS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={onExport} disabled={selectedSlugs.length === 0}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Download Export
          </Button>
        </div>
      )}

      {/* ── Reconcile ── */}
      {innerTab === "reconcile" && (
        <div className="space-y-6 pt-4">
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

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Upload Discord Member List</CardTitle></CardHeader>
              <CardContent>
                <div
                  className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/[0.10] p-8 text-center transition-colors hover:border-white/[0.20] cursor-pointer"
                  onClick={() => reconcileFileRef.current?.click()}
                >
                  <FileUp className="h-8 w-8 text-muted-foreground" />
                  {reconcileFile ? (
                    <p className="text-sm font-medium">{reconcileFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">Click to upload a <span className="font-mono">User,ID</span> CSV / TXT</p>
                      <p className="text-xs text-muted-foreground">e.g. exported from Discord server member list</p>
                    </>
                  )}
                  <input ref={reconcileFileRef} type="file" className="hidden" accept=".csv,.txt" onChange={onReconcileFileSelect} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Or Paste Member List</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={reconcilePaste}
                  onChange={(e) => { setReconcilePaste(e.target.value); }}
                  placeholder={"User,ID\narmyrat60,268871213479231489\ngreyhat12334,1286894254710329457\n..."}
                  className="min-h-[140px] font-mono text-xs"
                />
              </CardContent>
            </Card>
          </div>

          <Button onClick={onReconcilePreview} disabled={reconcilePreviewing || (!reconcileFile && !reconcilePaste.trim())}>
            {reconcilePreviewing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
            Preview Matches
          </Button>

          {reconcileResults !== null && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Match Results</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {reconcileResults.length} orphan(s) found · {membersLoaded} members loaded · {checkedCount} selected
                  </p>
                </div>
                <Button
                  onClick={onReconcileApply}
                  disabled={reconcileApplying || checkedCount === 0}
                  size="sm"
                  style={{ background: "var(--accent-primary)", color: "#000" }}
                >
                  {reconcileApplying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                  Apply {checkedCount} Match{checkedCount !== 1 ? "es" : ""}
                </Button>
              </CardHeader>
              <CardContent>
                {reconcileResults.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No orphan records found — all entries are already linked to Discord members.</p>
                ) : (
                  <div className="rounded-lg border border-white/[0.10]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 cursor-pointer rounded"
                              checked={checkedCount === reconcileResults.length && reconcileResults.length > 0}
                              onChange={(e) => {
                                const all: Record<number, boolean> = {};
                                reconcileResults.forEach((r: ReconcileResult) => { all[r.orphan_discord_id] = e.target.checked; });
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
                        {reconcileResults.map((r: ReconcileResult) => (
                          <TableRow key={r.orphan_discord_id} className={checked[r.orphan_discord_id] ? "row-selected" : "row-hover"}>
                            <TableCell>
                              <input
                                type="checkbox"
                                className="h-3.5 w-3.5 cursor-pointer rounded"
                                checked={!!checked[r.orphan_discord_id]}
                                onChange={(e) => setChecked((prev: Record<number, boolean>) => ({ ...prev, [r.orphan_discord_id]: e.target.checked }))}
                              />
                            </TableCell>
                            <TableCell className="font-medium">{r.orphan_name || <span className="text-muted-foreground">(unknown)</span>}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">{r.whitelist_name}</TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {r.identifiers.length > 0 ? r.identifiers.map((id: string) => (
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
                                  onChange={(e) => setOverrideId((prev: Record<number, string>) => ({ ...prev, [r.orphan_discord_id]: e.target.value }))}
                                />
                                <Input
                                  placeholder="Discord name"
                                  className="h-6 w-40 text-xs"
                                  value={overrideName[r.orphan_discord_id] ?? ""}
                                  onChange={(e) => setOverrideName((prev: Record<number, string>) => ({ ...prev, [r.orphan_discord_id]: e.target.value }))}
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
      )}

      {/* ── Role Sync ── */}
      {innerTab === "role-sync" && (
        <div className="space-y-4 pt-4">
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

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label>Discord Role</Label>
              <Select value={selectedRole} onValueChange={(v) => setSelectedRole(v ?? "")} disabled={rolesLoading}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder={rolesLoading ? "Loading…" : "Select role"} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r: { id: string; name: string }) => (
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
              <Select value={roleSyncTargetWhitelist} onValueChange={(v) => setRoleSyncTargetWhitelist(v ?? "")}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Select whitelist" />
                </SelectTrigger>
                <SelectContent>
                  {whitelists?.map((wl: { slug: string; name: string }) => (
                    <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 pb-0.5">
              <Button variant="outline" onClick={() => onRunRoleSync(true)} disabled={roleSyncLoading}>
                {roleSyncLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Preview
              </Button>
              <Button onClick={() => onRunRoleSync(false)} disabled={roleSyncLoading || !roleSyncResult}>
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Pull Members
              </Button>
            </div>
          </div>

          {roleSyncResult && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  {roleSyncResult.dry_run ? "Preview" : "Result"} — @{roleSyncResult.role_name} → {roleSyncResult.whitelist_slug}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-md bg-white/5 px-3 py-1 text-xs">{roleSyncResult.total_role_members} total in role</span>
                  <span className="rounded-md bg-emerald-500/10 px-3 py-1 text-xs text-emerald-400">
                    {roleSyncResult.added.length} {roleSyncResult.dry_run ? "would be added" : "added"}
                  </span>
                  <span className="rounded-md bg-white/5 px-3 py-1 text-xs text-muted-foreground">{roleSyncResult.already_exist} already in whitelist</span>
                </div>

                {roleSyncResult.added.length > 0 && (
                  <div className="rounded-lg border border-white/[0.10]">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Discord ID</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {roleSyncResult.added.slice(0, 100).map((m: RoleSyncMember) => (
                          <TableRow key={m.discord_id}>
                            <TableCell className="text-xs">{m.discord_name}</TableCell>
                            <TableCell className="font-mono text-xs">{m.discord_id}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {roleSyncResult.added.length > 100 && (
                      <p className="px-4 py-2 text-xs text-muted-foreground">Showing 100 of {roleSyncResult.added.length}</p>
                    )}
                  </div>
                )}

                {roleSyncResult.dry_run && roleSyncResult.added.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Click <strong>Pull Members</strong> to apply these changes.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

export default function DataPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Data &amp; Logs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import, export, audit history and integrations
        </p>
      </div>
      <DataContent />
    </div>
  );
}
