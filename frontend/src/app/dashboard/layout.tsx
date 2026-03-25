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

  useEffect(() => {
    if (isLoading) return;
    if (!session?.logged_in) {
      router.replace("/");
      return;
    }
    if (!session.is_mod) {
      router.replace("/my-whitelist");
    }
  }, [session, isLoading, router]);

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

  if (!session?.logged_in || !session.is_mod) {
    return null;
  }

  return (
    <div className="flex min-h-screen bg-zinc-900">
      <Sidebar />
      <div className="flex flex-1 flex-col pl-60">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
