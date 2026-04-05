"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { useWhitelists } from "@/hooks/use-settings";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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

export default function ExportTab() {
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
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.10] px-3 py-2 transition-colors hover:bg-white/5"
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
