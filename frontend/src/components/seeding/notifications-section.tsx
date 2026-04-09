"use client";

import { Bell } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { SeedingCard as Card } from "./settings-helpers";

// ─── In-Game Broadcasts ──────────────────────────────────────────────────────

export interface RconBroadcastCardProps {
  rconBroadcastEnabled: boolean;
  setRconBroadcastEnabled: (v: boolean) => void;
  rconBroadcastMessage: string;
  setRconBroadcastMessage: (v: string) => void;
  rconBroadcastInterval: string;
  setRconBroadcastInterval: (v: string) => void;
}

export function RconBroadcastCard({
  rconBroadcastEnabled, setRconBroadcastEnabled,
  rconBroadcastMessage, setRconBroadcastMessage,
  rconBroadcastInterval, setRconBroadcastInterval,
}: RconBroadcastCardProps) {
  return (
    <Card title="In-Game Seeding Broadcasts">
      <div className="flex items-center gap-3">
        <Switch checked={rconBroadcastEnabled} onCheckedChange={setRconBroadcastEnabled} />
        <Label className="text-sm">{rconBroadcastEnabled ? "Broadcasts enabled" : "Broadcasts disabled"}</Label>
      </div>
      {rconBroadcastEnabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Broadcast message</Label>
            <textarea
              value={rconBroadcastMessage}
              onChange={(e) => setRconBroadcastMessage(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80 resize-none"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
            />
            <p className="text-[10px] text-muted-foreground/70">Variables: {"{player_count}"} {"{threshold}"}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Interval (minutes)</Label>
            <Input type="number" min={5} max={60} value={rconBroadcastInterval} onChange={(e) => setRconBroadcastInterval(e.target.value)} className="h-8 text-xs w-20" />
            <p className="text-[10px] text-muted-foreground/70">How often to send the broadcast to all online players during seeding mode.</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── In-Game Milestone Warnings ──────────────────────────────────────────────

export interface RconWarningsCardProps {
  rconWarningsEnabled: boolean;
  setRconWarningsEnabled: (v: boolean) => void;
  rconWarningMessage: string;
  setRconWarningMessage: (v: string) => void;
}

export function RconWarningsCard({
  rconWarningsEnabled, setRconWarningsEnabled,
  rconWarningMessage, setRconWarningMessage,
}: RconWarningsCardProps) {
  return (
    <Card title="In-Game Milestone Warnings">
      <div className="flex items-center gap-3">
        <Switch checked={rconWarningsEnabled} onCheckedChange={setRconWarningsEnabled} />
        <Label className="text-sm">
          {rconWarningsEnabled ? "Milestone warnings enabled" : "Milestone warnings disabled"}
        </Label>
      </div>
      {rconWarningsEnabled && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Message template</Label>
            <textarea
              value={rconWarningMessage}
              onChange={(e) => setRconWarningMessage(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 resize-none"
              style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
              placeholder="Seeding Progress: {progress}% ({points}/{required}). Keep seeding!"
            />
          </div>
          <div className="rounded-lg bg-black/20 border border-white/[0.10] px-4 py-3 space-y-1.5">
            <p className="text-[10px] font-medium text-white/50 uppercase tracking-wide">Available variables</p>
            <div className="flex flex-wrap gap-1.5">
              {["{progress}", "{points}", "{required}", "{player_name}"].map((v) => (
                <code key={v} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60 font-mono">{v}</code>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">Warnings are sent at milestones: 10%, 25%, 50%, 75%, and 100%</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Discord Channel ─────────────────────────────────────────────────────────

export interface DiscordChannelCardProps {
  discordNotifyChannelId: string;
  setDiscordNotifyChannelId: (v: string) => void;
  channelOptions: ComboboxOption[];
}

export function DiscordChannelCard({ discordNotifyChannelId, setDiscordNotifyChannelId, channelOptions }: DiscordChannelCardProps) {
  return (
    <Card title="Discord Notifications">
      <div className="flex items-center gap-2">
        <Bell className="h-4 w-4 text-white/60" />
        <span className="text-xs text-white/60">Seeding events will be posted to this channel</span>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">Notification channel</Label>
        <Combobox
          options={channelOptions}
          value={discordNotifyChannelId}
          onValueChange={setDiscordNotifyChannelId}
          placeholder="Select channel"
          searchPlaceholder="Search channels..."
          emptyText="No channels found."
        />
      </div>
    </Card>
  );
}

// ─── Custom Embed ────────────────────────────────────────────────────────────

export interface CustomEmbedCardProps {
  customEmbedTitle: string;
  setCustomEmbedTitle: (v: string) => void;
  customEmbedDescription: string;
  setCustomEmbedDescription: (v: string) => void;
  customEmbedImageUrl: string;
  setCustomEmbedImageUrl: (v: string) => void;
  customEmbedColor: string;
  setCustomEmbedColor: (v: string) => void;
}

export function CustomEmbedCard({
  customEmbedTitle, setCustomEmbedTitle,
  customEmbedDescription, setCustomEmbedDescription,
  customEmbedImageUrl, setCustomEmbedImageUrl,
  customEmbedColor, setCustomEmbedColor,
}: CustomEmbedCardProps) {
  return (
    <Card title="Custom Discord Embeds">
      <p className="text-[10px] text-muted-foreground/70">
        Customize the Discord notification for &quot;Server Is Live&quot; events. Leave blank for defaults.
      </p>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Embed Title</Label>
          <Input value={customEmbedTitle} onChange={(e) => setCustomEmbedTitle(e.target.value)} placeholder="Server Is Live!" className="h-8 text-xs" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Embed Description</Label>
          <textarea
            value={customEmbedDescription}
            onChange={(e) => setCustomEmbedDescription(e.target.value)}
            rows={2}
            className="flex w-full rounded-md border border-white/[0.08] px-3 py-2 text-xs text-white/80 resize-none"
            style={{ backgroundColor: "rgba(255,255,255,0.04)", colorScheme: "dark" }}
            placeholder="Server has reached {player_count} players!"
          />
          <p className="text-[10px] text-muted-foreground/70">Variables: {"{player_count}"} {"{threshold}"}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Image URL</Label>
            <Input value={customEmbedImageUrl} onChange={(e) => setCustomEmbedImageUrl(e.target.value)} placeholder="https://..." className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Color</Label>
            <div className="flex gap-2 items-center">
              <input type="color" value={customEmbedColor} onChange={(e) => setCustomEmbedColor(e.target.value)} className="h-8 w-10 rounded border border-white/[0.08] cursor-pointer" style={{ backgroundColor: "transparent" }} />
              <Input value={customEmbedColor} onChange={(e) => setCustomEmbedColor(e.target.value)} placeholder="#10b981" className="h-8 text-xs font-mono flex-1" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
