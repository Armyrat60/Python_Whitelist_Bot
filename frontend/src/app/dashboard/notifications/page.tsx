"use client";

import { useState, useEffect } from "react";
import { Bell, Send, Save } from "lucide-react";
import { toast } from "sonner";
import { useNotifications, useSaveNotifications, useTriggerReport } from "@/hooks/use-settings";
import { useChannels } from "@/hooks/use-settings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

export default function NotificationsPage() {
  const { data, isLoading } = useNotifications();
  const { data: channels } = useChannels();
  const save = useSaveNotifications();
  const triggerReport = useTriggerReport();

  // Local routing state: event_type → channel_id (empty string = disabled)
  const [routing, setRouting] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // Seed local state when API data loads
  useEffect(() => {
    if (data?.routing) {
      setRouting(data.routing);
      setDirty(false);
    }
  }, [data]);

  function setChannel(eventType: string, channelId: string) {
    setRouting((prev) => ({ ...prev, [eventType]: channelId === "__none__" ? "" : channelId }));
    setDirty(true);
  }

  function handleSave() {
    save.mutate(routing, {
      onSuccess: () => {
        toast.success("Notification routing saved");
        setDirty(false);
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

  const eventTypes = data?.event_types ?? {};

  // Group event types visually
  const groups: { label: string; events: string[] }[] = [
    {
      label: "User Events",
      events: ["user_joined", "user_removed", "user_left_discord"],
    },
    {
      label: "Role Events",
      events: ["role_lost", "role_returned"],
    },
    {
      label: "Reports & Alerts",
      events: ["report", "bot_alert", "admin_action"],
    },
  ];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Bell className="h-5 w-5" /> Notification Routing
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose which Discord channel receives each type of notification.
            Leave a channel unset to disable that notification type.
            All events are still recorded in the Audit Log regardless of routing.
          </p>
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
            onClick={handleSave}
            disabled={!dirty || save.isPending}
          >
            <Save className="h-4 w-4 mr-1.5" />
            {save.isPending ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const visibleEvents = group.events.filter((e) => eventTypes[e]);
            if (visibleEvents.length === 0) return null;
            return (
              <Card key={group.label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                    {group.label}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {visibleEvents.map((eventType) => {
                    const info = eventTypes[eventType];
                    const currentChannel = routing[eventType] ?? "";
                    return (
                      <div
                        key={eventType}
                        className="flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{info.label}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {info.description}
                          </p>
                        </div>
                        <Select
                          value={currentChannel || "__none__"}
                          onValueChange={(v) => setChannel(eventType, v ?? "")}
                        >
                          <SelectTrigger className="w-52 shrink-0">
                            <SelectValue placeholder="Disabled" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              <span className="text-muted-foreground">Disabled</span>
                            </SelectItem>
                            {channels?.map((ch) => (
                              <SelectItem key={ch.id} value={ch.id}>
                                #{ch.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Tip: You can point multiple event types at the same channel for a single
        combined feed, or use separate channels for better signal-to-noise.
      </p>
    </div>
  );
}
