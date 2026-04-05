"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  AddSteamEntryDialog                                                 */
/* ------------------------------------------------------------------ */

export function AddSteamEntryDialog({
  whitelists,
}: {
  whitelists: { slug: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [whitelistSlug, setWhitelistSlug] = useState(whitelists[0]?.slug ?? "");
  const [ids, setIds] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const queryClient = useQueryClient();

  function reset() {
    setName(""); setIds(""); setSubmitting(false);
  }

  async function handleAdd() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!ids.trim()) { toast.error("At least one Steam64 or EOS ID is required"); return; }
    if (!whitelistSlug) { toast.error("Select a whitelist"); return; }

    const parsed = ids.split(/[\s,\n]+/).map((s) => s.trim()).filter(Boolean);
    const steamIds = parsed.filter((s) => /^7656119\d{10}$/.test(s));
    const eosIds = parsed.filter((s) => /^[0-9a-f]{32}$/i.test(s));
    const invalid = parsed.filter((s) => !steamIds.includes(s) && !eosIds.includes(s));

    if (invalid.length > 0) {
      toast.error(`Invalid IDs: ${invalid.join(", ")}`);
      return;
    }
    if (steamIds.length === 0 && eosIds.length === 0) {
      toast.error("No valid IDs found");
      return;
    }

    setSubmitting(true);
    try {
      await api.post("/api/admin/users", {
        discord_name: name.trim(),
        whitelist_slug: whitelistSlug,
        steam_ids: steamIds,
        eos_ids: eosIds,
      });
      toast.success(`Added ${name.trim()} — ${steamIds.length + eosIds.length} ID(s)`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      reset();
      setOpen(false);
    } catch {
      toast.error("Failed to add entry");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        Add Steam Entry
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Steam / EOS Entry</DialogTitle>
          <DialogDescription>
            Add a player by Steam64 or EOS ID without requiring a Discord account.
            They can claim this record later via the bot panel.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Player Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Armyrat60" />
          </div>
          <div className="space-y-2">
            <Label>Whitelist</Label>
            <Select value={whitelistSlug} onValueChange={(v) => setWhitelistSlug(v ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select whitelist" /></SelectTrigger>
              <SelectContent>
                {whitelists.map((wl) => (
                  <SelectItem key={wl.slug} value={wl.slug}>{wl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Steam64 / EOS IDs</Label>
            <Textarea
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              placeholder={"76561198012345678\n76561198012345679"}
              rows={3}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">One per line, or comma-separated. Steam64 = 17 digits starting with 7656119. EOS = 32 hex chars.</p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleAdd} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Add Entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
