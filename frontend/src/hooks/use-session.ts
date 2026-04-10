"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Session, PermissionLevel, GranularPermissions } from "@/lib/types";

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

/** True if the user can make changes (owner, admin, roster_manager, or granular with manage_users). */
export function useCanEdit(): boolean {
  const { data } = useSession();
  const level = data?.permission_level;
  if (level === "owner" || level === "admin" || level === "roster_manager") return true;
  if (level === "granular" && data?.granular_permissions?.manage_users) return true;
  return false;
}

/** True if the user is an owner or admin (full management access). */
export function useIsAdmin(): boolean {
  const { data } = useSession();
  return data?.is_mod ?? false;
}

/** Check if the current user has a specific granular permission. Owner/admin always return true. */
export function useHasPermission(flag: keyof GranularPermissions): boolean {
  const { data } = useSession();
  if (!data?.logged_in) return false;
  const level = data.permission_level;
  if (level === "owner" || level === "admin") return true;
  return data.granular_permissions?.[flag] ?? false;
}
