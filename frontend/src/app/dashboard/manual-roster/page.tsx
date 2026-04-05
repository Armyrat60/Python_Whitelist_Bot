"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useWhitelists } from "@/hooks/use-settings";
import { useGuild } from "@/hooks/use-guild";
import type { Whitelist, WhitelistCategory } from "@/lib/types";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

import CategoryListView from "@/components/manual-roster/category-list";
import EntryView from "@/components/manual-roster/entry-view";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ManualRosterPage() {
  const { activeGuild } = useGuild();
  const { data: whitelists, isLoading: wlLoading } = useWhitelists();

  const manualWhitelists = useMemo(
    () => whitelists?.filter((wl) => wl.is_manual) ?? [],
    [whitelists]
  );

  const [selectedWhitelistId, setSelectedWhitelistId] = useState<number | null>(null);
  const [view, setView] = useState<"categories" | "entries">("categories");
  const [selectedCat, setSelectedCat] = useState<WhitelistCategory | null>(null);
  const [entryPage, setEntryPage] = useState(1);
  const [entrySearchInput, setEntrySearchInput] = useState("");
  const [entrySearch, setEntrySearch] = useState("");

  // Auto-select first manual whitelist on load
  useEffect(() => {
    if (manualWhitelists.length > 0 && selectedWhitelistId === null) {
      setSelectedWhitelistId(manualWhitelists[0].id);
    }
  }, [manualWhitelists, selectedWhitelistId]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setEntrySearch(entrySearchInput), 300);
    return () => clearTimeout(t);
  }, [entrySearchInput]);

  // Reset entry page when search or category changes
  useEffect(() => { setEntryPage(1); }, [entrySearch, selectedCat?.id]);

  const selectedWhitelist = manualWhitelists.find((wl) => wl.id === selectedWhitelistId) ?? null;

  if (wlLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
        <div className="space-y-3 mt-6">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
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
          <p className="text-sm font-medium">No manual rosters configured</p>
          <p className="mt-1 text-xs text-muted-foreground mb-4">
            Go to Whitelists to create one.
          </p>
          <Link href="/dashboard/whitelists" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Go to Whitelists
          </Link>
        </div>
      ) : (
        <>
          {/* ─── Whitelist selector (if multiple) ──────────────────────── */}
          {manualWhitelists.length > 1 && (
            <div className="flex items-center gap-3">
              <Label className="text-sm shrink-0">Roster</Label>
              <Select
                value={selectedWhitelistId !== null ? String(selectedWhitelistId) : ""}
                onValueChange={(val) => {
                  setSelectedWhitelistId(Number(val));
                  setView("categories");
                  setSelectedCat(null);
                }}
              >
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select roster" />
                </SelectTrigger>
                <SelectContent>
                  {manualWhitelists.map((wl) => (
                    <SelectItem key={wl.id} value={String(wl.id)}>
                      {wl.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* ─── Content ───────────────────────────────────────────────── */}
          {selectedWhitelist && (
            <RosterContent
              whitelist={selectedWhitelist}
              view={view}
              setView={setView}
              selectedCat={selectedCat}
              setSelectedCat={setSelectedCat}
              entryPage={entryPage}
              setEntryPage={setEntryPage}
              entrySearchInput={entrySearchInput}
              setEntrySearchInput={setEntrySearchInput}
              entrySearch={entrySearch}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── RosterContent ────────────────────────────────────────────────────────────

function RosterContent({
  whitelist,
  view,
  setView,
  selectedCat,
  setSelectedCat,
  entryPage,
  setEntryPage,
  entrySearchInput,
  setEntrySearchInput,
  entrySearch,
}: {
  whitelist: Whitelist;
  view: "categories" | "entries";
  setView: (v: "categories" | "entries") => void;
  selectedCat: WhitelistCategory | null;
  setSelectedCat: (c: WhitelistCategory | null) => void;
  entryPage: number;
  setEntryPage: (p: number) => void;
  entrySearchInput: string;
  setEntrySearchInput: (s: string) => void;
  entrySearch: string;
}) {
  if (view === "categories") {
    return (
      <CategoryListView
        whitelist={whitelist}
        onManage={(cat) => {
          setSelectedCat(cat);
          setView("entries");
        }}
      />
    );
  }

  return (
    <EntryView
      whitelist={whitelist}
      category={selectedCat!}
      entryPage={entryPage}
      setEntryPage={setEntryPage}
      searchInput={entrySearchInput}
      setSearchInput={setEntrySearchInput}
      search={entrySearch}
      onBack={() => {
        setView("categories");
        setSelectedCat(null);
        setEntrySearchInput("");
        setEntryPage(1);
      }}
    />
  );
}
