"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "./use-session";
import type {
  Settings,
  Whitelist,
  Panel,
  WhitelistRole,
  DiscordRole,
  DiscordChannel,
  SquadGroup,
  Stats,
  HealthStatus,
  WhitelistUser,
  AuditEntry,
} from "@/lib/types";

// ─── Query hooks ────────────────────────────────────────────────────────────

interface SettingsResponse {
  bot_settings: Record<string, string>;
  type_configs: Record<string, {
    id: number;
    slug: string;
    name: string;
    enabled: boolean;
    panel_channel_id: string | null;
    panel_message_id: string | null;
    log_channel_id: string | null;
    output_filename: string;
    default_slot_limit: number;
    stack_roles: boolean;
    squad_group: string;
    is_default: boolean;
    url: string;
  }>;
  squad_groups: string[];
  squad_permissions: Record<string, string>;
}

export function useSettings() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id ?? null;
  return useQuery<SettingsResponse>({
    queryKey: ["settings", guildId],
    queryFn: () => api.get<SettingsResponse>("/api/admin/settings"),
    enabled: !!guildId,
  });
}

export function useWhitelists() {
  const { data, ...rest } = useSettings();
  const whitelists: Whitelist[] = data?.type_configs
    ? Object.values(data.type_configs).map((tc) => ({
        id: tc.id,
        slug: tc.slug,
        name: tc.name,
        enabled: tc.enabled,
        default_slot_limit: tc.default_slot_limit,
        stack_roles: tc.stack_roles,
        squad_group: tc.squad_group,
        output_filename: tc.output_filename,
        is_default: tc.is_default,
        url: tc.url,
      }))
    : [];
  return { data: whitelists, ...rest };
}

export function usePanels() {
  return useQuery<Panel[]>({
    queryKey: ["panels"],
    queryFn: async () => {
      const res = await api.get<{ panels: Panel[] }>("/api/admin/panels");
      return res.panels;
    },
  });
}

export function useRoles() {
  return useQuery<DiscordRole[]>({
    queryKey: ["roles"],
    queryFn: async () => {
      const res = await api.get<{ roles: DiscordRole[] }>("/api/admin/roles");
      return res.roles;
    },
  });
}

export function useChannels() {
  return useQuery<DiscordChannel[]>({
    queryKey: ["channels"],
    queryFn: async () => {
      const res = await api.get<{ channels: DiscordChannel[] }>("/api/admin/channels");
      return res.channels;
    },
  });
}

export function useGroups() {
  return useQuery<SquadGroup[]>({
    queryKey: ["groups"],
    queryFn: async () => {
      const res = await api.get<{ groups: SquadGroup[] }>("/api/admin/groups");
      return res.groups;
    },
  });
}

export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { group_name: string; permissions: string; description?: string }) =>
      api.post("/api/admin/groups", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { group_name: string; permissions?: string; new_name?: string; description?: string }) => {
      // Backend uses group_name field for rename, not new_name
      const payload: Record<string, string> = {};
      if (data.permissions !== undefined) payload.permissions = data.permissions;
      if (data.new_name) payload.group_name = data.new_name;
      if (data.description !== undefined) payload.description = data.description;
      return api.put(`/api/admin/groups/${encodeURIComponent(data.group_name)}`, payload);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
  });
}

export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (group_name: string) =>
      api.delete(`/api/admin/groups/${encodeURIComponent(group_name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["groups"] }),
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
      qc.invalidateQueries({ queryKey: ["orgTheme"] });
    },
  });
}

export function useOrgTheme() {
  return useQuery<{ accent_primary: string; accent_secondary: string }>({
    queryKey: ["orgTheme"],
    queryFn: () =>
      api.get<{ accent_primary: string; accent_secondary: string }>("/api/guild/theme"),
    staleTime: 60_000,
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
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      qc.invalidateQueries({ queryKey: ["panels"] });
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

// ─── Whitelist Roles ────────────────────────────────────────────────────────

export function useWhitelistRoles(whitelistId: number | null) {
  return useQuery<WhitelistRole[]>({
    queryKey: ["whitelist-roles", whitelistId],
    queryFn: async () => {
      const res = await api.get<{ roles: WhitelistRole[] }>(`/api/admin/whitelists/${whitelistId}/roles`);
      return res.roles;
    },
    enabled: whitelistId !== null,
  });
}

export function useAddWhitelistRole(whitelistId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { role_id: string; role_name: string; slot_limit: number; is_stackable?: boolean; display_name?: string }) =>
      api.post(`/api/admin/whitelists/${whitelistId}/roles`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whitelist-roles", whitelistId] });
      qc.invalidateQueries({ queryKey: ["role-stats"] });
    },
  });
}

export function useUpdateWhitelistRole(whitelistId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, ...data }: { roleId: string; slot_limit?: number; is_stackable?: boolean; is_active?: boolean; display_name?: string }) =>
      api.put(`/api/admin/whitelists/${whitelistId}/roles/${roleId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whitelist-roles", whitelistId] });
      qc.invalidateQueries({ queryKey: ["role-stats"] });
    },
  });
}

export function useRemoveWhitelistRole(whitelistId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/api/admin/whitelists/${whitelistId}/roles/${roleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whitelist-roles", whitelistId] });
      qc.invalidateQueries({ queryKey: ["role-stats"] });
    },
  });
}

// ─── Role Stats ─────────────────────────────────────────────────────────────

export interface RoleStat {
  role_id: string;
  role_name: string;
  discord_count: number | null;
  registered_count: number | null;
  unregistered_count: number | null;
}

export interface RoleStatsResult {
  stats: RoleStat[];
  gateway_mode: boolean;
  discord_available?: boolean;
}

export function useRoleStats() {
  return useQuery<RoleStatsResult>({
    queryKey: ["role-stats"],
    queryFn: () => api.get<RoleStatsResult>("/api/admin/role-stats"),
    staleTime: 30_000,
  });
}

// ─── Steam name resolution ──────────────────────────────────────────────────

export function useSteamNames(users: WhitelistUser[]) {
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const prevKeyRef = useRef("");

  const steamIds = useMemo(() => {
    const ids = new Set<string>();
    for (const u of users) {
      for (const sid of u.steam_ids ?? []) {
        if (sid) ids.add(sid);
      }
    }
    return Array.from(ids).sort();
  }, [users]);

  const cacheKey = steamIds.join(",");

  useEffect(() => {
    if (steamIds.length === 0 || cacheKey === prevKeyRef.current) return;
    prevKeyRef.current = cacheKey;

    let cancelled = false;

    api
      .post<{ names: Record<string, string> }>("/api/steam/names", {
        steam_ids: steamIds,
      })
      .then((res) => {
        if (!cancelled) setNameMap(res.names ?? {});
      })
      .catch(() => {
        // silently fail — names are optional
      });

    return () => {
      cancelled = true;
    };
  }, [steamIds, cacheKey]);

  return nameMap;
}

// ─── Notification Routing ───────────────────────────────────────────────────

export interface NotificationEventType {
  label: string;
  description: string;
}

export interface NotificationsConfig {
  routing: Record<string, string>;
  event_types: Record<string, NotificationEventType>;
}

export function useNotifications() {
  return useQuery<NotificationsConfig>({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationsConfig>("/api/admin/notifications"),
  });
}

export function useSaveNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (routing: Record<string, string>) =>
      api.put("/api/admin/notifications", routing),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useTriggerReport() {
  return useMutation({
    mutationFn: () => api.post("/api/admin/report", {}),
  });
}
