"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useSession } from "./use-session";
import type {
  Settings,
  Whitelist,
  Panel,
  PanelRole,
  DiscordRole,
  DiscordChannel,
  SquadGroup,
  Stats,
  HealthStatus,
  WhitelistUser,
  CategoryEntry,
  AuditEntry,
  WhitelistCategory,
  CategoryManager,
  DashboardPermission,
  DashboardRolePermission,
  PermissionLevel,
  BridgeConfig,
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
    is_manual: boolean;
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
        is_manual: tc.is_manual,
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

export function useSquadPermissions() {
  return useQuery<Record<string, string>>({
    queryKey: ["squad-permissions"],
    queryFn: async () => {
      const res = await api.get<{ permissions: Record<string, string> }>("/api/admin/permissions");
      return res.permissions;
    },
    staleTime: Infinity,
  });
}


export function useStats() {
  return useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: () => api.get<Stats>("/api/admin/stats"),
    refetchInterval: 30_000,
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

export function useInfiniteUsers(
  perPage: number,
  search?: string,
  filters?: Record<string, string>,
  sort?: string,
  order?: string,
) {
  const baseParams: Record<string, string> = { per_page: String(perPage) };
  if (search) baseParams.search = search;
  if (filters) for (const [k, v] of Object.entries(filters)) if (v) baseParams[k] = v;
  if (sort) baseParams.sort = sort;
  if (order) baseParams.order = order;

  return useInfiniteQuery<PaginatedUsers>({
    queryKey: ["users", "infinite", perPage, search, filters, sort, order],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ ...baseParams, page: String(pageParam) });
      return api.get<PaginatedUsers>(`/api/admin/users?${params.toString()}`);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const pages = Math.ceil(lastPage.total / lastPage.per_page);
      return lastPage.page < pages ? lastPage.page + 1 : undefined;
    },
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

export function useUpdateWhitelist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; squad_group?: string; output_filename?: string }) =>
      api.put(`/api/admin/whitelists/${id}`, data),
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

// ─── Whitelist category hooks ─────────────────────────────────────────────

export function useCategories(whitelistId: number | null) {
  return useQuery<WhitelistCategory[]>({
    queryKey: ["categories", whitelistId],
    queryFn: async () => {
      const res = await api.get<{ categories: WhitelistCategory[] }>(
        `/api/admin/whitelists/${whitelistId}/categories`
      );
      return res.categories;
    },
    enabled: whitelistId !== null,
  });
}

export function useCreateCategory(whitelistId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slot_limit?: number | null; sort_order?: number }) =>
      api.post(`/api/admin/whitelists/${whitelistId}/categories`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories", whitelistId] }),
  });
}

export function useUpdateCategory(whitelistId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; slot_limit?: number | null; sort_order?: number; squad_group?: string | null }) =>
      api.put(`/api/admin/whitelists/${whitelistId}/categories/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories", whitelistId] }),
  });
}

export function useDeleteCategory(whitelistId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (categoryId: number) =>
      api.delete(`/api/admin/whitelists/${whitelistId}/categories/${categoryId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories", whitelistId] }),
  });
}

export function useCategoryManagers(whitelistId: number, categoryId: number | null) {
  return useQuery<CategoryManager[]>({
    queryKey: ["category-managers", whitelistId, categoryId],
    queryFn: async () => {
      const res = await api.get<{ managers: CategoryManager[] }>(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/managers`
      );
      return res.managers;
    },
    enabled: categoryId !== null,
  });
}

export function useAddCategoryManager(whitelistId: number, categoryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { discord_id: string; discord_name: string }) =>
      api.post(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/managers`,
        data
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["category-managers", whitelistId, categoryId] }),
  });
}

