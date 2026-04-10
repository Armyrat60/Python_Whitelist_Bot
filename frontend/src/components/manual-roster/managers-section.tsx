"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  useCategoryManagers,
  useAddCategoryManager,
  useRemoveCategoryManager,
} from "@/hooks/use-settings";
import { api } from "@/lib/api";

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
  const [mgrDiscordId, setMgrDiscordId] = useState("");
  const [mgrName, setMgrName]         = useState("");
  const [lookingUp, setLookingUp]     = useState(false);
  const [lookupDone, setLookupDone]   = useState(false);

  async function lookupDiscordName(id: string) {
    if (!id.trim() || id.length < 17) return;
    setLookingUp(true);
    try {
      const res = await api.get<{ name: string; username: string }>(`/api/admin/discord/member/${id.trim()}`);
      setMgrName(res.name || res.username);
      setLookupDone(true);
    } catch {
      // Not found — user can type manually
      setLookupDone(false);
    } finally {
      setLookingUp(false);
    }
  }

  function handleAddManager() {
    if (!mgrDiscordId.trim()) return;
    addManager.mutate(
      {
        discord_id: mgrDiscordId.trim(),
        discord_name: mgrName.trim() || `User ${mgrDiscordId.trim().slice(-4)}`,
      },
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
        <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Managers</p>
        {!addOpen && (
          <Button size="sm" variant="outline" className="h-8 text-sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Manager
          </Button>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : !managers || managers.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No managers assigned.</p>
      ) : (
        <div className="space-y-1">
          {managers.map((mgr) => (
            <div
              key={mgr.discord_id}
              className="flex items-center gap-3 rounded-lg px-4 py-2.5 bg-white/[0.02] text-sm"
            >
              <div className="flex-1 min-w-0">
                <span className="font-medium truncate">{mgr.discord_name}</span>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{mgr.discord_id}</span>
              </div>
              <AlertDialog>
                <AlertDialogTrigger render={
                  <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:border-destructive/30 shrink-0" />
                }>
                  <Trash2 className="h-3.5 w-3.5" />
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
        <div className="rounded-lg border border-white/[0.08] p-4 space-y-3">
          <p className="text-sm font-medium">Add Manager</p>
          <div className="space-y-1.5">
            <Label className="text-sm">Discord ID <span className="text-red-400">*</span></Label>
            <div className="flex items-center gap-2">
              <Input
                value={mgrDiscordId}
                onChange={(e) => { setMgrDiscordId(e.target.value); setLookupDone(false); }}
                onBlur={(e) => lookupDiscordName(e.target.value)}
                placeholder="123456789012345678"
                className="font-mono text-sm flex-1"
                autoFocus
              />
              {lookingUp && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
            </div>
            <p className="text-xs text-muted-foreground">Right-click the user in Discord &rarr; Copy User ID. Name auto-fills.</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-sm">Display Name {lookupDone ? <span className="text-emerald-400 text-xs">(auto-filled)</span> : <span className="text-muted-foreground">(optional)</span>}</Label>
            <Input
              value={mgrName}
              onChange={(e) => setMgrName(e.target.value)}
              placeholder="Their Discord username"
              className="text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAddManager}
              disabled={addManager.isPending || !mgrDiscordId.trim()}
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
