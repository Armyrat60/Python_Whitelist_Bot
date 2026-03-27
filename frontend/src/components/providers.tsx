"use client";

import { useState, useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GuildProvider } from "@/hooks/use-guild";
import { AccentProvider, useAccent } from "@/components/accent-context";
import { useOrgTheme } from "@/hooks/use-settings";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * Fetches the active guild's org theme and applies it to the accent context.
 * Sits inside both AccentProvider and GuildProvider so it has access to both.
 * When the guild switches, React Query's invalidateQueries() re-fetches automatically.
 */
function OrgThemeSync() {
  const { data } = useOrgTheme();
  const { setOrgColors, clearOrgColors } = useAccent();

  useEffect(() => {
    if (data?.accent_primary && data?.accent_secondary) {
      setOrgColors(data.accent_primary, data.accent_secondary);
    } else {
      clearOrgColors();
    }
  }, [data, setOrgColors, clearOrgColors]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        disableTransitionOnChange
      >
        <TooltipProvider>
          <AccentProvider>
            <GuildProvider>
              <OrgThemeSync />
              {children}
            </GuildProvider>
          </AccentProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
