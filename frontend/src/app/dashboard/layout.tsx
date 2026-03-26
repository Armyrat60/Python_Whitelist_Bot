"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/hooks/use-session";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  const hasGuilds = session?.guilds && session.guilds.length > 0;

  useEffect(() => {
    if (isLoading) return;
    if (!session?.logged_in) {
      router.replace("/");
      return;
    }
    if (hasGuilds && !session.is_mod) {
      router.replace("/my-whitelist");
    }
  }, [session, isLoading, router, hasGuilds]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-900">
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
    );
  }

  if (!session?.logged_in) {
    return null;
  }

  // No mutual guilds — user's servers aren't registered
  if (!hasGuilds) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-900 px-4 text-center">
        <img src="/logo.png" alt="Squad Whitelister" className="mb-6 h-16 w-16 rounded-xl" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">No Registered Servers</h1>
        <p className="mb-4 max-w-md text-muted-foreground">
          None of your Discord servers have Squad Whitelister installed.
          Ask your server administrator to add the bot first.
        </p>
        <div className="flex gap-3">
          <a href="/logout">
            <button className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-muted-foreground hover:bg-zinc-800">
              Sign Out
            </button>
          </a>
        </div>
      </div>
    );
  }

  if (!session.is_mod) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-zinc-900">
      <Sidebar />
      <div className="flex flex-1 flex-col md:pl-60">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
