"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Save,
  Send,
  X,
  Pencil,
} from "lucide-react";
import {
  usePanels,
  useWhitelists,
  useChannels,
  useCreatePanel,
  useUpdatePanel,
  useDeletePanel,
  usePushPanel,
  useTierCategories,
} from "@/hooks/use-settings";
import type { Panel, Whitelist, TierCategory } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Combobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";

export default function PanelsPage() {
  const { data: panels, isLoading: panelsLoading } = usePanels();
  const { data: whitelists } = useWhitelists();
  const { data: channels } = useChannels();
  const { data: tierCategories } = useTierCategories();
  const createPanel = useCreatePanel();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  function handleCreate() {
    if (!newName.trim()) return;
    createPanel.mutate(
      { name: newName.trim() },
      {
        onSuccess: () => {
          toast.success("Panel created");
          setNewName("");
          setCreateOpen(false);
        },
        onError: () => toast.error("Failed to create panel"),
      }
    );
  }

  if (panelsLoading) {
    return (
      <div className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-56 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {panels?.map((panel) => (
          <PanelCard
            key={panel.id}
            panel={panel}
            whitelists={whitelists ?? []}
            channels={channels ?? []}
            tierCategories={tierCategories ?? []}
          />
        ))}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogTrigger
          render={
            <Button variant="outline">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create Panel
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Panel</DialogTitle>
            <DialogDescription>
              Give your new panel a name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Whitelist Panel"
            />
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={createPanel.isPending}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Status dot helper ──────────────────────────────────────────────────────
function getStatusColor(panel: Panel): string {
  const hasChannel = !!panel.channel_id;
  const hasWhitelist = !!panel.whitelist_id;
  // Green if channel + whitelist both set, yellow if partially configured, red if nothing
  if (hasChannel && hasWhitelist) return "bg-emerald-500";
  if (hasChannel || hasWhitelist) return "bg-yellow-500";
  return "bg-red-500";
}

function PanelCard({
  panel,
  whitelists,
  channels,
  tierCategories,
}: {
  panel: Panel;
  whitelists: Whitelist[];
  channels: { id: string; name: string }[];
  tierCategories: TierCategory[];
}) {
  const updatePanel = useUpdatePanel();
  const deletePanel = useDeletePanel();
  const pushPanel = usePushPanel();

  const [configMode, setConfigMode] = useState(false);
  const [channelId, setChannelId] = useState(panel.channel_id ?? "");
  const [logChannelId, setLogChannelId] = useState(panel.log_channel_id ?? "");
  const [whitelistId, setWhitelistId] = useState(
    panel.whitelist_id?.toString() ?? ""
  );
  const [tierCategoryId, setTierCategoryId] = useState(
    panel.tier_category_id?.toString() ?? ""
  );
  const [panelName, setPanelName] = useState(panel.name);
  const [enabled, setEnabled] = useState(panel.enabled ?? true);

  const channelName =
    channels.find((c) => c.id === panel.channel_id)?.name ?? "None";
  const logChannelName =
    channels.find((c) => c.id === panel.log_channel_id)?.name ?? "None";
  const wlName =
    whitelists.find((w) => w.id === panel.whitelist_id)?.name ?? "None";

  // Find the selected tier category for this panel
  const selectedCategory = tierCategories.find(
    (cat) => cat.id === panel.tier_category_id
  );

  // Sorted tier entries from the selected category
  const tierEntries = useMemo(() => {
    if (!selectedCategory) return [];
    return [...selectedCategory.entries].sort(
      (a, b) => a.sort_order - b.sort_order || a.slot_limit - b.slot_limit
    );
  }, [selectedCategory]);

  const channelOptions: ComboboxOption[] = useMemo(
    () => channels.map((ch) => ({ value: ch.id, label: `#${ch.name}` })),
    [channels]
  );

  const whitelistOptions: ComboboxOption[] = useMemo(
    () => whitelists.map((wl) => ({ value: String(wl.id), label: wl.name })),
    [whitelists]
  );

  const tierCategoryOptions: ComboboxOption[] = useMemo(
    () =>
      tierCategories.map((cat) => ({
        value: String(cat.id),
        label: cat.name,
      })),
    [tierCategories]
  );

  function handleSave() {
    updatePanel.mutate(
      {
        id: panel.id,
        name: panelName.trim() || panel.name,
        channel_id: channelId || null,
        log_channel_id: logChannelId || null,
        whitelist_id: whitelistId ? Number(whitelistId) : null,
        tier_category_id: tierCategoryId ? Number(tierCategoryId) : null,
      },
      {
        onSuccess: () => {
          toast.success("Panel saved");
          setConfigMode(false);
        },
        onError: () => toast.error("Failed to save panel"),
      }
    );
  }

  function handleCancel() {
    setChannelId(panel.channel_id ?? "");
    setLogChannelId(panel.log_channel_id ?? "");
    setWhitelistId(panel.whitelist_id?.toString() ?? "");
    setTierCategoryId(panel.tier_category_id?.toString() ?? "");
    setPanelName(panel.name);
    setConfigMode(false);
  }

  function handlePush() {
    pushPanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel pushed to Discord!"),
      onError: (err: unknown) => {
        const msg = (err as { message?: string })?.message || "Failed to push panel. Check bot permissions.";
        toast.error(msg);
      },
    });
  }

  function handleDelete() {
    deletePanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel deleted"),
      onError: () => toast.error("Failed to delete panel"),
    });
  }

  return (
    <Card className={!enabled ? "opacity-50" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${getStatusColor(panel)}`} />
          {panel.name}
          {panel.is_default && (
            <Badge variant="secondary" className="text-[10px]">
              Default
            </Badge>
          )}
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              updatePanel.mutate(
                { id: panel.id, enabled: checked },
                {
                  onSuccess: () => toast.success(checked ? "Panel enabled" : "Panel disabled"),
                  onError: () => { setEnabled(!checked); toast.error("Failed to toggle panel"); },
                }
              );
            }}
            className="ml-auto scale-75"
          />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Always show badges summary */}
        <div className="flex flex-wrap gap-1.5">
          {panel.channel_id && (
            <Badge variant="outline">#{channelName}</Badge>
          )}
          {panel.log_channel_id && (
            <Badge variant="outline">Log: #{logChannelName}</Badge>
          )}
          {panel.whitelist_id && (
            <Badge variant="outline">{wlName}</Badge>
          )}
          {selectedCategory && (
            <Badge variant="outline" className="border-orange-500/30 text-orange-400">
              {selectedCategory.name}
            </Badge>
          )}
          {!panel.channel_id && !panel.whitelist_id && (
            <span className="text-xs text-muted-foreground">Not configured</span>
          )}
        </div>

        {/* Tier summary from tier category entries -- always visible */}
        {tierEntries.length > 0 && (
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2">
            <p className="text-[10px] font-semibold uppercase text-orange-400/70 mb-1">Tiers</p>
            <div className="flex flex-wrap gap-1">
              {tierEntries.map((entry) => (
                <Badge
                  key={entry.id}
                  variant="secondary"
                  className="text-[10px] cursor-help"
                  title={`Role ID: ${entry.role_id}`}
                >
                  @{entry.role_name} = {entry.slot_limit} {entry.slot_limit === 1 ? "slot" : "slots"}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Configure mode: show dropdowns + name field */}
        {configMode && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Name</Label>
              <Input
                value={panelName}
                onChange={(e) => setPanelName(e.target.value)}
                placeholder="Panel name"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Channel</Label>
              <Combobox
                options={channelOptions}
                value={channelId}
                onValueChange={setChannelId}
                placeholder="Select channel"
                searchPlaceholder="Search channels..."
                emptyText="No channels found."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Log Channel</Label>
              <Combobox
                options={channelOptions}
                value={logChannelId}
                onValueChange={setLogChannelId}
                placeholder="Select log channel"
                searchPlaceholder="Search channels..."
                emptyText="No channels found."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Whitelist</Label>
              <Combobox
                options={whitelistOptions}
                value={whitelistId}
                onValueChange={setWhitelistId}
                placeholder="Select whitelist"
                searchPlaceholder="Search whitelists..."
                emptyText="No whitelists found."
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Tier Category</Label>
              <Combobox
                options={tierCategoryOptions}
                value={tierCategoryId}
                onValueChange={setTierCategoryId}
                placeholder="Select tier category"
                searchPlaceholder="Search categories..."
                emptyText="No tier categories found."
              />
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {configMode ? (
          <>
            <Button
              size="sm"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={handleSave}
              disabled={updatePanel.isPending}
            >
              <Save className="mr-1 h-3 w-3" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
            >
              <X className="mr-1 h-3 w-3" />
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={handlePush}
              disabled={pushPanel.isPending}
            >
              <Send className="mr-1 h-3 w-3" />
              Push
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => setConfigMode(true)}
            >
              <Pencil className="mr-1 h-3 w-3" />
              Configure
            </Button>
          </>
        )}
        {!panel.is_default && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deletePanel.isPending}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete {panel.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently remove this panel and all associated data. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={handleDelete}>
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </CardFooter>
    </Card>
  );
}
