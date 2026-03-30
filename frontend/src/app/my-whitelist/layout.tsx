"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogOut, LayoutDashboard } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { GuildSwitcher } from "@/components/layout/guild-switcher";
import { DashboardFooter } from "@/components/layout/dashboard-footer";

function avatarUrl(userId: string, avatar: string) {
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=64`;
}

export default function MyWhitelistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && !session?.logged_in) {
      router.replace("/");
    }
  }, [session, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!session?.logged_in) return null;

  // No mutual guilds
  if (!session.guilds || session.guilds.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <img src="/logo.png" alt="Squad Whitelister" className="mb-6 h-16 w-16 rounded-xl" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">No Registered Servers</h1>
        <p className="mb-4 max-w-md text-muted-foreground">
          None of your Discord servers have Squad Whitelister installed.
          Ask your server administrator to add the bot first.
        </p>
        <a href="/logout">
          <button className="rounded-lg border border-white/[0.10] px-4 py-2 text-sm text-muted-foreground hover:bg-white/5">
            Sign Out
          </button>
        </a>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Simple Topbar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-white/[0.06] px-6 backdrop-blur-md"
        style={{ background: "oklch(0.195 0 0 / 0.88)" }}>
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">My Whitelist</h1>
          <GuildSwitcher />
          {(session.is_mod || session.permission_level === "roster_manager") && (
            <a href="/dashboard">
              <Button variant="outline" size="sm">
                <LayoutDashboard className="mr-1.5 h-3.5 w-3.5" />
                Dashboard
              </Button>
            </a>
          )}
        </div>
        <div className="flex items-center gap-3">
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
          <a href="/logout">
            <Button variant="ghost" size="icon-sm">
              <LogOut className="h-4 w-4" />
              <span className="sr-only">Logout</span>
            </Button>
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 p-6">
        {children}
      </main>
      <DashboardFooter />
    </div>
  );
}
