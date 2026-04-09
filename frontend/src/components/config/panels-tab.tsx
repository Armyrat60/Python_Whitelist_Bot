"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PanelTop, Plus, Send, Pencil, Trash2 } from "lucide-react";
import {
  usePanels,
  useWhitelists,
  useChannels,
  useCreatePanel,
  useDeletePanel,
  usePushPanel,
  useUpdatePanel,
} from "@/hooks/use-settings";
import type { Panel } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import PanelConfigSheet from "./panel-config-sheet";

// ─── Status dot helper ──────────────────────────────────────────────────────
function getStatusColor(panel: Panel): string {
  if (panel.last_push_status === "error") return "bg-red-500";
  const hasChannel = !!panel.channel_id;
  const hasWhitelist = !!panel.whitelist_id;
  if (hasChannel && hasWhitelist)
    return panel.last_push_status === "ok" ? "bg-emerald-500" : "bg-yellow-500";
  if (hasChannel || hasWhitelist) return "bg-yellow-500";
  return "bg-red-500/60";
}

export default function PanelsTab() {
  const { data: panels, isLoading: panelsLoading, isError: panelsError } = usePanels();
  const { data: whitelists } = useWhitelists();
  const { data: channels } = useChannels();
  const createPanel = useCreatePanel();
  const deletePanel = useDeletePanel();
  const pushPanel = usePushPanel();
  const updatePanel = useUpdatePanel();

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");

  // Sheet state
  const [sheetPanel, setSheetPanel] = useState<Panel | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  function handlePush(panel: Panel) {
    pushPanel.mutate(panel.id, {
      onSuccess: () =>
        toast.success(
          "Panel refresh queued — Discord will update within 15 seconds"
        ),
      onError: (err: unknown) => {
        const msg =
          (err as { message?: string })?.message ||
          "Failed to queue panel push.";
        toast.error(msg);
      },
    });
  }

  function handleDelete(panel: Panel) {
    deletePanel.mutate(panel.id, {
      onSuccess: () => toast.success("Panel deleted"),
      onError: () => toast.error("Failed to delete panel"),
    });
  }

  function handleToggleEnabled(panel: Panel, checked: boolean) {
    updatePanel.mutate(
      { id: panel.id, enabled: checked },
      {
        onSuccess: () =>
          toast.success(checked ? "Panel enabled" : "Panel disabled"),
        onError: () => toast.error("Failed to toggle panel"),
      }
    );
  }

  function openSheet(panel: Panel) {
    setSheetPanel(panel);
    setSheetOpen(true);
  }

  if (panelsLoading) {
    return (
      <div className="space-y-3 pt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (panelsError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12 text-center">
        <p className="text-sm font-medium text-red-400">Failed to load data</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and refresh the page.
        </p>
      </div>
    );
  }

  const channelsList = channels ?? [];
  const whitelistsList = whitelists ?? [];

  return (
    <div className="space-y-4">
      {!panels || panels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-16 text-center">
          <PanelTop className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No panels yet</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Panels are Discord embeds with buttons that let members sign up for
            the whitelist. Create one, link it to a whitelist, then push it to a
            channel.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">On</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Whitelist</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {panels.map((panel) => {
              const channelName =
                channelsList.find((c) => c.id === panel.channel_id)?.name ??
                null;
              const wlName =
                whitelistsList.find((w) => w.id === panel.whitelist_id)?.name ??
                null;

              return (
                <TableRow key={panel.id}>
                  {/* Status toggle (far left) */}
                  <TableCell>
                    <Switch
                      checked={panel.enabled}
                      onCheckedChange={(checked) =>
                        handleToggleEnabled(panel, checked)
                      }
                    />
                  </TableCell>

                  {/* Name */}
                  <TableCell>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-left hover:underline"
                      onClick={() => openSheet(panel)}
                    >
                      <span
                        className={`inline-block h-2 w-2 shrink-0 rounded-full ${getStatusColor(panel)}`}
                      />
                      <span className="font-medium">{panel.name}</span>
                    </button>
                  </TableCell>

                  {/* Channel */}
                  <TableCell className="text-muted-foreground">
                    {channelName ? `#${channelName}` : "\u2014"}
                  </TableCell>

                  {/* Whitelist */}
                  <TableCell className="text-muted-foreground">
                    {wlName ?? "\u2014"}
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1.5">
                      <Button
                        size="xs"
                        className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                        onClick={() => handlePush(panel)}
                        disabled={
                          pushPanel.isPending ||
                          !panel.channel_id ||
                          !panel.whitelist_id
                        }
                        title={
                          !panel.channel_id && !panel.whitelist_id
                            ? "Configure a channel and whitelist before pushing"
                            : !panel.channel_id
                              ? "Configure a channel before pushing"
                              : !panel.whitelist_id
                                ? "Link a whitelist before pushing"
                                : "Push panel to Discord"
                        }
                      >
                        <Send className="mr-1 h-3 w-3" />
                        Push
                      </Button>

                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => openSheet(panel)}
                      >
                        <Pencil className="mr-1 h-3 w-3" />
                        Configure
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              size="xs"
                              variant="destructive"
                              disabled={deletePanel.isPending}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete {panel.name}?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently remove this panel and all
                              associated data. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => handleDelete(panel)}
                            >
                              Continue
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {/* Create Panel Dialog */}
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

      {/* Panel Config Sheet */}
      {sheetPanel && (
        <PanelConfigSheet
          panel={sheetPanel}
          whitelists={whitelistsList}
          channels={channelsList}
          open={sheetOpen}
          onOpenChange={(open) => {
            setSheetOpen(open);
            if (!open) setSheetPanel(null);
          }}
        />
      )}
    </div>
  );
}
