"use client";

import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Copy, Shield, Settings } from "lucide-react";
import {
  useWhitelists,
  useGroups,
  useToggleWhitelist,
  useCreateWhitelist,
  useDeleteWhitelist,
} from "@/hooks/use-settings";
import type { Whitelist } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
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

import WhitelistConfigSheet from "./whitelist-config-sheet";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// ─── WhitelistsTab ───────────────────────────────────────────────────────────

export default function WhitelistsTab() {
  const { data: whitelists, isLoading, isError } = useWhitelists();
  const { data: groups } = useGroups();
  const toggleWhitelist = useToggleWhitelist();
  const createWhitelist = useCreateWhitelist();
  const deleteWhitelist = useDeleteWhitelist();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [selectedWhitelist, setSelectedWhitelist] = useState<Whitelist | null>(
    null
  );

  const roleWhitelists = useMemo(
    () => whitelists?.filter((wl) => !wl.is_manual) ?? [],
    [whitelists]
  );

  function handleCreateWhitelist() {
    if (!newName.trim()) return;
    const slug = slugify(newName.trim());
    createWhitelist.mutate(
      {
        name: newName.trim(),
        output_filename: `${slug}.txt`,
        is_manual: false,
      },
      {
        onSuccess: () => {
          toast.success("Whitelist created");
          setNewName("");
          setShowCreate(false);
        },
        onError: () => toast.error("Failed to create whitelist"),
      }
    );
  }

  function copyUrl(url: string) {
    navigator.clipboard.writeText(url);
    toast.success("URL copied to clipboard");
  }

  // ─── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="rounded-lg border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b p-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-8 w-24 ml-auto" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ─── Error ──────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-red-500/20 bg-red-500/5 py-12 text-center">
        <p className="text-sm font-medium text-red-400">Failed to load data</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Check your connection and refresh the page.
        </p>
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Discord Whitelists</h2>
          <p className="text-xs text-muted-foreground">
            Role-based whitelists synced from Discord roles.
          </p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger
            render={
              <Button variant="outline" size="sm">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Create Whitelist
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Whitelist</DialogTitle>
              <DialogDescription>
                Choose a template or enter a custom name.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { name: "Subscribers", file: "subscribers.txt" },
                  { name: "Clan", file: "clan.txt" },
                  { name: "Staff", file: "staff.txt" },
                  { name: "VIP", file: "vip.txt" },
                ].map((tpl) => (
                  <Button
                    key={tpl.name}
                    variant="outline"
                    size="sm"
                    className="justify-start"
                    onClick={() => setNewName(tpl.name)}
                  >
                    {tpl.name}
                  </Button>
                ))}
              </div>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-white/[0.08]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">
                    or custom
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Tournament Whitelist"
                  onKeyDown={(e) =>
                    e.key === "Enter" && handleCreateWhitelist()
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleCreateWhitelist}
                disabled={createWhitelist.isPending || !newName.trim()}
              >
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Empty State */}
      {roleWhitelists.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.08] py-12 text-center">
          <Shield className="h-8 w-8 text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">No whitelists yet</p>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm">
            Whitelists hold your player roster. Create one, then add Discord
            roles under Configure to control who gets whitelisted and how many
            slots they receive.
          </p>
        </div>
      ) : (
        /* Table */
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Squad Group</TableHead>
                <TableHead>Output File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roleWhitelists.map((wl) => (
                <TableRow key={wl.id}>
                  {/* Name */}
                  <TableCell>
                    <button
                      type="button"
                      className="inline-flex items-center gap-2 text-sm font-medium hover:underline"
                      onClick={() => setSelectedWhitelist(wl)}
                    >
                      {wl.name}
                      {wl.is_default && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          Default
                        </Badge>
                      )}
                    </button>
                  </TableCell>

                  {/* Squad Group */}
                  <TableCell className="text-muted-foreground">
                    {wl.squad_group || "\u2014"}
                  </TableCell>

                  {/* Output File */}
                  <TableCell>
                    <span className="font-mono text-xs text-muted-foreground">
                      {wl.output_filename || "\u2014"}
                    </span>
                  </TableCell>

                  {/* Status */}
                  <TableCell>
                    <Switch
                      checked={wl.enabled}
                      onCheckedChange={() =>
                        toggleWhitelist.mutate(wl.slug, {
                          onSuccess: () =>
                            toast.success(
                              `Whitelist ${wl.enabled ? "disabled" : "enabled"}`
                            ),
                          onError: () =>
                            toast.error("Failed to toggle whitelist"),
                        })
                      }
                    />
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedWhitelist(wl)}
                      >
                        <Settings className="mr-1 h-3 w-3" />
                        Configure
                      </Button>
                      {wl.url && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => copyUrl(wl.url)}
                          title="Copy URL"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      )}
                      {!wl.is_default && (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                title="Delete whitelist"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            }
                          />
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete {wl.name}?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently remove this whitelist and
                                all associated data. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() =>
                                  deleteWhitelist.mutate(wl.slug, {
                                    onSuccess: () =>
                                      toast.success("Whitelist deleted"),
                                    onError: () =>
                                      toast.error("Failed to delete whitelist"),
                                  })
                                }
                              >
                                Continue
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Config Sheet (controlled) */}
      {selectedWhitelist && (
        <WhitelistConfigSheet
          whitelist={selectedWhitelist}
          groups={groups ?? []}
          open={!!selectedWhitelist}
          onOpenChange={(open) => {
            if (!open) setSelectedWhitelist(null);
          }}
        />
      )}
    </div>
  );
}
