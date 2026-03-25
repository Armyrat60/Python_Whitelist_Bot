"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Upload, Download, FileUp } from "lucide-react";
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
  { value: "auto", label: "Auto-detect" },
  { value: "csv", label: "CSV" },
  { value: "cfg", label: "Squad CFG" },
];

const DUPLICATE_MODES = [
  { value: "skip", label: "Skip duplicates" },
  { value: "overwrite", label: "Overwrite existing" },
  { value: "merge", label: "Merge IDs" },
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
        </TabsList>

        <TabsContent value="import">
          <ImportTab />
        </TabsContent>
        <TabsContent value="export">
          <ExportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT TAB
// ═══════════════════════════════════════════════════════════════════════════

interface PreviewRow {
  discord_id?: string;
  steam_id?: string;
  eos_id?: string;
  status?: string;
}

function ImportTab() {
  const { data: whitelists } = useWhitelists();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [targetWhitelist, setTargetWhitelist] = useState("");
  const [format, setFormat] = useState("auto");
  const [duplicateMode, setDuplicateMode] = useState("skip");
  const [preview, setPreview] = useState<PreviewRow[]>([]);
  const [importing, setImporting] = useState(false);

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  async function handlePreview() {
    if (!targetWhitelist) {
      toast.error("Please select a target whitelist");
      return;
    }

    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      } else if (pasteContent) {
        formData.append("content", pasteContent);
      } else {
        toast.error("Please upload a file or paste content");
        return;
      }
      formData.append("format", format);
      formData.append("whitelist_slug", targetWhitelist);

      const res = await fetch("/api/admin/import/preview", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) throw new Error("Preview failed");
      const data = await res.json();
      setPreview(data.rows ?? []);
      toast.success(`Preview: ${data.rows?.length ?? 0} entries`);
    } catch {
      toast.error("Failed to generate preview");
    }
  }

  async function handleImport() {
    if (!targetWhitelist) return;
    setImporting(true);
    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      } else if (pasteContent) {
        formData.append("content", pasteContent);
      }
      formData.append("format", format);
      formData.append("whitelist_slug", targetWhitelist);
      formData.append("duplicate_mode", duplicateMode);

      const res = await fetch("/api/admin/import", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!res.ok) throw new Error("Import failed");
      const data = await res.json();
      toast.success(`Imported ${data.imported ?? 0} entries`);
      setPreview([]);
      setFile(null);
      setPasteContent("");
    } catch {
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="space-y-6 pt-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* File Upload Zone */}
        <Card>
          <CardHeader>
            <CardTitle>Upload File</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 p-8 text-center transition-colors",
                "hover:border-zinc-500"
              )}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="h-8 w-8 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Drag & drop a file here, or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground">
                    CSV, CFG, or TXT
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".csv,.cfg,.txt"
                onChange={handleFileSelect}
              />
            </div>
          </CardContent>
        </Card>

        {/* Paste Area */}
        <Card>
          <CardHeader>
            <CardTitle>Or Paste Content</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder="Paste whitelist content here..."
              className="min-h-[140px]"
            />
          </CardContent>
        </Card>
      </div>

      {/* Options */}
      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label>Target Whitelist</Label>
          <Select value={targetWhitelist} onValueChange={(v) => setTargetWhitelist(v ?? "")}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select whitelist" />
            </SelectTrigger>
            <SelectContent>
              {whitelists?.map((wl) => (
                <SelectItem key={wl.slug} value={wl.slug}>
                  {wl.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Format</Label>
          <Select value={format} onValueChange={(v) => setFormat(v ?? "auto")}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {IMPORT_FORMATS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Duplicate Handling</Label>
          <Select value={duplicateMode} onValueChange={(v) => setDuplicateMode(v ?? "skip")}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DUPLICATE_MODES.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={handlePreview}>
          Preview Import
        </Button>
        <Button
          onClick={handleImport}
          disabled={importing || (!file && !pasteContent)}
        >
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Import
        </Button>
      </div>

      {/* Preview Table */}
      {preview.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Preview ({preview.length} entries)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-zinc-800">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Discord ID</TableHead>
                    <TableHead>Steam ID</TableHead>
                    <TableHead>EOS ID</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.slice(0, 50).map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">
                        {row.discord_id ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.steam_id ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.eos_id ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">
                        {row.status ?? "new"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.length > 50 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Showing first 50 of {preview.length} entries
              </p>
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
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 px-3 py-2 transition-colors hover:bg-zinc-800/50"
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
