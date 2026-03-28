"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Save, Building2, Trash2, Settings2, Bell, Palette,
  Shield, User, Globe, Crown, Lock, ChevronRight, Clock,
} from "lucide-react";
import {
  useSettings,
  useRoles,
  useChannels,
  useSaveSettings,
} from "@/hooks/use-settings";
import { useSession } from "@/hooks/use-session";
import type { Settings } from "@/lib/types";
import { useAccent, ACCENT_PRESETS, type PresetName } from "@/components/accent-context";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
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
type Tab = "general" | "notifications" | "appearance" | "permissions" | "account";

const TABS: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "general",       label: "General",       icon: Settings2 },
  { id: "notifications", label: "Notifications",  icon: Bell },
  { id: "appearance",    label: "Appearance",     icon: Palette },
  { id: "permissions",   label: "Permissions",    icon: Shield },
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

const PRESET_TAGS: Record<string, string> = {
  "Operator":     "Military · Default",
  "Command Gold": "Authority · Premium",
  "Spectre":      "Elite · Mysterious",
  "Crimson":      "Alert · Danger",
  "Arctic":       "Precision · Intel",
  "Cobalt":       "Clean · Enterprise",
  "Night Vision": "NVG · High-Tech",
  "Phantom":      "Esports · Flair",
};

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
  const router = useRouter();

  const botSettings = data?.bot_settings as Record<string, string> | undefined;

  /* ── General form state ── */
  const [autoReactivate, setAutoReactivate] = useState("true");
  const [welcomeDmEnabled, setWelcomeDmEnabled] = useState("false");
  const [welcomeDmText, setWelcomeDmText]       = useState("");
  const [allowDuplicates, setAllowDuplicates]   = useState("true");
  const [botStatusMsg, setBotStatusMsg]          = useState("");

  /* ── Notifications form state ── */
  const [reportFreq, setReportFreq]       = useState("disabled");
  const [notifChannelId, setNotifChannelId] = useState("");

  /* ── Permissions form state ── */
  const [modRoleIds, setModRoleIds]         = useState<string[]>([]);
  const [rolesPopoverOpen, setRolesPopoverOpen] = useState(false);

  /* ── Account / Timezone form state ── */
  const [timezone, setTimezone] = useState("UTC");

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
    setModRoleIds(
      botSettings.mod_role_id
        ? botSettings.mod_role_id.split(",").filter(Boolean)
        : []
    );
  }, [botSettings]);

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
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReactivate, welcomeDmEnabled, welcomeDmText, allowDuplicates, botStatusMsg]);

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
    <div className="mx-auto max-w-2xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure your server's whitelist bot and dashboard preferences.
        </p>
      </div>

      {/* Tab nav */}
      <div className="mb-6 flex gap-1 border-b border-white/[0.06]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (t.id === "notifications") {
                  router.push("/dashboard/notifications");
                } else {
                  setActiveTab(t.id);
                }
              }}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors",
                active
                  ? "border-[var(--accent-primary)] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground/80"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

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
                <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
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
          <SaveBar onSave={saveGeneral} isPending={saveSettings.isPending} />
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
          {/* Hierarchy explanation */}
          <Card>
            <CardHeader>
              <CardTitle>Permission Hierarchy</CardTitle>
              <CardDescription>
                How dashboard access is determined for each Discord member.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-0">
              {[
                {
                  icon: Crown,
                  label: "Server Owner",
                  color: "#F59E0B",
                  desc: "Always has full access. Cannot be restricted.",
                  auto: true,
                },
                {
                  icon: Shield,
                  label: "Discord Administrator / Manage Server",
                  color: "#6366F1",
                  desc: "Members with Administrator or Manage Server permission get full access automatically.",
                  auto: true,
                },
                {
                  icon: Lock,
                  label: "Custom Admin Roles",
                  color: "var(--accent-primary)",
                  desc: "Roles you assign below. Full dashboard access for whitelisting and management.",
                  auto: false,
                },
              ].map((tier, i) => (
                <div key={i} className="flex gap-3 py-3 border-b border-white/[0.05] last:border-0">
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: `${tier.color}18`, border: `1px solid ${tier.color}30` }}
                  >
                    <tier.icon className="h-3.5 w-3.5" style={{ color: tier.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{tier.label}</span>
                      {tier.auto && (
                        <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
                          Auto-detected
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{tier.desc}</p>
                  </div>
                  {i < 2 && (
                    <ChevronRight className="h-4 w-4 shrink-0 self-center text-white/20" />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

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
                Members with any of these roles will get full dashboard access.
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
                    <Badge key={id} variant="secondary" className="gap-1">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: role?.color || "#99AAB5" }}
                      />
                      {role?.name ?? id}
                      <button
                        onClick={() => setModRoleIds((prev) => prev.filter((x) => x !== id))}
                        className="ml-0.5 rounded-full opacity-70 hover:opacity-100"
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
          </Card>
          <SaveBar onSave={savePermissions} isPending={saveSettings.isPending} />
        </div>
      )}

      {/* ── Account ── */}
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
                className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3"
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
  );
}

/* ─── Personal Theme Card ─── */
function PersonalThemeCard({ accent }: { accent: ReturnType<typeof useAccent> }) {
  const { primary, secondary, setPrimary, setSecondary, applyPreset, orgThemeActive } = accent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Theme</CardTitle>
        <CardDescription>
          Your personal color preference. Saved to this browser only.
          {orgThemeActive && (
            <span className="ml-1" style={{ color: "var(--accent-primary)" }}>
              Org theme is active on this server — your preference shows on servers without one.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Preview bar */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3" style={{ background: "oklch(0.185 0 0)" }}>
          <div className="h-4 w-24 shrink-0 rounded-full" style={{ background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)` }} />
          <div className="h-4 w-px bg-white/10" />
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: primary, borderColor: `${primary}40`, background: `${primary}18` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: primary }} />Active
          </span>
          <span className="hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium" style={{ color: secondary, borderColor: `${secondary}40`, background: `${secondary}15` }}>Roster</span>
          <div className="ml-auto font-mono text-[10px] text-muted-foreground uppercase tracking-widest">{primary} · {secondary}</div>
        </div>

        {/* Preset grid */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Themes</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(([name, colors]) => {
              const isActive = primary === colors.primary && secondary === colors.secondary;
              return (
                <button key={name} type="button" onClick={() => applyPreset(name)}
                  className="group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:scale-[1.03]"
                  style={{ borderColor: isActive ? colors.primary : "rgba(255,255,255,0.06)", background: isActive ? `color-mix(in srgb, ${colors.primary} 8%, oklch(0.185 0 0))` : "oklch(0.185 0 0)", boxShadow: isActive ? `0 0 16px ${colors.primary}30` : undefined }}
                >
                  <div className="h-9 w-full" style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }} />
                  <div className="px-2.5 py-2">
                    <p className="text-[11px] font-semibold" style={{ color: isActive ? colors.primary : "rgba(255,255,255,0.85)" }}>{name}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{PRESET_TAGS[name]}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom pickers */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Custom</p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Primary", value: primary, onChange: setPrimary },
              { label: "Secondary", value: secondary, onChange: setSecondary },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5" />
                  <input type="text" value={value}
                    onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value); }}
                    className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase focus:outline-none" maxLength={7} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Org Theme Card ─── */
function OrgThemeCard({
  orgPrimary, orgSecondary, onSave, onClear, isSaving,
}: {
  orgPrimary: string; orgSecondary: string;
  onSave: (p: string, s: string) => void;
  onClear: () => void;
  isSaving: boolean;
}) {
  const [localPrimary, setLocalPrimary]     = useState(orgPrimary || "#a78bfa");
  const [localSecondary, setLocalSecondary] = useState(orgSecondary || "#fbbf24");
  const hasOrgTheme = Boolean(orgPrimary && orgSecondary);

  useEffect(() => {
    if (orgPrimary)   setLocalPrimary(orgPrimary);
    if (orgSecondary) setLocalSecondary(orgSecondary);
  }, [orgPrimary, orgSecondary]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
          <CardTitle>Organization Theme</CardTitle>
        </div>
        <CardDescription>
          Overrides personal themes for all members of this server.
          {hasOrgTheme
            ? <span className="ml-1 font-medium" style={{ color: "var(--accent-primary)" }}>Org theme is active.</span>
            : <span className="ml-1 text-white/40">Not set — members see their personal colors.</span>
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Preview */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3" style={{ background: "oklch(0.185 0 0)" }}>
          <div className="h-4 w-24 shrink-0 rounded-full" style={{ background: `linear-gradient(90deg, ${localPrimary} 0%, ${localSecondary} 100%)` }} />
          <div className="h-4 w-px bg-white/10" />
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: localPrimary, borderColor: `${localPrimary}40`, background: `${localPrimary}18` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: localPrimary }} />Active
          </span>
          <div className="ml-auto font-mono text-[10px] text-muted-foreground uppercase tracking-widest">{localPrimary} · {localSecondary}</div>
        </div>

        {/* Preset grid */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Themes</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(([name, colors]) => {
              const isActive = localPrimary === colors.primary && localSecondary === colors.secondary;
              return (
                <button key={name} type="button" onClick={() => { setLocalPrimary(colors.primary); setLocalSecondary(colors.secondary); }}
                  className="group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:scale-[1.03]"
                  style={{ borderColor: isActive ? colors.primary : "rgba(255,255,255,0.06)", background: isActive ? `color-mix(in srgb, ${colors.primary} 8%, oklch(0.185 0 0))` : "oklch(0.185 0 0)", boxShadow: isActive ? `0 0 16px ${colors.primary}30` : undefined }}
                >
                  <div className="h-9 w-full" style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }} />
                  <div className="px-2.5 py-2">
                    <p className="text-[11px] font-semibold" style={{ color: isActive ? colors.primary : "rgba(255,255,255,0.85)" }}>{name}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color pickers */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Custom Colors</p>
          <div className="flex gap-3">
            {[
              { label: "Primary", value: localPrimary, onChange: setLocalPrimary },
              { label: "Secondary", value: localSecondary, onChange: setLocalSecondary },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
                <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
                <input type="text" value={value}
                  onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value); }}
                  className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase focus:outline-none" maxLength={7} />
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button size="sm" disabled={isSaving} onClick={() => onSave(localPrimary, localSecondary)}
            style={{ background: "var(--accent-primary)", color: "#fff" }}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Apply to Organization
          </Button>
          {hasOrgTheme && (
            <Button size="sm" variant="outline" disabled={isSaving} onClick={onClear}
              className="text-muted-foreground hover:text-foreground">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear Org Theme
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
