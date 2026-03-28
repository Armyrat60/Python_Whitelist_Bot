"use client";

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
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

  const guilds = useMemo(() => session?.guilds ?? [], [session?.guilds]);

  const activeGuild = useMemo(
    () => guilds.find((g) => g.id === session?.active_guild_id) ?? null,
    [guilds, session?.active_guild_id]
  );

  const switchGuild = useCallback(
    async (guildId: string) => {
      await api.post("/api/guilds/switch", { guild_id: guildId });
      // Clear the entire cache — every endpoint is guild-scoped so stale data
      // from the old guild must not bleed through. clear() removes all entries
      // and React Query will re-fetch active queries immediately on next render.
      queryClient.clear();
    },
    [queryClient]
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
