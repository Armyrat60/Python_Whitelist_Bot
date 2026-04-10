"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  RoleSyncRule,
  RoleWatchConfig,
  RoleChangeLogEntry,
} from "@/lib/types";

// ── Role Sync Rules ─────────────────────────────────────────────────────────

export function useRoleSyncRules() {
  return useQuery<RoleSyncRule[]>({
    queryKey: ["role-sync-rules"],
    queryFn: async () => {
      const res = await api.get<{ rules: RoleSyncRule[] }>("/api/admin/role-sync-rules");
      return res.rules;
    },
    staleTime: 60_000,
  });
}

export function useCreateRoleSyncRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      name: string;
      target_role_id: string;
      target_role_name: string;
      source_roles: Array<{ role_id: string; role_name: string }>;
    }) => api.post<{ rule: RoleSyncRule }>("/api/admin/role-sync-rules", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-sync-rules"] }),
  });
}

export function useUpdateRoleSyncRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: {
      id: number;
      name?: string;
      target_role_id?: string;
      target_role_name?: string;
      enabled?: boolean;
      source_roles?: Array<{ role_id: string; role_name: string }>;
    }) => api.put<{ rule: RoleSyncRule }>(`/api/admin/role-sync-rules/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-sync-rules"] }),
  });
}

export function useDeleteRoleSyncRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/role-sync-rules/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-sync-rules"] }),
  });
}

// ── Role Watch Configs ──────────────────────────────────────────────────────

export function useRoleWatchConfigs() {
  return useQuery<RoleWatchConfig[]>({
    queryKey: ["role-watch-configs"],
    queryFn: async () => {
      const res = await api.get<{ configs: RoleWatchConfig[] }>("/api/admin/role-watch-configs");
      return res.configs;
    },
    staleTime: 60_000,
  });
}

export function useSaveRoleWatchConfigs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roles: Array<{ role_id: string; role_name: string }>) =>
      api.put<{ configs: RoleWatchConfig[] }>("/api/admin/role-watch-configs", { roles }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-watch-configs"] }),
  });
}

// ── Role Change Logs ────────────────────────────────────────────────────────

export interface RoleChangeLogParams {
  page?: number;
  per_page?: number;
  role_id?: string;
  discord_id?: string;
  action?: "gained" | "lost";
  date_from?: string;
  date_to?: string;
}

export interface RoleChangeLogResponse {
  entries: RoleChangeLogEntry[];
  total: number;
  page: number;
  per_page: number;
  pages: number;
}

export function useRoleChangeLogs(params: RoleChangeLogParams = {}) {
  const qs = new URLSearchParams();
  if (params.page) qs.set("page", String(params.page));
  if (params.per_page) qs.set("per_page", String(params.per_page));
  if (params.role_id) qs.set("role_id", params.role_id);
  if (params.discord_id) qs.set("discord_id", params.discord_id);
  if (params.action) qs.set("action", params.action);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);

  const query = qs.toString();

  return useQuery<RoleChangeLogResponse>({
    queryKey: ["role-change-logs", params],
    queryFn: () =>
      api.get<RoleChangeLogResponse>(`/api/admin/role-change-logs${query ? `?${query}` : ""}`),
    staleTime: 30_000,
  });
}
