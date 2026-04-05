"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Shield, PanelTop, Layers, ArrowUpDown, Link2, RefreshCw } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

import WhitelistsTab from "@/components/config/whitelists-tab";
import PanelsTab from "@/components/config/panels-tab";
import GroupsTab from "@/components/config/groups-tab";

import ImportTab from "@/components/import-export/import-tab";
import ExportTab from "@/components/import-export/export-tab";
import ReconcileTab from "@/components/import-export/reconcile-tab";
import RoleSyncTab from "@/components/import-export/role-sync-tab";

const VALID_TABS = ["whitelists", "panels", "groups", "import-export"] as const;
type TabValue = (typeof VALID_TABS)[number];

function ConfigTabs() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get("tab");
  const activeTab: TabValue = VALID_TABS.includes(rawTab as TabValue)
    ? (rawTab as TabValue)
    : "whitelists";

  function handleTabChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "whitelists") {
      params.delete("tab");
    } else {
      params.set("tab", value);
    }
    const qs = params.toString();
    router.replace(`/dashboard/config${qs ? `?${qs}` : ""}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configuration</h1>
        <p className="text-sm text-muted-foreground">
          Manage whitelists, signup panels, permission groups, and data imports.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="whitelists">
            <Shield className="mr-1.5 h-3.5 w-3.5" />
            Whitelists
          </TabsTrigger>
          <TabsTrigger value="panels">
            <PanelTop className="mr-1.5 h-3.5 w-3.5" />
            Panels
          </TabsTrigger>
          <TabsTrigger value="groups">
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            Groups
          </TabsTrigger>
          <TabsTrigger value="import-export">
            <ArrowUpDown className="mr-1.5 h-3.5 w-3.5" />
            Import / Export
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whitelists">
          <WhitelistsTab />
        </TabsContent>
        <TabsContent value="panels">
          <PanelsTab />
        </TabsContent>
        <TabsContent value="groups">
          <GroupsTab />
        </TabsContent>
        <TabsContent value="import-export">
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
            <TabsContent value="import"><ImportTab /></TabsContent>
            <TabsContent value="export"><ExportTab /></TabsContent>
            <TabsContent value="reconcile"><ReconcileTab /></TabsContent>
            <TabsContent value="role-sync"><RoleSyncTab /></TabsContent>
          </Tabs>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ConfigPage() {
  return (
    <Suspense fallback={<div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full rounded-xl" /></div>}>
      <ConfigTabs />
    </Suspense>
  );
}
