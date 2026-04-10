"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Save, Settings2, Bell, Palette,
  Shield, User, Globe, Clock,
  Send, Link2, Sprout, Sparkles,
} from "lucide-react";
import { BridgeSettings } from "@/components/bridge-settings";
import { BattleMetricsSettings as BMSettings } from "@/components/battlemetrics-settings";
import { GameServerSettings } from "@/components/game-server-settings";
import {
  useSettings,
  useRoles,
  useChannels,
  useSaveSettings,
  useNotifications,
  useSaveNotifications,
  useTriggerReport,
  useBoosterRole,
  useWhitelists,
  useRolePermissions,
  useGrantRolePermission,
  useUpdateRolePermission,
  useRevokeRolePermission,
} from "@/hooks/use-settings";
import type { GranularPermissions } from "@/lib/types";
import { useSession } from "@/hooks/use-session";
import type { Settings } from "@/lib/types";

import { useAccent } from "@/components/accent-context";
import { PersonalThemeCard, OrgThemeCard } from "@/components/settings/theme-cards";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Popover, PopoverTrigger, PopoverContent,
} from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty,
  CommandGroup, CommandItem,
} from "@/components/ui/command";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";

/* ─── Types ─── */
type Tab = "general" | "notifications" | "appearance" | "permissions" | "account" | "connections" | "seeding";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "general",       label: "General",       icon: Settings2 },
  { id: "notifications", label: "Notifications",  icon: Bell },
  { id: "appearance",    label: "Appearance",     icon: Palette },
  { id: "permissions",   label: "Permissions",    icon: Shield },
  { id: "connections",   label: "Connections",    icon: Link2 },
  { id: "seeding",       label: "Seeding",        icon: Sprout },
  { id: "account",       label: "Account",        icon: User },
];

/* ─── Timezone data ─── */
const TIMEZONES = [
  { value: "UTC",              label: "UTC" },
  { value: "US/Eastern",       label: "US / Eastern (ET)" },
  { value: "US/Central",       label: "US / Central (CT)" },
  { value: "US/Mountain",      label: "US / Mountain (MT)" },
  { value: "US/Pacific",       label: "US / Pacific (PT)" },
  { value: "America/Anchorage",label: "US / Alaska (AKT)" },
  { value: "Pacific/Honolulu", label: "US / Hawaii (HAT)" },
  { value: "Europe/London",    label: "Europe / London (GMT/BST)" },
  { value: "Europe/Berlin",    label: "Europe / Central (CET/CEST)" },
  { value: "Europe/Moscow",    label: "Europe / Moscow (MSK)" },
  { value: "Asia/Dubai",       label: "Asia / Dubai (GST)" },
  { value: "Asia/Singapore",   label: "Asia / Singapore (SGT)" },
  { value: "Asia/Tokyo",       label: "Asia / Tokyo (JST)" },
  { value: "Australia/Sydney", label: "Australia / Sydney (AEST)" },
];

const REPORT_FREQUENCIES = [
  { value: "disabled", label: "Disabled" },
  { value: "daily",    label: "Daily" },
  { value: "weekly",   label: "Weekly" },
];


/* ─── Notification event groups ─── */
const NOTIF_GROUPS: { label: string; events: string[] }[] = [
  { label: "User Events",      events: ["user_joined", "user_removed", "user_left_discord"] },
  { label: "Role Events",      events: ["role_lost", "role_returned"] },
  { label: "Reports & Alerts", events: ["report", "bot_alert", "admin_action"] },
];

