"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SeedingCard as Card } from "./settings-helpers";

// ─── Discord Role Rewards ────────────────────────────────────────────────────

export interface DiscordRoleRewardCardProps {
  discordRoleRewardEnabled: boolean;
  setDiscordRoleRewardEnabled: (v: boolean) => void;
  discordRoleRewardId: string;
  setDiscordRoleRewardId: (v: string) => void;
  discordRemoveRoleOnExpiry: boolean;
  setDiscordRemoveRoleOnExpiry: (v: boolean) => void;
}

export function DiscordRoleRewardCard({
  discordRoleRewardEnabled, setDiscordRoleRewardEnabled,
  discordRoleRewardId, setDiscordRoleRewardId,
  discordRemoveRoleOnExpiry, setDiscordRemoveRoleOnExpiry,
}: DiscordRoleRewardCardProps) {
  return (
    <Card title="Discord Role Rewards">
      <div className="flex items-center gap-3">
        <Switch checked={discordRoleRewardEnabled} onCheckedChange={setDiscordRoleRewardEnabled} />
        <Label className="text-sm">
          {discordRoleRewardEnabled ? "Role rewards enabled" : "Role rewards disabled"}
        </Label>
      </div>

      {discordRoleRewardEnabled && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reward role ID</Label>
            <Input
              value={discordRoleRewardId}
              onChange={(e) => setDiscordRoleRewardId(e.target.value)}
              placeholder="Discord role ID"
              className="h-8 text-xs"
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              checked={discordRemoveRoleOnExpiry}
              onCheckedChange={setDiscordRemoveRoleOnExpiry}
            />
            <Label className="text-sm">Remove role when reward expires</Label>
          </div>

          <div className="rounded-lg bg-black/20 border border-white/[0.10] px-4 py-3">
            <p className="text-[10px] text-muted-foreground/60">
              When a player reaches the seeding point threshold, they are automatically assigned
              this Discord role. If &quot;remove on expiry&quot; is enabled, the role will be removed once
              their whitelist reward expires.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Auto-Seed Alerts ────────────────────────────────────────────────────────

export interface AutoSeedAlertCardProps {
  autoSeedAlertEnabled: boolean;
  setAutoSeedAlertEnabled: (v: boolean) => void;
  autoSeedAlertRoleId: string;
  setAutoSeedAlertRoleId: (v: string) => void;
  autoSeedAlertCooldownMin: string;
  setAutoSeedAlertCooldownMin: (v: string) => void;
}

export function AutoSeedAlertCard({
  autoSeedAlertEnabled, setAutoSeedAlertEnabled,
  autoSeedAlertRoleId, setAutoSeedAlertRoleId,
  autoSeedAlertCooldownMin, setAutoSeedAlertCooldownMin,
}: AutoSeedAlertCardProps) {
  return (
    <Card title="Auto-Seed Alerts">
      <div className="flex items-center gap-3">
        <Switch checked={autoSeedAlertEnabled} onCheckedChange={setAutoSeedAlertEnabled} />
        <Label className="text-sm">
          {autoSeedAlertEnabled ? "Auto-seed alerts enabled" : "Auto-seed alerts disabled"}
        </Label>
      </div>

      {autoSeedAlertEnabled && (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Alert role ID</Label>
            <Input
              value={autoSeedAlertRoleId}
              onChange={(e) => setAutoSeedAlertRoleId(e.target.value)}
              placeholder="Discord role ID to ping"
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Cooldown (minutes)</Label>
            <Input
              type="number"
              min={5}
              max={120}
              value={autoSeedAlertCooldownMin}
              onChange={(e) => setAutoSeedAlertCooldownMin(e.target.value)}
              placeholder="30"
              className="h-8 text-xs w-32"
            />
          </div>

          <p className="text-[10px] text-muted-foreground/60">
            Pings this role when server drops below the seeding threshold. Cooldown prevents
            alert spam (min 5 minutes, max 120 minutes).
          </p>
        </div>
      )}
    </Card>
  );
}

// ─── Webhook Notifications ───────────────────────────────────────────────────

export interface WebhookCardProps {
  webhookEnabled: boolean;
  setWebhookEnabled: (v: boolean) => void;
  webhookUrl: string;
  setWebhookUrl: (v: string) => void;
}

export function WebhookCard({ webhookEnabled, setWebhookEnabled, webhookUrl, setWebhookUrl }: WebhookCardProps) {
  return (
    <Card title="Webhook Notifications">
      <div className="flex items-center gap-3">
        <Switch checked={webhookEnabled} onCheckedChange={setWebhookEnabled} />
        <Label className="text-sm">{webhookEnabled ? "Webhooks enabled" : "Webhooks disabled"}</Label>
      </div>
      {webhookEnabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Webhook URL</Label>
            <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-server.com/webhook" className="h-8 text-xs" />
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            Receives JSON POST for events: seeding_reward_granted, seeding_server_live, seeding_needs_seeders.
            Payload includes event type, timestamp, and event-specific data.
          </p>
        </div>
      )}
    </Card>
  );
}
