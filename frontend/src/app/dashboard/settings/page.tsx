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

export default function SettingsPage() {
  const { data, isLoading } = useSettings();
  const { data: roles } = useRoles();
  const { data: channels } = useChannels();
  const saveSettings = useSaveSettings();

  const [form, setForm] = useState<Partial<Settings>>({});
  const [modRoleIds, setModRoleIds] = useState<string[]>([]);
  const [rolesPopoverOpen, setRolesPopoverOpen] = useState(false);

  useEffect(() => {
    if (data?.settings) {
      setForm(data.settings);
      setModRoleIds(
        data.settings.mod_role_id
          ? data.settings.mod_role_id.split(",").filter(Boolean)
          : []
      );
    }
  }, [data?.settings]);

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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
          <Select
            value={form.notification_channel_id ?? ""}
            onValueChange={(v) => updateField("notification_channel_id", v ?? "")}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              {channels?.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  #{ch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
