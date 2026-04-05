"use client";

import { Link2, RefreshCw } from "lucide-react";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

import ImportTab from "@/components/import-export/import-tab";
import ExportTab from "@/components/import-export/export-tab";
import ReconcileTab from "@/components/import-export/reconcile-tab";
import RoleSyncTab from "@/components/import-export/role-sync-tab";

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