export function useRemoveCategoryManager(whitelistId: number, categoryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (discordId: string) =>
      api.delete(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/managers/${discordId}`
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["category-managers", whitelistId, categoryId] }),
  });
}

// ─── Category entry hooks ─────────────────────────────────────────────────

interface PaginatedCategoryEntries {
  entries: CategoryEntry[];
  total: number;
  page: number;
  per_page: number;
}

export function useCategoryEntries(
  whitelistId: number,
  categoryId: number | null,
  page: number,
  search?: string
) {
  const params = new URLSearchParams({ page: String(page), per_page: "20" });
  if (search) params.set("search", search);
  return useQuery<PaginatedCategoryEntries>({
    queryKey: ["category-entries", whitelistId, categoryId, page, search],
    queryFn: async () =>
      api.get<PaginatedCategoryEntries>(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/entries?${params}`
      ),
    enabled: categoryId !== null,
  });
}

export function useAddCategoryEntry(whitelistId: number, categoryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      steam_id: string;
      discord_id?: string;
      discord_name?: string;
      notes?: string;
      expires_at?: string | null;
    }) =>
      api.post(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/entries`,
        data
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-entries", whitelistId, categoryId] });
      qc.invalidateQueries({ queryKey: ["categories", whitelistId] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useRemoveCategoryEntry(whitelistId: number, categoryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (discordId: string) =>
      api.delete(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/entries/${discordId}`
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-entries", whitelistId, categoryId] });
      qc.invalidateQueries({ queryKey: ["categories", whitelistId] });
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useImportCategoryEntries(whitelistId: number, categoryId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (csv: string) =>
      api.post<{ ok: boolean; added: number; updated: number; errors: { row: number; message: string }[] }>(
        `/api/admin/whitelists/${whitelistId}/categories/${categoryId}/entries/import`,
        { csv }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["category-entries", whitelistId, categoryId] });
      qc.invalidateQueries({ queryKey: ["categories", whitelistId] });
      qc.invalidateQueries({ queryKey: ["users"] });
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

// ─── Panel Roles ─────────────────────────────────────────────────────────────

export function usePanelRoles(panelId: number | null) {
  return useQuery<PanelRole[]>({
    queryKey: ["panel-roles", panelId],
    queryFn: async () => {
      const res = await api.get<{ roles: PanelRole[] }>(`/api/admin/panels/${panelId}/roles`);
      return res.roles;
    },
    enabled: panelId !== null,
  });
}

export function useAddPanelRole(panelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { role_id: string; role_name: string; slot_limit: number; is_stackable?: boolean; display_name?: string }) =>
      api.post(`/api/admin/panels/${panelId}/roles`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panel-roles", panelId] });
      qc.invalidateQueries({ queryKey: ["role-stats"] });
    },
  });
}

export function useUpdatePanelRole(panelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, ...data }: { roleId: string; slot_limit?: number; is_stackable?: boolean; is_active?: boolean; display_name?: string }) =>
      api.put(`/api/admin/panels/${panelId}/roles/${roleId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panel-roles", panelId] });
      qc.invalidateQueries({ queryKey: ["role-stats"] });
    },
  });
}

export function useRemovePanelRole(panelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) =>
      api.delete(`/api/admin/panels/${panelId}/roles/${roleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["panel-roles", panelId] });
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

// ─── Player Search & Profile ────────────────────────────────────────────────

export interface PlayerSearchResult {
  is_verified: boolean;
  discord_id: string;
  discord_name: string;
  steam_ids: string[];
  eos_ids: string[];
  memberships: Array<{
    whitelist_slug: string;
    whitelist_name: string;
    is_manual: boolean;
    status: string;
    expires_at: string | null;
    category_name: string | null;
  }>;
}

export interface PlayerProfile {
  discord_id: string;
  discord_name: string;
  is_verified: boolean;
  verified_steam_ids: string[];
  steam_ids: string[];
  eos_ids: string[];
  memberships: Array<{
    whitelist_slug: string;
    whitelist_name: string;
    is_manual: boolean;
    status: string;
    expires_at: string | null;
    created_at: string;
    notes: string | null;
    category_id: number | null;
    category_name: string | null;
    effective_slot_limit: number;
    slot_limit_override: number | null;
    created_via: string | null;
  }>;
  audit_log: Array<{
    id: number;
    action_type: string;
    actor_discord_id: string | null;
    details: string | null;
    created_at: string;
  }>;
  squad_players: Array<{
    steam_id: string;
    last_seen_name: string | null;
    server_name: string | null;
    last_seen_at: string;
  }>;
}

