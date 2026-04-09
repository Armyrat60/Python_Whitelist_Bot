"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Upload, Download, Link2, RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

import ImportTab from "@/components/import-export/import-tab";
import ExportTab from "@/components/import-export/export-tab";
import ReconcileTab from "@/components/import-export/reconcile-tab";
import RoleSyncTab from "@/components/import-export/role-sync-tab";

const VALID_TABS = ["import", "export", "reconcile", "role-sync"] as const;
type TabValue = (typeof VALID_TABS)[number];

function ImportExportTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get("tab");
  const activeTab: TabValue = VALID_TABS.includes(rawTab as TabValue)
    ? (rawTab as TabValue)
    : "import";

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "import") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const qs = params.toString();
    router.replace(`/dashboard/import-export${qs ? `?${qs}` : ""}`, {
      scroll: false,
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import &amp; Export</h1>
        <p className="text-sm text-muted-foreground">
          Bulk import players, export rosters, reconcile manual lists, and sync
          Discord roles.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="h-11 gap-1 rounded-xl border border-white/[0.08] bg-card p-1 shadow-sm">
          <TabsTrigger
            value="import"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <Upload className="mr-1.5 h-4 w-4" />
            Import
          </TabsTrigger>
          <TabsTrigger
            value="export"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </TabsTrigger>
          <TabsTrigger
            value="reconcile"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <Link2 className="mr-1.5 h-4 w-4" />
            Reconcile
          </TabsTrigger>
          <TabsTrigger
            value="role-sync"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Role Sync
          </TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="mt-6">
          <ImportTab />
        </TabsContent>
        <TabsContent value="export" className="mt-6">
          <ExportTab />
        </TabsContent>
        <TabsContent value="reconcile" className="mt-6">
          <ReconcileTab />
        </TabsContent>
        <TabsContent value="role-sync" className="mt-6">
          <RoleSyncTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ImportExportPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      }
    >
      <ImportExportTabs />
    </Suspense>
  );
}
