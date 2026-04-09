"use client";

import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Save, Copy, Check, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import type { Whitelist, SquadGroup } from "@/lib/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

// ─── WhitelistConfigSheet ────────────────────────────────────────────────────

export default function WhitelistConfigSheet({
  whitelist,
  groups,
  open,
  onOpenChange,
}: {
  whitelist: Whitelist;
  groups: SquadGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(whitelist.name);
  const [squadGroup, setSquadGroup] = useState(whitelist.squad_group);
  const [copied, setCopied] = useState(false);
  const [justRegenerated, setJustRegenerated] = useState(false);

  const displayUrl = whitelist.url ?? "";

  const groupOptions: ComboboxOption[] = useMemo(
    () => groups.map((g) => ({ value: g.group_name, label: g.group_name })),
    [groups]
  );

  async function handleSave() {
    try {
      // output_filename is auto-derived on the backend from the name slug.
      await api.put(`/api/admin/whitelists/${whitelist.id}`, {
        name,
        squad_group: squadGroup,
        output_filename: `${slugify(name)}.txt`,
      });
      toast.success("Whitelist updated");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch {
      toast.error("Failed to update whitelist");
    }
  }

  async function handleRegenerate() {
    try {
      await api.post("/api/admin/whitelist-url/regenerate", {});
      await qc.refetchQueries({ queryKey: ["settings"] });
      setJustRegenerated(true);
      setCopied(false);
      setTimeout(() => setJustRegenerated(false), 4000);
    } catch {
      toast.error("Failed to regenerate URL");
    }
  }

  function copyUrl() {
    navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Configure {whitelist.name}</SheetTitle>
          <SheetDescription>
            Edit whitelist settings and output configuration.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Squad Group</Label>
            <Combobox
              options={groupOptions}
              value={squadGroup}
              onValueChange={setSquadGroup}
              placeholder="Select group"
              searchPlaceholder="Search groups..."
              emptyText="No groups found."
            />
          </div>
          <Button onClick={handleSave} className="w-full">
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save
          </Button>

          <div className="border-t border-white/[0.10] pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <Label>Whitelist URL</Label>
              {justRegenerated && (
                <span className="text-[10px] font-medium text-emerald-400">
                  New URL generated
                </span>
              )}
            </div>

            {displayUrl ? (
              <div
                className={`flex items-center gap-2 rounded-lg border p-2 ${
                  justRegenerated
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-white/[0.08] bg-black/30"
                }`}
              >
                <code
                  className={`flex-1 truncate font-mono text-[11px] ${
                    justRegenerated ? "text-emerald-300" : "text-muted-foreground"
                  }`}
                  title={displayUrl}
                >
                  {displayUrl}
                </code>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  onClick={copyUrl}
                  title="Copy URL"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                No URL generated yet.
              </p>
            )}

            <p className="text-[11px] text-muted-foreground">
              Update your Squad server&apos;s RemoteAdminListHosts.cfg if you
              regenerate. The current URL will stop working immediately.
            </p>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" size="sm" className="w-full">
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Regenerate URL
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Regenerate whitelist URL?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    The current URL will stop working immediately. You must
                    update your Squad server&apos;s RemoteAdminListHosts.cfg
                    with the new URL or your whitelist will stop loading on the
                    server.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRegenerate}>
                    Regenerate
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
