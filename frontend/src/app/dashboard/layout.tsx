"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useSession } from "@/hooks/use-session";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

import { DashboardFooter } from "@/components/layout/dashboard-footer";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { data: session, isLoading } = useSession();

  const hasGuilds = session?.guilds && session.guilds.length > 0;

  const permissionLevel = session?.permission_level;
  const canAccessDashboard = session?.is_mod || permissionLevel === "roster_manager";

  useEffect(() => {
    if (isLoading) return;
    if (!session?.logged_in) {
      router.replace("/");
      return;
    }
    if (hasGuilds && !canAccessDashboard) {
      router.replace("/my-whitelist");
    }
  }, [session, isLoading, router, hasGuilds, canAccessDashboard]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
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
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <Image src="/logo.png" alt="Squad Whitelister" width={64} height={64} className="mb-6 rounded-xl" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">No Servers Found</h1>
        <p className="mb-4 max-w-md text-muted-foreground">
          None of your Discord servers have Squad Whitelister set up.
          You must be an owner, administrator, or have Manage Server permission on a server where the bot is installed.
        </p>
        <div className="flex gap-3">
          <a href="/my-whitelist">
            <button className="rounded-lg px-4 py-2 text-sm font-medium text-black" style={{ background: "var(--accent-primary)" }}>
              My Whitelist
            </button>
          </a>
          <a href="/logout">
            <button className="rounded-lg border border-white/[0.10] px-4 py-2 text-sm text-muted-foreground hover:bg-white/5">
              Sign Out
            </button>
          </a>
        </div>
      </div>
    );
  }

  if (!canAccessDashboard) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
        <Image src="/logo.png" alt="Squad Whitelister" width={64} height={64} className="mb-6 rounded-xl" />
        <h1 className="mb-2 text-2xl font-bold text-foreground">Access Denied</h1>
        <p className="mb-4 max-w-md text-muted-foreground">
          You don&apos;t have permission to access the admin dashboard.
          Contact your server administrator if you believe this is an error.
        </p>
        <div className="flex gap-3">
          <a href="/my-whitelist">
            <button className="rounded-lg px-4 py-2 text-sm font-medium text-black" style={{ background: "var(--accent-primary)" }}>
              My Whitelist
            </button>
          </a>
          <a href="/logout">
            <button className="rounded-lg border border-white/[0.10] px-4 py-2 text-sm text-muted-foreground hover:bg-white/5">
              Sign Out
            </button>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col md:pl-60">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        <DashboardFooter />
      </div>
    </div>
  );
}
