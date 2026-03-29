"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Session, PermissionLevel } from "@/lib/types";

export function useSession() {
  return useQuery<Session>({
    queryKey: ["session"],
    queryFn: () => api.get<Session>("/api/auth/session"),
    staleTime: 60_000,
    retry: false,
  });
}

/** Returns the current user's permission level for the active guild. */
export function usePermissionLevel(): PermissionLevel | null {
  const { data } = useSession();
  return data?.permission_level ?? null;
}

/** True if the user can make changes (owner, admin, or roster_manager). */
export function useCanEdit(): boolean {
  const level = usePermissionLevel();
  return level === "owner" || level === "admin" || level === "roster_manager";
}

/** True if the user is an owner or admin (full management access). */
export function useIsAdmin(): boolean {
  const { data } = useSession();
  return data?.is_mod ?? false;
}
