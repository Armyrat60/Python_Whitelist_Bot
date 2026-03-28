"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { api } from "@/lib/api";
import type { Guild } from "@/lib/types";

interface GuildContextValue {
  activeGuild: Guild | null;
  guilds: Guild[];
  switchGuild: (guildId: string) => Promise<void>;
}

const GuildContext = createContext<GuildContextValue | null>(null);

export function GuildProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const guilds = useMemo(() => session?.guilds ?? [], [session?.guilds]);

  const activeGuild = useMemo(
    () => guilds.find((g) => g.id === session?.active_guild_id) ?? null,
    [guilds, session?.active_guild_id]
  );

  const switchGuild = useCallback(
    async (guildId: string) => {
      await api.post("/api/guilds/switch", { guild_id: guildId });
      // Remove all cached guild-scoped data so the old guild's data doesn't bleed through.
      // Then call router.refresh() which causes Next.js to re-render the component tree,
      // at which point React Query observers see the empty cache and re-fetch everything.
      queryClient.clear();
      router.refresh();
    },
    [queryClient, router]
  );

  const value = useMemo(
    () => ({ activeGuild, guilds, switchGuild }),
    [activeGuild, guilds, switchGuild]
  );

  return (
    <GuildContext.Provider value={value}>{children}</GuildContext.Provider>
  );
}

export function useGuild(): GuildContextValue {
  const ctx = useContext(GuildContext);
  if (!ctx) {
    throw new Error("useGuild must be used within a GuildProvider");
  }
  return ctx;
}
