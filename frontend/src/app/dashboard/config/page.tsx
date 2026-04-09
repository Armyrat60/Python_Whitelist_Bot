"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Shield, PanelTop, Layers } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

import WhitelistsTab from "@/components/config/whitelists-tab";
import PanelsTab from "@/components/config/panels-tab";
import GroupsTab from "@/components/config/groups-tab";

const VALID_TABS = ["whitelists", "groups", "panels"] as const;
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
          Manage whitelists, permission groups, and signup panels.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="h-11 gap-1 rounded-xl border border-white/[0.08] bg-card p-1 shadow-sm">
          <TabsTrigger
            value="whitelists"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <Shield className="mr-1.5 h-4 w-4" />
            Whitelists
          </TabsTrigger>
          <TabsTrigger
            value="groups"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <Layers className="mr-1.5 h-4 w-4" />
            Groups
          </TabsTrigger>
          <TabsTrigger
            value="panels"
            className="h-9 px-4 text-sm font-semibold data-active:bg-white/[0.06] data-active:text-foreground data-active:ring-1 data-active:ring-white/[0.10]"
          >
            <PanelTop className="mr-1.5 h-4 w-4" />
            Panels
          </TabsTrigger>
        </TabsList>

        <TabsContent value="whitelists" className="mt-6">
          <WhitelistsTab />
        </TabsContent>
        <TabsContent value="groups" className="mt-6">
          <GroupsTab />
        </TabsContent>
        <TabsContent value="panels" className="mt-6">
          <PanelsTab />
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
