"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useWhitelists } from "@/hooks/use-settings";
import { useGuild } from "@/hooks/use-guild";
import type { Whitelist, WhitelistCategory } from "@/lib/types";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

import CategoryListView from "@/components/manual-roster/category-list";
import EntryView from "@/components/manual-roster/entry-view";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ManualRosterPage() {
  const { activeGuild } = useGuild();
  const { data: whitelists, isLoading: wlLoading } = useWhitelists();

  const manualWhitelists = useMemo(
    () => (whitelists ?? []).filter((wl) => wl.is_manual),
    [whitelists]
  );

  const [view, setView] = useState<"categories" | "entries">("categories");
  const [selectedCat, setSelectedCat] = useState<WhitelistCategory | null>(null);
  const [selectedWhitelist, setSelectedWhitelist] = useState<Whitelist | null>(null);
  const [entryPage, setEntryPage] = useState(1);
  const [entrySearchInput, setEntrySearchInput] = useState("");
  const [entrySearch, setEntrySearch] = useState("");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setEntrySearch(entrySearchInput), 300);
    return () => clearTimeout(t);
  }, [entrySearchInput]);

  // Reset entry page when search or category changes
  useEffect(() => { setEntryPage(1); }, [entrySearch, selectedCat?.id]);

  if (wlLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <div className="space-y-3 mt-6">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ─── Page Header ─────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-xl font-semibold">Manual Roster</h1>
        {activeGuild && (
          <p className="text-sm text-muted-foreground">Managing {activeGuild.name}</p>
        )}
      </div>

      {/* ─── Empty state ─────────────────────────────────────────────────── */}
      {manualWhitelists.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
          <p className="text-sm font-medium">No manual whitelists found</p>
          <p className="mt-1 text-sm text-muted-foreground mb-4">
            Create a manual whitelist first, or import data to auto-create one.
          </p>
          <Link href="/dashboard/config" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Go to Whitelists
          </Link>
        </div>
      ) : (
        <>
          {/* ─── Content ───────────────────────────────────────────────── */}
          {view === "categories" ? (
            <CategoryListView
              whitelists={manualWhitelists}
              onManage={(cat, wl) => {
                setSelectedCat(cat);
                setSelectedWhitelist(wl);
                setView("entries");
              }}
            />
          ) : selectedWhitelist && selectedCat ? (
            <EntryView
              whitelist={selectedWhitelist}
              allWhitelists={manualWhitelists}
              category={selectedCat}
              entryPage={entryPage}
              setEntryPage={setEntryPage}
              searchInput={entrySearchInput}
              setSearchInput={setEntrySearchInput}
              search={entrySearch}
              onBack={() => {
                setView("categories");
                setSelectedCat(null);
                setSelectedWhitelist(null);
                setEntrySearchInput("");
                setEntryPage(1);
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
