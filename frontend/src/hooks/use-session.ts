"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";

export function useSession() {
  return useQuery<Session>({
    queryKey: ["session"],
    queryFn: () => api.get<Session>("/api/auth/session"),
    staleTime: 60_000,
    retry: false,
  });
}
