"use client";

import { UserRound, Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function PlayersPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: "color-mix(in srgb, var(--accent-primary) 12%, transparent)" }}
      >
        <UserRound className="h-8 w-8" style={{ color: "var(--accent-primary)" }} />
      </div>
      <h1 className="text-2xl font-bold text-white/90">Player Profiles</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">
        Search for a player to view their profile, or use the Player Search page.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/dashboard/search" className={cn(buttonVariants({ variant: "outline" }))}>
          <Search className="mr-1.5 h-4 w-4" />
          Player Search
        </Link>
      </div>
    </div>
  );
}
