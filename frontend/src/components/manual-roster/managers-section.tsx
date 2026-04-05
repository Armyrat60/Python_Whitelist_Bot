"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCategoryManagers,
  useAddCategoryManager,
  useRemoveCategoryManager,
} from "@/hooks/use-settings";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function ManagersSection({ whitelistId, categoryId }: { whitelistId: number; categoryId: number }) {
  const { data: managers, isLoading } = useCategoryManagers(whitelistId, categoryId);
  const addManager    = useAddCategoryManager(whitelistId, categoryId);
  const removeManager = useRemoveCategoryManager(whitelistId, categoryId);

  const [addOpen, setAddOpen]         = useState(false);
  const [mgrName, setMgrName]         = useState("");
  const [mgrDiscordId, setMgrDiscordId] = useState("");

  function handleAddManager() {
    if (!mgrName.trim() || !mgrDiscordId.trim()) return;
    addManager.mutate(
      { discord_name: mgrName.trim(), discord_id: mgrDiscordId.trim() },
      {
        onSuccess: () => {
          toast.success("Manager added");
          setMgrName(""); setMgrDiscordId(""); setAddOpen(false);
        },
        onError: () => toast.error("Failed to add manager"),
      }
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Managers</p>
        {!addOpen && (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-3 w-3" />
            Add Manager
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : !managers || managers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No managers assigned.</p>
      ) : (
        <div className="space-y-1">
          {managers.map((mgr) => (
            <div
              key={mgr.discord_id}
              className="flex items-center gap-2 rounded-lg px-3 py-2 bg-white/[0.02] text-xs"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate">{mgr.discord_name}</span>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">{mgr.discord_id}</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger render={
                  <Button size="icon-xs" variant="outline" className="text-destructive hover:text-destructive hover:border-destructive/30 shrink-0" />
                }>
                  <Trash2 className="h-3 w-3" />
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove manager?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Remove {mgr.discord_name} as a manager of this category?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() =>
                      removeManager.mutate(mgr.discord_id, {
                        onSuccess: () => toast.success("Manager removed"),
                        onError:   () => toast.error("Failed to remove manager"),
                      })
                    }>Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}

      {addOpen && (
        <div className="rounded-lg border border-white/[0.08] p-3 space-y-2">
          <p className="text-xs font-medium">Add Manager</p>
          <div className="space-y-1.5">
            <Label className="text-xs">Discord Name</Label>
            <Input
              value={mgrName}
              onChange={(e) => setMgrName(e.target.value)}
              placeholder="Username"
              className="text-xs"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Discord ID</Label>
            <Input
              value={mgrDiscordId}
              onChange={(e) => setMgrDiscordId(e.target.value)}
              placeholder="123456789012345678"
              className="font-mono text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAddManager}
              disabled={addManager.isPending || !mgrName.trim() || !mgrDiscordId.trim()}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setAddOpen(false); setMgrName(""); setMgrDiscordId(""); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
