"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Save, Building2, Trash2 } from "lucide-react";
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

function AppearanceCard({ accent }: { accent: ReturnType<typeof useAccent> }) {
  const { primary, secondary, setPrimary, setSecondary, applyPreset, orgThemeActive } = accent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Choose a color theme for the dashboard. Changes are saved to your browser.
          {orgThemeActive && (
            <span className="ml-1 font-medium" style={{ color: "var(--accent-primary)" }}>
              Org theme is active — your personal preference will show on servers without one.
            </span>
          )}
        </p>

        {/* Live preview bar */}
        <div
          className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3"
          style={{ background: "oklch(0.185 0 0)" }}
        >
          {/* Gradient pill */}
          <div
            className="h-4 w-24 shrink-0 rounded-full"
            style={{ background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)` }}
          />
          <div className="h-4 w-px bg-white/10" />
          {/* Badge previews */}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ color: primary, borderColor: `${primary}40`, background: `${primary}18` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: primary }} />
            Active
          </span>
          <span
            className="hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
            style={{ color: secondary, borderColor: `${secondary}40`, background: `${secondary}15` }}
          >
            Roster
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
              {primary} · {secondary}
            </span>
          </div>
        </div>

        {/* Palette grid */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Themes
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(
              ([name, colors]) => {
                const isActive = primary === colors.primary && secondary === colors.secondary;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => applyPreset(name)}
                    className="group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:scale-[1.03] hover:shadow-lg"
                    style={{
                      borderColor: isActive ? colors.primary : "rgba(255,255,255,0.06)",
                      background: isActive
                        ? `color-mix(in srgb, ${colors.primary} 8%, oklch(0.185 0 0))`
                        : "oklch(0.185 0 0)",
                      boxShadow: isActive
                        ? `0 0 16px ${colors.primary}30, inset 0 0 0 1px ${colors.primary}30`
                        : undefined,
                    }}
                  >
                    {/* Gradient swatch */}
                    <div
                      className="h-9 w-full"
                      style={{
                        background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)`,
                      }}
                    />
                    {/* Label area */}
                    <div className="px-2.5 py-2">
                      <p
                        className="text-[11px] font-semibold leading-tight"
                        style={{ color: isActive ? colors.primary : "rgba(255,255,255,0.85)" }}
                      >
                        {name}
                      </p>
                      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                        {PRESET_TAGS[name]}
                      </p>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* Custom pickers */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Custom
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Primary</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primary}
                  onChange={(e) => setPrimary(e.target.value)}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5"
                />
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
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Secondary</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={secondary}
                  onChange={(e) => setSecondary(e.target.value)}
                  className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5"
                />
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
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Org Theme Card ─── */

