"use client";

import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { MobileSidebar } from "@/components/layout/sidebar";
import { useSession } from "@/hooks/use-session";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { APP_VERSION } from "@/lib/version";

const pageTitles: Record<string, string> = {
  "/dashboard": "Dashboard",
  "/dashboard/panels": "Panels",
  "/dashboard/whitelists": "Whitelists",
  "/dashboard/groups": "Groups",
  "/dashboard/tiers": "Tiers",
  "/dashboard/settings": "Settings",
  "/dashboard/users": "WL Roster",
  "/dashboard/roster": "WL Roster",
  "/dashboard/audit": "Audit Log",
  "/dashboard/import-export": "Import / Export",
  "/my-whitelist": "My Whitelist",
};

function avatarUrl(userId: string, avatar: string) {
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=64`;
}

export function Topbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
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
        <div className="flex items-center gap-2 md:hidden">
          <img src="/logo.png" alt="" className="h-6 w-6 rounded" />
          <span className="text-sm font-bold tracking-wide" style={{ color: "var(--accent-primary)" }}>
            Squad Whitelister
          </span>
        </div>
        <h1 className="hidden text-lg font-semibold md:block">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden rounded border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-muted-foreground sm:inline">
          v{APP_VERSION}
        </span>
        {session && (
          <div className="flex items-center gap-2">
            <Avatar size="sm">
              <AvatarImage
                src={avatarUrl(session.discord_id, session.avatar)}
                alt={session.username}
              />
              <AvatarFallback>
                {session.username.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-sm font-medium sm:inline-block">
              {session.username}
            </span>
          </div>
        )}

        <a href="/logout">
          <Button variant="ghost" size="icon-sm">
            <LogOut className="h-4 w-4" />
            <span className="sr-only">Logout</span>
          </Button>
        </a>
      </div>
    </header>
    {mobileOpen && <MobileSidebar onClose={() => setMobileOpen(false)} />}
    </>
  );
}
