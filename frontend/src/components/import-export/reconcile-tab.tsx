"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { FileUp, Link2, CheckCircle2, AlertCircle, Loader2, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

interface ReconcileResult {
  orphan_discord_id: number;
  orphan_name: string;
  whitelist_slug: string;
  whitelist_name: string;
  identifiers: string[];
  match: { discord_name: string; discord_id: number } | null;
  confidence: number;
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 1.0) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in srgb, var(--accent-primary) 15%, transparent)", color: "var(--accent-primary)" }}>Exact</span>;
  if (score >= 0.9) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-emerald-500/15 text-emerald-400">High {Math.round(score * 100)}%</span>;
  if (score >= 0.5) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-amber-500/15 text-amber-400">Low {Math.round(score * 100)}%</span>;
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-white/5 text-muted-foreground">No match</span>;
}

export default function ReconcileTab() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pasteContent, setPasteContent] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<ReconcileResult[] | null>(null);
  const [membersLoaded, setMembersLoaded] = useState(0);

  // Per-row state: checked = will apply, overrides for manual ID/name entry
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [overrideId, setOverrideId] = useState<Record<number, string>>({});
  const [overrideName, setOverrideName] = useState<Record<number, string>>({});

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setPasteContent(""); }
  }

  async function handlePreview() {
    setPreviewing(true);
    setResults(null);
    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      } else if (pasteContent.trim()) {
        formData.append("content", pasteContent);
      } else {
        toast.error("Upload a Discord member file or paste the content");
        return;
      }

      const res = await fetch("/api/admin/reconcile/preview", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Preview failed");

      setMembersLoaded(data.members_loaded ?? 0);
      setResults(data.results ?? []);

      // Auto-check rows with confidence >= 0.9
      const initialChecked: Record<number, boolean> = {};
      for (const r of (data.results ?? []) as ReconcileResult[]) {
        initialChecked[r.orphan_discord_id] = r.confidence >= 0.9;
      }
      setChecked(initialChecked);
      setOverrideId({});
      setOverrideName({});

      toast.success(`Found ${data.orphans_found} orphan(s) — ${data.members_loaded} members loaded`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleApply() {
    if (!results) return;
    setApplying(true);
    try {
      const matches = results
        .filter((r) => checked[r.orphan_discord_id])
        .map((r) => {
          const oid = overrideId[r.orphan_discord_id];
          const oname = overrideName[r.orphan_discord_id];
          const realId = oid ? parseInt(oid) : r.match?.discord_id ?? 0;
          const realName = oname || r.match?.discord_name || r.orphan_name;
          return {
            orphan_discord_id: r.orphan_discord_id,
            real_discord_id: realId,
            real_discord_name: realName,
          };
        })
        .filter((m) => m.real_discord_id > 0);

      if (matches.length === 0) {
        toast.error("No valid matches selected");
        return;
      }

      const res = await fetch("/api/admin/reconcile/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Apply failed");

      toast.success(`Applied ${data.applied} match(es) — ${data.errors} error(s)`);
      setResults(null);
      setFile(null);
      setPasteContent("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Apply failed");
    } finally {
      setApplying(false);
    }
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="space-y-6 pt-4">
      {/* Explanation */}
      <div
        className="rounded-lg border p-4 text-sm"
        style={{
          borderColor: "color-mix(in srgb, var(--accent-secondary) 25%, transparent)",
          background: "color-mix(in srgb, var(--accent-secondary) 5%, transparent)",
        }}
      >
        <div className="flex items-start gap-3">
          <UserCheck className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--accent-secondary)" }} />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">Link imported Steam IDs to Discord members</p>
            <p className="text-muted-foreground">
              When you import a Squad CFG or Steam-ID-only list, entries are saved as "orphans" with no Discord link.
              Upload your Discord server member list (<span className="font-mono">User,ID</span> format — exported from your server) and this tool will match orphan names to real Discord IDs.
            </p>
            <p className="text-xs text-muted-foreground">
              Auto-check applies to matches ≥ 90% confidence. Review low-confidence rows and enter a Discord ID manually if needed.
            </p>
          </div>
        </div>
      </div>

      {/* Upload / Paste */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Upload Discord Member List</CardTitle></CardHeader>
          <CardContent>
            <div
              className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-white/[0.10] p-8 text-center transition-colors hover:border-white/[0.20] cursor-pointer"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="h-8 w-8 text-muted-foreground" />
              {file ? (
                <p className="text-sm font-medium">{file.name}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">Click to upload a <span className="font-mono">User,ID</span> CSV / TXT</p>
                  <p className="text-xs text-muted-foreground">e.g. exported from Discord server member list</p>
                </>
              )}
              <input ref={fileRef} type="file" className="hidden" accept=".csv,.txt" onChange={handleFileSelect} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Or Paste Member List</CardTitle></CardHeader>
          <CardContent>
            <Textarea
              value={pasteContent}
              onChange={(e) => { setPasteContent(e.target.value); setFile(null); }}
              placeholder={"User,ID\narmyrat60,268871213479231489\ngreyhat12334,1286894254710329457\n..."}
              className="min-h-[140px] font-mono text-xs"
            />
          </CardContent>
        </Card>
      </div>

      <Button onClick={handlePreview} disabled={previewing || (!file && !pasteContent.trim())}>
        {previewing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}
        Preview Matches
      </Button>

      {/* Results table */}
      {results !== null && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Match Results</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                {results.length} orphan(s) found · {membersLoaded} members loaded · {checkedCount} selected
              </p>
            </div>
            <Button
              onClick={handleApply}
              disabled={applying || checkedCount === 0}
              size="sm"
              style={{ background: "var(--accent-primary)", color: "#000" }}
            >
              {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
              Apply {checkedCount} Match{checkedCount !== 1 ? "es" : ""}
            </Button>
          </CardHeader>
          <CardContent>
            {results.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No orphan records found — all entries are already linked to Discord members.</p>
            ) : (
              <div className="rounded-lg border border-white/[0.10]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 cursor-pointer rounded"
                          checked={checkedCount === results.length && results.length > 0}
                          onChange={(e) => {
                            const all: Record<number, boolean> = {};
                            results.forEach((r) => { all[r.orphan_discord_id] = e.target.checked; });
                            setChecked(all);
                          }}
                        />
                      </TableHead>
                      <TableHead>Orphan Name</TableHead>
                      <TableHead>Whitelist</TableHead>
                      <TableHead>Steam / EOS IDs</TableHead>
                      <TableHead>Best Match</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Override Discord ID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.orphan_discord_id} className={checked[r.orphan_discord_id] ? "row-selected" : "row-hover"}>
                        <TableCell>
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 cursor-pointer rounded"
                            checked={!!checked[r.orphan_discord_id]}
                            onChange={(e) => setChecked((prev) => ({ ...prev, [r.orphan_discord_id]: e.target.checked }))}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{r.orphan_name || <span className="text-muted-foreground">(unknown)</span>}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{r.whitelist_name}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {r.identifiers.length > 0 ? r.identifiers.map((id) => (
                              <span key={id} className="font-mono text-[10px] rounded px-1 py-0.5 bg-white/5 text-muted-foreground">{id}</span>
                            )) : <span className="text-xs text-muted-foreground">—</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {r.match ? (
                            <div>
                              <p className="text-sm font-medium">{r.match.discord_name}</p>
                              <p className="font-mono text-[10px] text-muted-foreground">{r.match.discord_id}</p>
                            </div>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <AlertCircle className="h-3.5 w-3.5" /> No match
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <ConfidenceBadge score={r.confidence} />
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Input
                              placeholder="Discord ID"
                              className="h-6 w-40 font-mono text-xs"
                              value={overrideId[r.orphan_discord_id] ?? ""}
                              onChange={(e) => setOverrideId((prev) => ({ ...prev, [r.orphan_discord_id]: e.target.value }))}
                            />
                            <Input
                              placeholder="Discord name"
                              className="h-6 w-40 text-xs"
                              value={overrideName[r.orphan_discord_id] ?? ""}
                              onChange={(e) => setOverrideName((prev) => ({ ...prev, [r.orphan_discord_id]: e.target.value }))}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