function OrgThemeCard({
  orgPrimary,
  orgSecondary,
  onSave,
  onClear,
  isSaving,
}: {
  orgPrimary: string;
  orgSecondary: string;
  onSave: (p: string, s: string) => void;
  onClear: () => void;
  isSaving: boolean;
}) {
  const [localPrimary, setLocalPrimary] = useState(orgPrimary || "#a78bfa");
  const [localSecondary, setLocalSecondary] = useState(orgSecondary || "#fbbf24");
  const hasOrgTheme = Boolean(orgPrimary && orgSecondary);

  // Sync local state when org theme changes externally (e.g. on load)
  useEffect(() => {
    if (orgPrimary) setLocalPrimary(orgPrimary);
    if (orgSecondary) setLocalSecondary(orgSecondary);
  }, [orgPrimary, orgSecondary]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
          <CardTitle>Organization Theme</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          Set a color theme for your whole organization. When active, it overrides
          individual users' personal preferences for this server.
          {hasOrgTheme ? (
            <span className="ml-1 font-medium" style={{ color: "var(--accent-primary)" }}>
              Org theme is currently active.
            </span>
          ) : (
            <span className="ml-1 text-white/40">No org theme set — users see their personal colors.</span>
          )}
        </p>

        {/* Live preview */}
        <div
          className="flex items-center gap-3 rounded-xl border border-white/[0.06] px-4 py-3"
          style={{ background: "oklch(0.185 0 0)" }}
        >
          <div
            className="h-4 w-24 shrink-0 rounded-full"
            style={{ background: `linear-gradient(90deg, ${localPrimary} 0%, ${localSecondary} 100%)` }}
          />
          <div className="h-4 w-px bg-white/10" />
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
            style={{ color: localPrimary, borderColor: `${localPrimary}40`, background: `${localPrimary}18` }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: localPrimary }} />
            Active
          </span>
          <span
            className="hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
            style={{ color: localSecondary, borderColor: `${localSecondary}40`, background: `${localSecondary}15` }}
          >
            Roster
          </span>
          <div className="ml-auto font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
            {localPrimary} · {localSecondary}
          </div>
        </div>

        {/* Preset grid */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Themes</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(
              ([name, colors]) => {
                const isActive = localPrimary === colors.primary && localSecondary === colors.secondary;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { setLocalPrimary(colors.primary); setLocalSecondary(colors.secondary); }}
                    className="group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:scale-[1.03] hover:shadow-lg"
                    style={{
                      borderColor: isActive ? colors.primary : "rgba(255,255,255,0.06)",
                      background: isActive
                        ? `color-mix(in srgb, ${colors.primary} 8%, oklch(0.185 0 0))`
                        : "oklch(0.185 0 0)",
                      boxShadow: isActive ? `0 0 16px ${colors.primary}30, inset 0 0 0 1px ${colors.primary}30` : undefined,
                    }}
                  >
                    <div
                      className="h-9 w-full"
                      style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }}
                    />
                    <div className="px-2.5 py-2">
                      <p
                        className="text-[11px] font-semibold leading-tight"
                        style={{ color: isActive ? colors.primary : "rgba(255,255,255,0.85)" }}
                      >
                        {name}
                      </p>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        </div>

        {/* Custom pickers */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Custom Colors</p>
          <div className="flex gap-3">
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
              <input
                type="color"
                value={localPrimary}
                onChange={(e) => setLocalPrimary(e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Primary color"
              />
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Primary</Label>
              <input
                type="text"
                value={localPrimary}
                onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setLocalPrimary(e.target.value); }}
                className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase text-foreground focus:outline-none focus:ring-1"
                maxLength={7}
              />
            </div>
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
              <input
                type="color"
                value={localSecondary}
                onChange={(e) => setLocalSecondary(e.target.value)}
                className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                title="Secondary color"
              />
              <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Secondary</Label>
              <input
                type="text"
                value={localSecondary}
                onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setLocalSecondary(e.target.value); }}
                className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase text-foreground focus:outline-none focus:ring-1"
                maxLength={7}
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={isSaving}
            onClick={() => onSave(localPrimary, localSecondary)}
            style={{ background: "var(--accent-primary)", color: "#fff" }}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Apply to Organization
          </Button>
          {hasOrgTheme && (
            <Button
              size="sm"
              variant="outline"
              disabled={isSaving}
              onClick={onClear}
              className="text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear Org Theme
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const { data: roles } = useRoles();
  const { data: channels } = useChannels();
  const saveSettings = useSaveSettings();
  const accent = useAccent();

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

  function handleSaveOrgTheme(p: string, s: string) {
    saveSettings.mutate(
      { accent_primary: p, accent_secondary: s } as Partial<Settings>,
      {
        onSuccess: () => toast.success("Organization theme saved"),
        onError: () => toast.error("Failed to save org theme"),
      }
    );
  }

  function handleClearOrgTheme() {
    saveSettings.mutate(
      { accent_primary: "", accent_secondary: "" } as Partial<Settings>,
      {
        onSuccess: () => toast.success("Organization theme cleared"),
        onError: () => toast.error("Failed to clear org theme"),
      }
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Appearance */}
      <AppearanceCard accent={accent} />

      {/* Org Theme */}
      <OrgThemeCard
        orgPrimary={(form as Record<string, string>).accent_primary ?? ""}
        orgSecondary={(form as Record<string, string>).accent_secondary ?? ""}
        onSave={handleSaveOrgTheme}
        onClear={handleClearOrgTheme}
        isSaving={saveSettings.isPending}
      />

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