export function usePlayerSearch(q: string) {
  return useQuery<{ players: PlayerSearchResult[] }>({
    queryKey: ["player-search", q],
    queryFn: () => api.get<{ players: PlayerSearchResult[] }>(`/api/admin/players/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2,
    staleTime: 10_000,
  });
}

export function usePlayerProfile(discordId: string | null) {
  return useQuery<PlayerProfile>({
    queryKey: ["player-profile", discordId],
    queryFn: () => api.get<PlayerProfile>(`/api/admin/players/${discordId}`),
    enabled: !!discordId,
  });
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

// ─── Dashboard Permissions ──────────────────────────────────────────────────

export function usePermissions() {
  return useQuery<DashboardPermission[]>({
    queryKey: ["permissions"],
    queryFn: () => api.get<DashboardPermission[]>("/api/admin/dashboard-permissions"),
  });
}

export function useGrantPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { discord_id: string; discord_name?: string; permission_level: PermissionLevel }) =>
      api.post<DashboardPermission>("/api/admin/dashboard-permissions", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}

export function useUpdatePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ discordId, permission_level }: { discordId: string; permission_level: PermissionLevel }) =>
      api.put(`/api/admin/dashboard-permissions/${discordId}`, { permission_level }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}

export function useRevokePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (discordId: string) => api.delete(`/api/admin/dashboard-permissions/${discordId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["permissions"] }),
  });
}

// ─── Dashboard Role Permissions ─────────────────────────────────────────────

export function useRolePermissions() {
  return useQuery<DashboardRolePermission[]>({
    queryKey: ["role-permissions"],
    queryFn: () => api.get<DashboardRolePermission[]>("/api/admin/dashboard-role-permissions"),
  });
}

export function useGrantRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { role_id: string; role_name?: string; permission_level: PermissionLevel }) =>
      api.post<DashboardRolePermission>("/api/admin/dashboard-role-permissions", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
  });
}

export function useUpdateRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roleId, permission_level }: { roleId: string; permission_level: PermissionLevel }) =>
      api.put(`/api/admin/dashboard-role-permissions/${roleId}`, { permission_level }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
  });
}

