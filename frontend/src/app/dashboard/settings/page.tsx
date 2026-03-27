"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save } from "lucide-react";
import {
  useSettings,
  useRoles,
  useChannels,
  useSaveSettings,
} from "@/hooks/use-settings";
import type { Settings } from "@/lib/types";
import { useAccent, ACCENT_PRESETS, type PresetName } from "@/components/accent-context";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Combobox } from "@/components/ui/combobox";

const TIMEZONES = [
  "UTC",
  "US/Eastern",
  "US/Central",
  "US/Mountain",
  "US/Pacific",
  "Europe/London",
  "Europe/Berlin",
];

const REPORT_FREQUENCIES = [
  { value: "disabled", label: "Disabled" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
];

/* ─── Appearance Card ─── */

function ColorSwatch({
  color,
  active,
  onClick,
}: {
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 w-7 rounded-full border-2 transition-all duration-150 hover:scale-110"
      style={{
        background: color,
        borderColor: active ? "white" : "transparent",
        boxShadow: active
          ? `0 0 0 1px ${color}, 0 0 8px ${color}60`
          : "none",
      }}
      title={color}
    />
  );
}

function AppearanceCard({ accent }: { accent: ReturnType<typeof useAccent> }) {
  const { primary, secondary, setPrimary, setSecondary, applyPreset } = accent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Customize the accent colors used throughout the dashboard. Changes are saved locally.
        </p>

        {/* Live preview strip */}
        <div
          className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-4 py-3"
          style={{ background: "oklch(0.13 0.015 240)" }}
        >
          <div
            className="h-3 w-3 rounded-full"
            style={{ background: primary, boxShadow: `0 0 8px ${primary}80` }}
          />
          <span className="text-xs font-medium" style={{ color: primary }}>
            Primary Accent
          </span>
          <div className="mx-2 h-4 w-px bg-white/10" />
          <div
            className="h-3 w-3 rounded-full"
            style={{ background: secondary, boxShadow: `0 0 8px ${secondary}80` }}
          />
          <span className="text-xs font-medium" style={{ color: secondary }}>
            Secondary Accent
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                color: primary,
                borderColor: `${primary}40`,
                background: `${primary}15`,
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: primary }} />
              Active
            </span>
            <span
              className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
              style={{
                color: secondary,
                borderColor: `${secondary}40`,
                background: `${secondary}15`,
              }}
            >
              Roster
            </span>
          </div>
        </div>

        {/* Presets */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Presets
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(
              ([name, colors]) => {
                const isActive =
                  primary === colors.primary && secondary === colors.secondary;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyPreset(name)}
                    className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all duration-150 hover:scale-[1.02]"
                    style={{
                      borderColor: isActive ? colors.primary : "rgba(255,255,255,0.08)",
                      background: isActive
                        ? `color-mix(in srgb, ${colors.primary} 10%, transparent)`
                        : "rgba(255,255,255,0.03)",
                      color: isActive ? colors.primary : "#9CA3AF",
                    }}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-white/20"
                      style={{ background: colors.primary }}
                    />
                    <span
                      className="h-3 w-3 rounded-full border border-white/20"
                      style={{ background: colors.secondary }}
                    />
                    {name}
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* Custom pickers */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Primary Color</Label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5"
                />
              </div>
              <input
                type="text"
                value={primary}
                onChange={(e) => {
                  if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                    setPrimary(e.target.value);
                  }
                }}
                className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase text-foreground focus:outline-none focus:ring-1"
                style={{ "--tw-ring-color": primary } as React.CSSProperties}
                maxLength={7}
                placeholder="#22C55E"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Secondary Color</Label>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="color"
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                  className="h-8 w-8 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5"
                />
              </div>
              <input
                type="text"
                value={secondary}
                onChange={(e) => {
                  if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                    setSecondary(e.target.value);
                  }
                }}
                className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase text-foreground focus:outline-none focus:ring-1"
                style={{ "--tw-ring-color": secondary } as React.CSSProperties}
                maxLength={7}
                placeholder="#38BDF8"
              />
            </div>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Primary controls active nav, badges, and progress bars. Secondary controls row highlights and selection rings.
        </p>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const { data: roles } = useRoles();
  const { data: channels } = useChannels();
  const saveSettings = useSaveSettings();

  const [form, setForm] = useState<Partial<Settings>>({});
  const [modRoleIds, setModRoleIds] = useState<string[]>([]);
  const [rolesPopoverOpen, setRolesPopoverOpen] = useState(false);

  useEffect(() => {
    if (data?.bot_settings) {
      setForm(data.bot_settings as unknown as Settings);
      setModRoleIds(
        data.bot_settings.mod_role_id
          ? data.bot_settings.mod_role_id.split(",").filter(Boolean)
          : []
      );
    }
  }, [data?.bot_settings]);

  function updateField<K extends keyof Settings>(key: K, value: Settings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSave() {
    const payload = {
      ...form,
      mod_role_id: modRoleIds.join(","),
    };
    saveSettings.mutate(payload, {
      onSuccess: () => toast.success("Settings saved"),
      onError: () => toast.error("Failed to save settings"),
    });
  }

  function addModRole(roleId: string) {
    if (!modRoleIds.includes(roleId)) {
      setModRoleIds((prev) => [...prev, roleId]);
    }
  }

  function removeModRole(roleId: string) {
    setModRoleIds((prev) => prev.filter((id) => id !== roleId));
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  const accent = useAccent();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Appearance */}
      <AppearanceCard accent={accent} />

      {/* Mod Roles */}
      <Card>
        <CardHeader>
          <CardTitle>Mod Roles</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Users with any of these roles can access the admin dashboard.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {modRoleIds.map((id) => {
              const role = roles?.find((r) => r.id === id);
              return (
                <Badge key={id} variant="secondary" className="gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      backgroundColor: role?.color || "#99AAB5",
                    }}
                  />
                  {role?.name ?? id}
                  <button
                    onClick={() => removeModRole(id)}
                    className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            })}
          </div>
          <Popover open={rolesPopoverOpen} onOpenChange={setRolesPopoverOpen}>
            <PopoverTrigger
              render={<Button variant="outline" size="sm" />}
            >
              Add Role
            </PopoverTrigger>
            <PopoverContent className="w-56 p-0">
              <Command>
                <CommandInput placeholder="Search role..." />
                <CommandList>
                  <CommandEmpty>No roles found.</CommandEmpty>
                  <CommandGroup>
                    {roles
                      ?.filter((r) => !modRoleIds.includes(r.id))
                      .map((role) => (
                        <CommandItem
                          key={role.id}
                          onSelect={() => {
                            addModRole(role.id);
                            setRolesPopoverOpen(false);
                          }}
                        >
                          <span
                            className="mr-2 inline-block h-3 w-3 rounded-full"
                            style={{
                              backgroundColor: role.color || "#99AAB5",
                            }}
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

      {/* Report Frequency */}
      <Card>
        <CardHeader>
          <CardTitle>Report Frequency</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={form.report_frequency ?? "disabled"}
            onValueChange={(v) => updateField("report_frequency", v ?? "disabled")}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_FREQUENCIES.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Notification Channel */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Channel</CardTitle>
        </CardHeader>
        <CardContent>
          <Combobox
            options={(channels ?? []).map((ch) => ({ value: ch.id, label: `#${ch.name}` }))}
            value={form.notification_channel_id ?? ""}
            onValueChange={(v) => updateField("notification_channel_id", v)}
            placeholder="Select channel"
            searchPlaceholder="Search channels..."
            emptyText="No channels found."
            className="w-64"
          />
        </CardContent>
      </Card>

      {/* Toggles */}
      <Card>
        <CardHeader>
          <CardTitle>Behavior</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Auto-Remove on Role Loss</Label>
              <p className="text-xs text-muted-foreground">
                Automatically deactivate whitelist when role is lost.
              </p>
            </div>
            <Switch
              checked={form.auto_reactivate_on_role_return === "true"}
              onCheckedChange={(val) =>
                updateField(
                  "auto_reactivate_on_role_return",
                  String(val)
                )
              }
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Welcome DM</Label>
              <p className="text-xs text-muted-foreground">
                Send a DM to users when added to a whitelist.
              </p>
            </div>
            <Switch
              checked={form.welcome_dm_enabled === "true"}
              onCheckedChange={(val) =>
                updateField("welcome_dm_enabled", String(val))
              }
            />
          </div>

          {form.welcome_dm_enabled === "true" && (
            <div className="space-y-2">
              <Label>Welcome Message</Label>
              <Textarea
                value={form.welcome_dm_text ?? ""}
                onChange={(e) =>
                  updateField("welcome_dm_text", e.target.value)
                }
                placeholder="Welcome to the whitelist!"
                rows={3}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <div>
              <Label>Duplicate ID Policy</Label>
              <p className="text-xs text-muted-foreground">
                Allow the same Steam/EOS ID on multiple whitelists.
              </p>
            </div>
            <Switch
              checked={form.allow_global_duplicates === "true"}
              onCheckedChange={(val) =>
                updateField("allow_global_duplicates", String(val))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Timezone */}
      <Card>
        <CardHeader>
          <CardTitle>Timezone</CardTitle>
        </CardHeader>
        <CardContent>
          <Select
            value={form.timezone ?? "UTC"}
            onValueChange={(v) => updateField("timezone", v ?? "UTC")}
          >
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={handleSave}
          disabled={saveSettings.isPending}
        >
          <Save className="mr-1.5 h-4 w-4" />
          Save Settings
        </Button>
      </div>
    </div>
  );
}
