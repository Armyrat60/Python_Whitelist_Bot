"use client";

import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Menu, X, Search, UserRound } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { MobileSidebar } from "@/components/layout/sidebar";
import { useSession } from "@/hooks/use-session";
import { useGuild } from "@/hooks/use-guild";
import { usePlayerSearch } from "@/hooks/use-settings";
import type { PlayerSearchResult } from "@/hooks/use-settings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { NotificationBell } from "@/components/layout/system-alerts";
import { cn } from "@/lib/utils";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/config": "Configuration",
  "/dashboard/settings": "Settings",
  "/dashboard/users": "Discord Roster",
  "/dashboard/manual-roster": "Manual Roster",
  "/dashboard/conflicts": "Steam ID Conflicts",
  "/dashboard/search": "Player Search",
  "/dashboard/logs": "Audit Logs",
  "/dashboard/leaderboard": "Player Leaderboard",
  "/dashboard/servers": "Live Server",
  "/dashboard/seeding": "Seeding Dashboard",
  "/dashboard/seeding/leaderboard": "Seeding Leaderboard",
  "/dashboard/seeding/settings": "Seeding Configuration",
  "/dashboard/import-export": "Import / Export",
  "/my-whitelist": "My Whitelist",
};


function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { data, isLoading } = usePlayerSearch(query);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const players = data?.players ?? [];

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative hidden md:block">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
          placeholder="Search players..."
          className="h-8 w-56 pl-8 text-xs bg-white/[0.04] border-white/[0.08] focus:w-72 transition-all"
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div
          className="absolute left-0 top-full z-50 mt-1.5 w-80 max-h-80 overflow-y-auto rounded-xl border border-white/[0.08] shadow-xl"
          style={{ background: "oklch(0.18 0 0)" }}
        >
          {isLoading ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">Searching...</div>
          ) : players.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">No players found</div>
          ) : (
            <div className="divide-y divide-white/[0.04]">
              {players.slice(0, 8).map((p) => (
                <Link
                  key={p.discord_id}
                  href={`/dashboard/players/${p.discord_id}`}
                  onClick={() => { setOpen(false); setQuery(""); }}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/[0.06]"
                >
                  <div
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                    style={{ background: "color-mix(in srgb, var(--accent-primary) 10%, transparent)" }}
                  >
                    <UserRound className="h-3.5 w-3.5" style={{ color: "var(--accent-primary)" }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-white/90">{p.discord_name}</p>
                    <p className="truncate text-[10px] font-mono text-muted-foreground">
                      {p.steam_ids[0] || p.discord_id}
                    </p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {p.memberships.filter((m) => m.status === "active").length} active
                  </span>
                </Link>
              ))}
              {players.length > 8 && (
                <button
                  onClick={() => { router.push(`/dashboard/search?q=${encodeURIComponent(query)}`); setOpen(false); setQuery(""); }}
                  className="w-full px-3 py-2 text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all {players.length} results
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { activeGuild } = useGuild();
  const [mobileOpen, setMobileOpen] = useState(false);

  const title = pageTitles[pathname] ?? "Dashboard";

  return (
    <>
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.06] px-4 md:px-6 backdrop-blur-md"
      style={{ background: "oklch(0.195 0 0 / 0.88)" }}>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        {/* Brand shown on mobile (sidebar is hidden) */}
        <Link href="/dashboard" className="flex items-center gap-2 md:hidden">
          <Image src="/logo.png" alt="Squad Whitelister" width={24} height={24} className="rounded" />
          <span className="text-sm font-bold tracking-wide" style={{ color: "var(--accent-primary)" }}>
            Squad Whitelister
          </span>
        </Link>
        <div className="hidden min-w-0 flex-col md:flex">
          <h1 className="truncate text-lg font-semibold">{title}</h1>
          {activeGuild ? (
            <p className="truncate text-xs text-muted-foreground">
              Managing <span className="font-medium text-foreground/85">{activeGuild.name}</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <GlobalSearch />
        <NotificationBell />
      </div>
    </header>
    {mobileOpen && <MobileSidebar onClose={() => setMobileOpen(false)} />}
    </>
  );
}