export function useRevokeRolePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => api.delete(`/api/admin/dashboard-role-permissions/${roleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["role-permissions"] }),
  });
}

// ── Bridge config hooks ──────────────────────────────────────────────────────

export function useBridgeConfig() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{ config: BridgeConfig | null }>({
    queryKey: ["bridge-config", guildId],
    queryFn: () => api.get("/api/admin/bridge-config"),
    enabled: !!guildId,
  });
}

export function useSaveBridgeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<BridgeConfig>) =>
      api.put<{ config: BridgeConfig }>("/api/admin/bridge-config", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bridge-config"] }),
  });
}

export function useDeleteBridgeConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/api/admin/bridge-config"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bridge-config"] }),
  });
}

export function useTestBridgeConnection() {
  return useMutation({
    mutationFn: (data: Partial<BridgeConfig>) =>
      api.post<{ ok: boolean; message: string; player_count?: number }>(
        "/api/admin/bridge-config/test",
        data,
      ),
  });
}

export function useBridgeJobs() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{
    jobs: Array<{
      id: number;
      job_type: string;
      status: string;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
      result: { summary?: string } | null;
      error: string | null;
    }>;
  }>({
    queryKey: ["bridge-jobs", guildId],
    queryFn: () => api.get("/api/admin/jobs?type=bridge_sync&limit=10"),
    enabled: !!guildId,
    refetchInterval: 30_000,
  });
}

export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; job_id: number }>("/api/admin/bridge-config/sync-now", {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bridge-config"] }),
  });
}

export function useJobStatus(jobId: number | null) {
  return useQuery<{
    job: {
      id: number;
      job_type: string;
      status: string;
      created_at: string;
      started_at: string | null;
      completed_at: string | null;
      result: { summary?: string } | null;
      error: string | null;
    };
  }>({
    queryKey: ["job", jobId],
    queryFn: () => api.get(`/api/admin/jobs/${jobId}`),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.job?.status;
      // Keep polling while job is pending or running
      return status === "pending" || status === "running" ? 1500 : false;
    },
  });
}

// ── Seeding config hooks ────────────────────────────────────────────────────

export function useSeedingConfig() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{ config: import("@/lib/types").SeedingConfig | null; servers: import("@/lib/types").SeedingServer[] }>({
    queryKey: ["seeding-config", guildId],
    queryFn: () => api.get("/api/admin/seeding-config"),
    enabled: !!guildId,
  });
}

export function useSaveSeedingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<import("@/lib/types").SeedingConfig>) =>
      api.put<{ config: import("@/lib/types").SeedingConfig }>("/api/admin/seeding-config", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seeding-config"] }),
  });
}

export function useDeleteSeedingConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete("/api/admin/seeding-config"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seeding-config"] }),
  });
}

export function useTestSeedingConnection() {
  return useMutation({
    mutationFn: (data: Partial<import("@/lib/types").SeedingConfig>) =>
      api.post<{ ok: boolean; message: string; player_count?: number }>(
        "/api/admin/seeding-config/test",
        data,
      ),
  });
}

export function useSeedingLeaderboard() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{
    points_required: number;
    players: import("@/lib/types").SeedingPlayer[];
  }>({
    queryKey: ["seeding-leaderboard", guildId],
    queryFn: () => api.get("/api/admin/seeding/leaderboard"),
    enabled: !!guildId,
    refetchInterval: 30_000,
  });
}

export function useResetSeedingPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean; players_reset: number }>("/api/admin/seeding/reset", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["seeding-leaderboard"] });
      qc.invalidateQueries({ queryKey: ["seeding-config"] });
    },
  });
}

export function useGrantSeedingPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { steam_id: string; points: number }) =>
      api.post<{ ok: boolean }>("/api/admin/seeding/grant", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seeding-leaderboard"] }),
  });
}

export function useSeedingStats() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{
    points_required: number;
    total_seeders: number;
    total_rewarded: number;
    total_seeding_hours: number;
    pending_discord_link: number;
    top_seeders: Array<{ player_name: string | null; points: number; progress_pct: number; rewarded: boolean }>;
    recent_rewards: Array<{ player_name: string; tier_label: string; created_at: string }>;
  }>({
    queryKey: ["seeding-stats", guildId],
    queryFn: () => api.get("/api/admin/seeding/stats"),
    enabled: !!guildId,
    refetchInterval: 30_000,
  });
}

export function useAddSeedingServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { server_name: string; squadjs_host: string; squadjs_port?: number; squadjs_token: string }) =>
      api.post<{ ok: boolean; server: import("@/lib/types").SeedingServer }>("/api/admin/seeding-config/servers", data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seeding-config"] }),
  });
}

export function useUpdateSeedingServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; server_name?: string; squadjs_host?: string; squadjs_port?: number; squadjs_token?: string; enabled?: boolean }) =>
      api.put<{ ok: boolean; server: import("@/lib/types").SeedingServer }>(`/api/admin/seeding-config/servers/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seeding-config"] }),
  });
}

export function useDeleteSeedingServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/admin/seeding-config/servers/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seeding-config"] }),
  });
}

export function useSeedingPopulation(hours = 24) {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{
    hours: number;
    snapshots: Array<{ player_count: number; is_seeding: boolean; time: string }>;
  }>({
    queryKey: ["seeding-population", guildId, hours],
    queryFn: () => api.get(`/api/admin/seeding/population?hours=${hours}`),
    enabled: !!guildId,
    refetchInterval: 60_000,
  });
}

export function useSeedingPublicLeaderboard() {
  const { data: session } = useSession();
  const guildId = session?.active_guild_id;
  return useQuery<{
    enabled: boolean;
    points_required: number;
    players: import("@/lib/types").SeedingPublicPlayer[];
  }>({
    queryKey: ["seeding-public-leaderboard", guildId],
    queryFn: () => api.get("/api/seeding/public-leaderboard"),
    enabled: !!guildId,
    refetchInterval: 30_000,
  });
}
