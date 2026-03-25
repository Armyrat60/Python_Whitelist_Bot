"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  Settings,
  Whitelist,
  Panel,
  RoleMapping,
  DiscordRole,
  DiscordChannel,
  SquadGroup,
  Stats,
  HealthStatus,
  WhitelistUser,
  AuditEntry,
} from "@/lib/types";

// ─── Query hooks ────────────────────────────────────────────────────────────

export function useSettings() {
  return useQuery<{ settings: Settings; whitelists: Whitelist[] }>({
    queryKey: ["settings"],
    queryFn: () =>
      api.get<{ settings: Settings; whitelists: Whitelist[] }>(
        "/api/admin/settings"
      ),
  });
}

export function useWhitelists() {
  const { data, ...rest } = useSettings();
  return { data: data?.whitelists, ...rest };
}

export function usePanels() {
  return useQuery<Panel[]>({
    queryKey: ["panels"],
    queryFn: () => api.get<Panel[]>("/api/admin/panels"),
  });
}

export function useRoles() {
  return useQuery<DiscordRole[]>({
    queryKey: ["roles"],
    queryFn: () => api.get<DiscordRole[]>("/api/admin/roles"),
  });
}

export function useChannels() {
  return useQuery<DiscordChannel[]>({
    queryKey: ["channels"],
    queryFn: () => api.get<DiscordChannel[]>("/api/admin/channels"),
  });
}

export function useGroups() {
  return useQuery<SquadGroup[]>({
    queryKey: ["groups"],
    queryFn: () => api.get<SquadGroup[]>("/api/admin/groups"),
  });
}

export function useStats() {
  return useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => api.get<Stats>("/api/admin/stats"),
  });
}

export function useHealth() {
  return useQuery<HealthStatus>({
    queryKey: ["health"],
    queryFn: () => api.get<HealthStatus>("/api/admin/health"),
    refetchInterval: 30_000,
  });
}

interface PaginatedUsers {
  users: WhitelistUser[];
  total: number;
  page: number;
  per_page: number;
}

export function useUsers(
  page: number,
  perPage: number,
  search?: string,
  filters?: Record<string, string>
) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  if (search) params.set("search", search);
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
  }

  return useQuery<PaginatedUsers>({
    queryKey: ["users", page, perPage, search, filters],
    queryFn: () =>
      api.get<PaginatedUsers>(`/api/admin/users?${params.toString()}`),
  });
}

interface PaginatedAudit {
  entries: AuditEntry[];
  total: number;
  page: number;
  per_page: number;
}

export function useAudit(
  page: number,
  perPage: number,
  filters?: Record<string, string>
) {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
  }

  return useQuery<PaginatedAudit>({
    queryKey: ["audit", page, perPage, filters],
    queryFn: () =>
      api.get<PaginatedAudit>(`/api/admin/audit?${params.toString()}`),
  });
}

// ─── Mutation hooks ─────────────────────────────────────────────────────────

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Settings>) =>
      api.post("/api/admin/settings", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useToggleWhitelist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      api.post(`/api/admin/types/${slug}/toggle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useCreateWhitelist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Whitelist>) =>
      api.post("/api/admin/whitelists", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useDeleteWhitelist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slug: string) =>
      api.delete(`/api/admin/whitelists/${slug}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useCreatePanel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Panel>) =>
      api.post("/api/admin/panels", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panels"] });
    },
  });
}

export function useUpdatePanel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: Partial<Panel> & { id: number }) =>
      api.put(`/api/admin/panels/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panels"] });
    },
  });
}

export function useDeletePanel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/panels/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panels"] });
    },
  });
}

export function usePushPanel() {
  return useMutation({
    mutationFn: (id: number) =>
      api.post(`/api/admin/panels/${id}/push`),
  });
}

export function useAddRoleMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      ...data
    }: {
      slug: string;
      role_id: string;
      slot_limit: number;
    }) => api.post(`/api/admin/roles/${slug}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}

export function useRemoveRoleMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, roleId }: { slug: string; roleId: string }) =>
      api.delete(`/api/admin/roles/${slug}/${roleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
}
