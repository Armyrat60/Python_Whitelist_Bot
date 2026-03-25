"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LogOut } from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

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
      <div className="flex min-h-screen items-center justify-center bg-zinc-900">
        <Skeleton className="h-8 w-48" />
      </div>
    );
  }

  if (!session?.logged_in) return null;

  return (
    <div className="flex min-h-screen flex-col bg-zinc-900">
      {/* Simple Topbar */}
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/80 px-6 backdrop-blur-sm">
        <h1 className="text-lg font-semibold">My Whitelist</h1>
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
          <a href="/api/auth/logout">
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
    </div>
  );
}