/* ─── Helpers ─── */
function avatarUrl(userId: string, avatar: string) {
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.webp?size=128`;
}

function modReasonLabel(reason: string | undefined): string {
  if (!reason) return "Custom role";
  if (reason === "owner")            return "Server Owner";
  if (reason === "administrator")    return "Discord Administrator";
  if (reason === "manage_guild" || reason === "role_manage_guild")
    return "Manage Server permission";
  if (reason === "role_administrator") return "Administrator via role";
  return "Custom mod role";
}

/* ─── Live Clock ─── */
function LiveClock({ timezone }: { timezone: string }) {
  const [time, setTime] = useState<string>("");

  useEffect(() => {
    function tick() {
      try {
        const str = new Date().toLocaleString("en-US", {
          timeZone: timezone,
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });
        setTime(str);
      } catch {
        setTime("(invalid timezone)");
      }
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timezone]);

  if (!time) return null;
  return (
    <span className="font-mono text-sm text-foreground">{time}</span>
  );
}

/* ─── Permission Flags (must match api/src/lib/permissions.ts) ─── */
const PERMISSION_FLAGS = [
  { key: "view_stats",          label: "View Stats",          group: "Dashboard" },
  { key: "view_logs",           label: "View Logs",           group: "Dashboard" },
  { key: "manage_users",        label: "Manage Users",        group: "Content" },
  { key: "manage_whitelists",   label: "Manage Whitelists",   group: "Content" },
  { key: "manage_panels",       label: "Manage Panels",       group: "Content" },
  { key: "manage_settings",     label: "Manage Settings",     group: "Content" },
  { key: "manage_seeding",      label: "Manage Seeding",      group: "Content" },
  { key: "manage_permissions",  label: "Manage Permissions",  group: "Content" },
  { key: "sftp_read",           label: "SFTP Read",           group: "Server" },
  { key: "sftp_write",          label: "SFTP Write",          group: "Server" },
  { key: "rcon_read",           label: "RCON Read",           group: "Server" },
  { key: "rcon_execute",        label: "RCON Execute",        group: "Server" },
  { key: "push_config",         label: "Push Config",         group: "Server" },
] as const;

const FLAG_GROUPS = ["Dashboard", "Content", "Server"] as const;

/* ─── Granular Permission Toggles ─── */
function PermissionToggles({
  permissions,
  onChange,
}: {
  permissions: GranularPermissions;
  onChange: (perms: GranularPermissions) => void;
}) {
  return (
    <div className="space-y-3 pt-2">
      {FLAG_GROUPS.map((group) => (
        <div key={group}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{group}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PERMISSION_FLAGS.filter((f) => f.group === group).map((flag) => (
              <label
                key={flag.key}
                className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 cursor-pointer hover:bg-white/[0.04] transition-colors"
              >
                <input
                  type="checkbox"
                  checked={permissions[flag.key as keyof GranularPermissions] ?? false}
                  onChange={(e) => onChange({ ...permissions, [flag.key]: e.target.checked })}
                  className="rounded border-white/20 bg-transparent accent-[var(--accent-primary)]"
                />
                <span className="text-xs text-white/80">{flag.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Role Permission Grants ─── */
function RolePermissionGrants() {
  const { data: roleGrants, isLoading } = useRolePermissions();
  const { data: discordRoles } = useRoles();
  const grantRole = useGrantRolePermission();
  const updateRole = useUpdateRolePermission();
  const revokeRole = useRevokeRolePermission();

  const [addPopoverOpen, setAddPopoverOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<GranularPermissions>({});
  const [editLevel, setEditLevel] = useState<string>("viewer");

  const grants = roleGrants ?? [];
  const grantedRoleIds = new Set(grants.map((g) => g.role_id));

  async function handleAddRole(roleId: string, roleName: string) {
    setAddPopoverOpen(false);
    try {
      await grantRole.mutateAsync({
        role_id: roleId,
        role_name: roleName,
        permission_level: "viewer",
      });
      toast.success(`Added ${roleName}`);
    } catch {
      toast.error("Failed to add role");
    }
  }

  function startEdit(grant: typeof grants[number]) {
    setEditingRole(grant.role_id);
    setEditLevel(grant.permission_level);
    setEditPerms((grant.permissions as GranularPermissions) ?? {});
  }

  async function saveEdit() {
    if (!editingRole) return;
    try {
      await updateRole.mutateAsync({
        roleId: editingRole,
        permission_level: editLevel as any,
        permissions: editLevel === "granular" ? editPerms : undefined,
      });
      toast.success("Updated");
      setEditingRole(null);
    } catch {
      toast.error("Failed to update");
    }
  }

  async function handleRevoke(roleId: string) {
    try {
      await revokeRole.mutateAsync(roleId);
      toast.success("Revoked");
    } catch {
      toast.error("Failed to revoke");
    }
  }

  if (isLoading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Role Permission Grants</CardTitle>
        <CardDescription>
          Grant dashboard access to specific Discord roles. Choose a preset level or customize with granular permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {grants.length === 0 && (
          <p className="text-sm text-muted-foreground/60 italic">No role grants configured.</p>
        )}
        {grants.map((grant) => {
          const role = discordRoles?.find((r) => r.id === grant.role_id);
          const isEditing = editingRole === grant.role_id;

          return (
            <div key={grant.role_id} className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full ring-1 ring-white/20"
                    style={{ backgroundColor: role?.color || "#99AAB5" }}
                  />
                  <span className="text-sm font-medium text-white/90">{role?.name ?? grant.role_name ?? grant.role_id}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {grant.permission_level === "granular" ? "Custom" : grant.permission_level}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => isEditing ? setEditingRole(null) : startEdit(grant)}>
                    {isEditing ? "Cancel" : "Edit"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-red-400 hover:text-red-300" onClick={() => handleRevoke(grant.role_id)}>
                    Remove
                  </Button>
                </div>
              </div>

              {isEditing && (
                <div className="space-y-3 pt-1 border-t border-white/[0.06]">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Permission Level</Label>
                    <select
                      value={editLevel}
                      onChange={(e) => setEditLevel(e.target.value)}
                      className="flex h-8 w-48 items-center rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none dark:bg-input/30"
                    >
                      <option value="viewer">Viewer (read-only)</option>
                      <option value="roster_manager">Roster Manager</option>
                      <option value="granular">Custom (granular)</option>
                    </select>
                  </div>
                  {editLevel === "granular" && (
                    <PermissionToggles permissions={editPerms} onChange={setEditPerms} />
                  )}
                  <Button size="sm" onClick={saveEdit} disabled={updateRole.isPending} className="font-semibold text-black" style={{ background: "var(--accent-primary)" }}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    Save
                  </Button>
                </div>
              )}

              {!isEditing && grant.permission_level === "granular" && grant.permissions && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {Object.entries(grant.permissions as Record<string, boolean>).filter(([, v]) => v).map(([key]) => (
                    <Badge key={key} variant="outline" className="text-[9px] bg-white/[0.04]">
                      {key.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>
            + Add Role
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0">
            <Command>
              <CommandInput placeholder="Search role…" />
              <CommandList>
                <CommandEmpty>No roles found.</CommandEmpty>
                <CommandGroup>
                  {discordRoles
                    ?.filter((r) => !grantedRoleIds.has(r.id))
                    .map((role) => (
                      <CommandItem
                        key={role.id}
                        onSelect={() => handleAddRole(role.id, role.name)}
                      >
                        <span
                          className="mr-2 inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: role.color || "#99AAB5" }}
                        />
                        {role.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </CardContent>
    </Card>
  );
}

/* ─── Booster Auto-Whitelist ─── */
function BoosterAutoWhitelist() {
  const { data: boosterData, isLoading } = useBoosterRole();
  const { data: whitelists } = useWhitelists();

  if (isLoading) return null;
  if (!boosterData?.booster_role) return null;

  const isLinked = !!boosterData.linked_panel;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-pink-400" />
          Server Booster Auto-Whitelist
        </CardTitle>
        <CardDescription>
          Automatically whitelist Discord server boosters via the panel role system.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLinked ? (
          <div className="flex items-center gap-2 rounded-lg border border-pink-500/20 bg-pink-500/5 px-4 py-3">
            <Sparkles className="h-4 w-4 text-pink-400 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-pink-300">Boosters are auto-whitelisted</p>
              <p className="text-xs text-muted-foreground">
                Role &ldquo;{boosterData.booster_role.name}&rdquo; is linked to panel &ldquo;{boosterData.linked_panel!.panel_name}&rdquo; with {boosterData.linked_panel!.slot_limit} slot(s).
              </p>
            </div>
            <Badge className="bg-pink-500/15 text-pink-400 border-pink-500/20">Active</Badge>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
            <Sparkles className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="text-sm text-white/70">Booster auto-whitelist is not configured</p>
              <p className="text-xs text-muted-foreground">
                Add the &ldquo;{boosterData.booster_role.name}&rdquo; role (ID: {boosterData.booster_role.id}) to any panel in{" "}
                <a href="/dashboard/config?tab=panels" className="underline hover:text-white/80">Configuration → Panels</a> to enable.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Save Bar ─── */
function SaveBar({
  onSave,
  isPending,
}: {
  onSave: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex justify-end pt-2">
      <Button
        size="sm"
        onClick={onSave}
        disabled={isPending}
        className="font-semibold text-black"
        style={{ background: "var(--accent-primary)" }}
      >
        <Save className="mr-1.5 h-3.5 w-3.5" />
        {isPending ? "Saving…" : "Save Changes"}
      </Button>
    </div>
  );
}

/* ─── Main Page ─── */
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("general");

  const { data, isLoading } = useSettings();
  const { data: roles } = useRoles();
  const { data: channels } = useChannels();
  const { data: session } = useSession();
  const saveSettings = useSaveSettings();
  const accent = useAccent();

  /* ── Notification routing hooks ── */
  const { data: notifData, isLoading: notifLoading } = useNotifications();
  const saveNotifRouting = useSaveNotifications();
  const triggerReport = useTriggerReport();


  const botSettings = data?.bot_settings as Record<string, string> | undefined;

  /* ── General form state ── */
  const [autoReactivate, setAutoReactivate] = useState("true");
  const [welcomeDmEnabled, setWelcomeDmEnabled] = useState("false");
  const [welcomeDmText, setWelcomeDmText]       = useState("");
  const [allowDuplicates, setAllowDuplicates]   = useState("true");
  const [botStatusMsg, setBotStatusMsg]          = useState("");
  const [retentionDays, setRetentionDays] = useState("90");
  const [roleSyncInterval, setRoleSyncInterval] = useState("24");
  const [dedupe, setDedupe] = useState("true");

  /* ── Notifications form state ── */
  const [reportFreq, setReportFreq]       = useState("disabled");
  const [notifChannelId, setNotifChannelId] = useState("");

  /* ── Permissions form state ── */
  const [modRoleIds, setModRoleIds]         = useState<string[]>([]);
  const [rolesPopoverOpen, setRolesPopoverOpen] = useState(false);

  /* ── Account / Timezone form state ── */
  const [timezone, setTimezone] = useState("UTC");

  /* ── Notification routing state ── */
  const [notifRouting, setNotifRouting] = useState<Record<string, string>>({});
  const [notifRoutingDirty, setNotifRoutingDirty] = useState(false);


  /* ── Sync state from server ── */
  useEffect(() => {
    if (!botSettings) return;
    setAutoReactivate(botSettings.auto_reactivate_on_role_return ?? "true");
    setWelcomeDmEnabled(botSettings.welcome_dm_enabled ?? "false");
    setWelcomeDmText(botSettings.welcome_dm_text ?? "");
    setAllowDuplicates(botSettings.allow_global_duplicates ?? "true");
    setBotStatusMsg(botSettings.bot_status_message ?? "");
    setReportFreq(botSettings.report_frequency ?? "disabled");
    setNotifChannelId(botSettings.notification_channel_id ?? "");
    setTimezone(botSettings.timezone ?? "UTC");
    setRetentionDays(botSettings.retention_days ?? "90");
    setRoleSyncInterval(botSettings.role_sync_interval_hours ?? "24");
    setDedupe(botSettings.duplicate_output_dedupe ?? "true");
    setModRoleIds(
      botSettings.mod_role_id
        ? botSettings.mod_role_id.split(",").filter(Boolean)
        : []
    );
  }, [botSettings]);

  /* ── Seed notification routing from API ── */
  useEffect(() => {
    if (notifData?.routing) {
      setNotifRouting(notifData.routing);
      setNotifRoutingDirty(false);
    }
  }, [notifData]);

  /* ── Save helpers ── */
  function save(fields: Partial<Settings & Record<string, string>>) {
    saveSettings.mutate(fields as Partial<Settings>, {
      onSuccess: () => toast.success("Settings saved"),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save settings"),
    });
  }

  const saveGeneral = useCallback(() => {
    save({
      auto_reactivate_on_role_return: autoReactivate,
      welcome_dm_enabled: welcomeDmEnabled,
      welcome_dm_text: welcomeDmText,
      allow_global_duplicates: allowDuplicates,
      bot_status_message: botStatusMsg,
      retention_days: retentionDays,
      role_sync_interval_hours: roleSyncInterval,
      duplicate_output_dedupe: dedupe,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReactivate, welcomeDmEnabled, welcomeDmText, allowDuplicates, botStatusMsg, retentionDays, roleSyncInterval, dedupe]);

  const saveNotifications = useCallback(() => {
    save({
      report_frequency: reportFreq,
      notification_channel_id: notifChannelId,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFreq, notifChannelId]);

  const savePermissions = useCallback(() => {
    save({ mod_role_id: modRoleIds.join(",") });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modRoleIds]);

  const saveAccount = useCallback(() => {
    save({ timezone });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone]);

  /* ── Notification routing helpers ── */
  function setNotifChannel(eventType: string, channelId: string) {
    setNotifRouting((prev) => ({ ...prev, [eventType]: channelId === "__none__" ? "" : channelId }));
    setNotifRoutingDirty(true);
  }

  function handleSaveNotifRouting() {
    saveNotifRouting.mutate(notifRouting, {
      onSuccess: () => {
        toast.success("Notification routing saved");
        setNotifRoutingDirty(false);
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save"),
    });
  }

  function handleTriggerReport() {
    triggerReport.mutate(undefined, {
      onSuccess: () => toast.success("Report triggered — check your configured report channel"),
      onError: () => toast.error("Failed to trigger report"),
    });
  }

  /* ── Combobox options for channels & roles ── */
  const channelOptions = useMemo(
    () =>
      [{ value: "__none__", label: "None (disabled)" }].concat(
        (channels ?? [])
          .slice()
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((ch) => ({ value: ch.id, label: `#${ch.name}` }))
      ),
    [channels]
  );

  /* ── Org theme helpers (passed through accent context) ── */
  function handleSaveOrgTheme(p: string, s: string) {
    save({ accent_primary: p, accent_secondary: s });
  }
  function handleClearOrgTheme() {
    save({ accent_primary: "", accent_secondary: "" });
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div>
      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your server's whitelist bot and dashboard preferences.
        </p>
      </div>

      <div className="flex gap-8">
        {/* Left nav */}
        <nav className="w-48 shrink-0 space-y-0.5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-left",
                  active
                    ? "bg-white/[0.08] text-white"
                    : "text-white/50 hover:bg-white/[0.04] hover:text-white/80"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">

      {/* ── General ── */}
      {activeTab === "general" && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Bot Behavior</CardTitle>
              <CardDescription>Control how the bot manages whitelist entries.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Auto-Remove on Role Loss</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Deactivate whitelist automatically when a member loses their qualifying role.
                  </p>
                </div>
                <Switch
                  checked={autoReactivate === "true"}
                  onCheckedChange={(v) => setAutoReactivate(String(v))}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Allow Duplicate IDs Across Whitelists</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Permit the same Steam64 or EOS ID to appear on multiple whitelist files.
                  </p>
                </div>
                <Switch
                  checked={allowDuplicates === "true"}
                  onCheckedChange={(v) => setAllowDuplicates(String(v))}
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Deduplicate Output File</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Remove duplicate Steam64/EOS IDs from the generated whitelist file.
                  </p>
                </div>
                <Switch
                  checked={dedupe === "true"}
                  onCheckedChange={(v) => setDedupe(String(v))}
                />
              </div>

              <div className="space-y-2">
                <Label>Audit Log Retention (days)</Label>
                <Input
                  type="number"
                  min={7}
                  max={3650}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(e.target.value)}
                  className="max-w-[120px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  How long audit log entries are kept. Default is 90 days.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Role Sync Interval (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  max={168}
                  value={roleSyncInterval}
                  onChange={(e) => setRoleSyncInterval(e.target.value)}
                  className="max-w-[120px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  How often the bot checks Discord roles against whitelist membership. Default is 24 hours (1–168).
                </p>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Welcome DM</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Send a DM to new members when they are added to a whitelist.
                  </p>
                </div>
                <Switch
                  checked={welcomeDmEnabled === "true"}
                  onCheckedChange={(v) => setWelcomeDmEnabled(String(v))}
                />
              </div>

              {welcomeDmEnabled === "true" && (
                <div className="space-y-2 rounded-lg border border-white/[0.10] bg-white/[0.02] p-3">
                  <Label>Welcome Message</Label>
                  <Textarea
                    value={welcomeDmText}
                    onChange={(e) => setWelcomeDmText(e.target.value)}
                    placeholder="You've been added to the whitelist! Welcome."
                    rows={3}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Sent as a Discord DM when a user is added or reactivated.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label>Bot Status Message</Label>
                <Input
                  value={botStatusMsg}
                  onChange={(e) => setBotStatusMsg(e.target.value)}
                  placeholder="Watching over the whitelist…"
                  className="max-w-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Custom status shown in the bot's Discord presence. Leave blank for default.
                </p>
              </div>
            </CardContent>
          </Card>

          <BoosterAutoWhitelist />

          <SaveBar onSave={saveGeneral} isPending={saveSettings.isPending} />
        </div>
      )}

      {/* ── Notifications ── */}
      {activeTab === "notifications" && (
        <div className="space-y-6">
          {/* Card 1: Report Settings */}
          <Card>
            <CardHeader>
              <CardTitle>Report Settings</CardTitle>
              <CardDescription>
                Configure scheduled reports and the default notification channel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label>Report Frequency</Label>
                <Select value={reportFreq} onValueChange={(v) => setReportFreq(v ?? "disabled")}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  How often an automatic summary report is sent to your notification channel.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Notification Channel</Label>
                <Combobox
                  options={channelOptions}
                  value={notifChannelId || "__none__"}
                  onValueChange={(v) => setNotifChannelId(v === "__none__" ? "" : v)}
                  placeholder="Select a channel…"
                  searchPlaceholder="Search channels…"
                  emptyText="No channels found."
                  className="w-72"
                />
                <p className="text-[11px] text-muted-foreground">
                  Default channel for scheduled reports. Per-event routing can be set below.
                </p>
              </div>
            </CardContent>
          </Card>
          <SaveBar onSave={saveNotifications} isPending={saveSettings.isPending} />

          {/* Card 2: Event Notifications */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-4 w-4" />
                    Event Notifications
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Choose which Discord channel receives each type of notification.
                    Leave a channel unset to disable that notification type.
                    All events are still recorded in the Audit Log regardless of routing.
                  </CardDescription>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTriggerReport}
                    disabled={triggerReport.isPending}
                  >
                    <Send className="h-4 w-4 mr-1.5" />
                    Send Report Now
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveNotifRouting}
                    disabled={!notifRoutingDirty || saveNotifRouting.isPending}
                    style={{ background: "var(--accent-primary)" }}
                    className="text-black font-semibold"
                  >
                    <Save className="h-4 w-4 mr-1.5" />
                    {saveNotifRouting.isPending ? "Saving…" : "Save Routing"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {notifLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : (
                <div className="space-y-4">
                  {NOTIF_GROUPS.map((group) => {
                    const eventTypes = notifData?.event_types ?? {};
                    const visibleEvents = group.events.filter((e) => eventTypes[e]);
                    if (visibleEvents.length === 0) return null;
                    return (
                      <div key={group.label} className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground px-1 pb-1">
                          {group.label}
                        </p>
                        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.05]">
                          {visibleEvents.map((eventType) => {
                            const info = eventTypes[eventType];
                            const currentChannel = notifRouting[eventType] ?? "";
                            return (
                              <div
                                key={eventType}
                                className="flex items-center justify-between gap-4 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm font-medium truncate">{info.label}</p>
                                  <p className="text-xs text-muted-foreground truncate">{info.description}</p>
                                </div>
                                <Combobox
                                  options={channelOptions}
                                  value={currentChannel || "__none__"}
                                  onValueChange={(v) => setNotifChannel(eventType, v)}
                                  placeholder="Disabled"
                                  searchPlaceholder="Search channels…"
                                  emptyText="No channels found."
                                  className="w-52 shrink-0"
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground pt-1">
                    Tip: You can point multiple event types at the same channel for a combined feed,
                    or use separate channels for better signal-to-noise.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Appearance ── */}
      {activeTab === "appearance" && (
        <div className="space-y-6">
          {/* Personal theme */}
          <PersonalThemeCard accent={accent} />

          {/* Org theme */}
          <OrgThemeCard
            orgPrimary={(botSettings?.accent_primary) ?? ""}
            orgSecondary={(botSettings?.accent_secondary) ?? ""}
            onSave={handleSaveOrgTheme}
            onClear={handleClearOrgTheme}
            isSaving={saveSettings.isPending}
          />
        </div>
      )}

      {/* ── Permissions ── */}
      {activeTab === "permissions" && (
        <div className="space-y-6">
          {/* Your current permission level */}
          {session && (
            <Card>
              <CardHeader>
                <CardTitle>Your Access Level</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <Avatar size="sm">
                    <AvatarImage src={avatarUrl(session.discord_id, session.avatar)} />
                    <AvatarFallback>{session.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium text-foreground">{session.username}</p>
                    <p className="text-xs text-muted-foreground">
                      Access via:{" "}
                      <span className="font-medium" style={{ color: "var(--accent-primary)" }}>
                        {modReasonLabel(
                          session.guilds.find((g) => g.id === session.active_guild_id)
                            ?.mod_reason as string | undefined
                        )}
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Custom mod roles */}
          <Card>
            <CardHeader>
              <CardTitle>Custom Admin Roles</CardTitle>
              <CardDescription>
                Server owners, administrators, and members with Manage Server are auto-detected.
                Add additional roles below to grant full dashboard access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5 min-h-[2rem]">
                {modRoleIds.length === 0 && (
                  <span className="text-sm text-muted-foreground/60 italic">No custom roles configured.</span>
                )}
                {modRoleIds.map((id) => {
                  const role = roles?.find((r) => r.id === id);
                  return (
                    <Badge
                      key={id}
                      variant="outline"
                      className="gap-1.5 bg-white/[0.06] border-white/[0.15] text-foreground"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white/20"
                        style={{ backgroundColor: role?.color || "#99AAB5" }}
                      />
                      {role?.name ?? id}
                      <button
                        onClick={() => setModRoleIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 rounded-full opacity-60 hover:opacity-100 hover:text-red-400 transition-colors"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
              <Popover open={rolesPopoverOpen} onOpenChange={setRolesPopoverOpen}>
                <PopoverTrigger render={<Button variant="outline" size="sm" />}>
                  + Add Role
                </PopoverTrigger>
                <PopoverContent className="w-56 p-0">
                  <Command>
                    <CommandInput placeholder="Search role…" />
                    <CommandList>
                      <CommandEmpty>No roles found.</CommandEmpty>
                      <CommandGroup>
                        {roles
                          ?.filter((r) => !modRoleIds.includes(r.id))
                          .map((role) => (
                            <CommandItem
                              key={role.id}
                              onSelect={() => {
                                setModRoleIds((prev) => [...prev, role.id]);
                                setRolesPopoverOpen(false);
                              }}
                            >
                              <span
                                className="mr-2 inline-block h-3 w-3 rounded-full"
                                style={{ backgroundColor: role.color || "#99AAB5" }}
                              />
                              {role.name}
                            </CommandItem>
                          ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </CardContent>
            <CardFooter className="flex justify-end">
              <Button
                size="sm"
                onClick={savePermissions}
                disabled={saveSettings.isPending}
                className="font-semibold text-black"
                style={{ background: "var(--accent-primary)" }}
              >
                <Save className="mr-1.5 h-3.5 w-3.5" />
                {saveSettings.isPending ? "Saving…" : "Save Changes"}
              </Button>
            </CardFooter>
          </Card>

          {/* Role permission grants with granular toggles */}
          <RolePermissionGrants />
        </div>
      )}

      {/* ── Account ── */}
      {activeTab === "connections" && (
        <div className="max-w-2xl space-y-6">
          <BridgeSettings />
          <BMSettings />
          <GameServerSettings />
        </div>
      )}

      {activeTab === "seeding" && (
        <div className="max-w-2xl space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure seeding rewards, connections, Discord integration, and more.
          </p>
          <a
            href="/dashboard/seeding/settings"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-black"
            style={{ background: "var(--accent-primary)" }}
          >
            <Sprout className="h-4 w-4" /> Open Seed Settings
          </a>
          <p className="text-xs text-muted-foreground/60">
            Seeding settings are managed on a dedicated page for the full configuration experience.
          </p>
        </div>
      )}

      {activeTab === "account" && (
        <div className="space-y-6">
          {/* Discord Info */}
          <Card>
            <CardHeader>
              <CardTitle>Discord Account</CardTitle>
              <CardDescription>Your linked Discord identity. Sign out and back in to refresh.</CardDescription>
            </CardHeader>
            <CardContent>
              {session ? (
                <div className="flex items-center gap-4">
                  <Avatar size="lg">
                    <AvatarImage src={avatarUrl(session.discord_id, session.avatar)} alt={session.username} />
                    <AvatarFallback>{session.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="space-y-1">
                    <p className="text-base font-semibold text-foreground">{session.username}</p>
                    <p className="text-xs text-muted-foreground font-mono">{session.discord_id}</p>
                    <Badge variant="outline" className="text-[11px]" style={{ color: "var(--accent-primary)", borderColor: "color-mix(in srgb, var(--accent-primary) 30%, transparent)" }}>
                      Dashboard Admin
                    </Badge>
                  </div>
                </div>
              ) : (
                <Skeleton className="h-16 w-full rounded-lg" />
              )}
            </CardContent>
          </Card>

          {/* Org Timezone */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
                <CardTitle>Organization Timezone</CardTitle>
              </div>
              <CardDescription>
                Used for scheduled reports, audit log timestamps, and daily sync times.
                All members of this server see times in this timezone.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={(v) => setTimezone(v ?? "UTC")}>
                  <SelectTrigger className="w-72">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz.value} value={tz.value}>
                        {tz.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Live clock preview */}
              <div
                className="flex items-center gap-3 rounded-lg border border-white/[0.10] bg-white/[0.02] px-4 py-3"
              >
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-0.5">
                    Current time in {TIMEZONES.find((t) => t.value === timezone)?.label ?? timezone}
                  </p>
                  <LiveClock timezone={timezone} />
                </div>
              </div>
            </CardContent>
          </Card>
          <SaveBar onSave={saveAccount} isPending={saveSettings.isPending} />
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
