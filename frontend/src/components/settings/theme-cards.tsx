"use client";

import { useState, useEffect } from "react";
import { Save, Building2, Trash2 } from "lucide-react";
import { useAccent, ACCENT_PRESETS, type PresetName } from "@/components/accent-context";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";

const PRESET_TAGS: Record<string, string> = {
  "Operator":     "Military · Default",
  "Command Gold": "Authority · Premium",
  "Spectre":      "Elite · Mysterious",
  "Crimson":      "Alert · Danger",
  "Arctic":       "Precision · Intel",
  "Cobalt":       "Clean · Enterprise",
  "Night Vision": "NVG · High-Tech",
  "Phantom":      "Esports · Flair",
};

/* ─── Personal Theme Card ─── */
export function PersonalThemeCard({ accent }: { accent: ReturnType<typeof useAccent> }) {
  const { primary, secondary, setPrimary, setSecondary, applyPreset, orgThemeActive } = accent;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personal Theme</CardTitle>
        <CardDescription>
          Your personal color preference. Saved to this browser only.
          {orgThemeActive && (
            <span className="ml-1" style={{ color: "var(--accent-primary)" }}>
              Org theme is active on this server — your preference shows on servers without one.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Preview bar */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.10] px-4 py-3" style={{ background: "oklch(0.185 0 0)" }}>
          <div className="h-4 w-24 shrink-0 rounded-full" style={{ background: `linear-gradient(90deg, ${primary} 0%, ${secondary} 100%)` }} />
          <div className="h-4 w-px bg-white/10" />
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: primary, borderColor: `${primary}40`, background: `${primary}18` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: primary }} />Active
          </span>
          <span className="hidden sm:inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium" style={{ color: secondary, borderColor: `${secondary}40`, background: `${secondary}15` }}>Roster</span>
          <div className="ml-auto font-mono text-[10px] text-muted-foreground uppercase tracking-widest">{primary} · {secondary}</div>
        </div>

        {/* Preset grid */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Themes</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(([name, colors]) => {
              const isActive = primary === colors.primary && secondary === colors.secondary;
              return (
                <button key={name} type="button" onClick={() => applyPreset(name)}
                  className="group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:scale-[1.03]"
                  style={{ borderColor: isActive ? colors.primary : "rgba(255,255,255,0.06)", background: isActive ? `color-mix(in srgb, ${colors.primary} 8%, oklch(0.185 0 0))` : "oklch(0.185 0 0)", boxShadow: isActive ? `0 0 16px ${colors.primary}30` : undefined }}
                >
                  <div className="h-9 w-full" style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }} />
                  <div className="px-2.5 py-2">
                    <p className="text-[11px] font-semibold" style={{ color: isActive ? colors.primary : "rgba(255,255,255,0.85)" }}>{name}</p>
                    <p className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">{PRESET_TAGS[name]}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom pickers */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Custom</p>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Primary", value: primary, onChange: setPrimary },
              { label: "Secondary", value: secondary, onChange: setSecondary },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-white/10 bg-transparent p-0.5" />
                  <input type="text" value={value}
                    onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value); }}
                    className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase focus:outline-none" maxLength={7} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── Org Theme Card ─── */
export function OrgThemeCard({
  orgPrimary, orgSecondary, onSave, onClear, isSaving,
}: {
  orgPrimary: string; orgSecondary: string;
  onSave: (p: string, s: string) => void;
  onClear: () => void;
  isSaving: boolean;
}) {
  const [localPrimary, setLocalPrimary]     = useState(orgPrimary || "#a78bfa");
  const [localSecondary, setLocalSecondary] = useState(orgSecondary || "#fbbf24");
  const hasOrgTheme = Boolean(orgPrimary && orgSecondary);

  useEffect(() => {
    if (orgPrimary)   setLocalPrimary(orgPrimary);
    if (orgSecondary) setLocalSecondary(orgSecondary);
  }, [orgPrimary, orgSecondary]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4" style={{ color: "var(--accent-primary)" }} />
          <CardTitle>Organization Theme</CardTitle>
        </div>
        <CardDescription>
          Overrides personal themes for all members of this server.
          {hasOrgTheme
            ? <span className="ml-1 font-medium" style={{ color: "var(--accent-primary)" }}>Org theme is active.</span>
            : <span className="ml-1 text-white/60">Not set — members see their personal colors.</span>
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Preview */}
        <div className="flex items-center gap-3 rounded-xl border border-white/[0.10] px-4 py-3" style={{ background: "oklch(0.185 0 0)" }}>
          <div className="h-4 w-24 shrink-0 rounded-full" style={{ background: `linear-gradient(90deg, ${localPrimary} 0%, ${localSecondary} 100%)` }} />
          <div className="h-4 w-px bg-white/10" />
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold" style={{ color: localPrimary, borderColor: `${localPrimary}40`, background: `${localPrimary}18` }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: localPrimary }} />Active
          </span>
          <div className="ml-auto font-mono text-[10px] text-muted-foreground uppercase tracking-widest">{localPrimary} · {localSecondary}</div>
        </div>

        {/* Preset grid */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Themes</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.entries(ACCENT_PRESETS) as [PresetName, { primary: string; secondary: string }][]).map(([name, colors]) => {
              const isActive = localPrimary === colors.primary && localSecondary === colors.secondary;
              return (
                <button key={name} type="button" onClick={() => { setLocalPrimary(colors.primary); setLocalSecondary(colors.secondary); }}
                  className="group flex flex-col overflow-hidden rounded-xl border text-left transition-all duration-150 hover:scale-[1.03]"
                  style={{ borderColor: isActive ? colors.primary : "rgba(255,255,255,0.06)", background: isActive ? `color-mix(in srgb, ${colors.primary} 8%, oklch(0.185 0 0))` : "oklch(0.185 0 0)", boxShadow: isActive ? `0 0 16px ${colors.primary}30` : undefined }}
                >
                  <div className="h-9 w-full" style={{ background: `linear-gradient(135deg, ${colors.primary} 0%, ${colors.secondary} 100%)` }} />
                  <div className="px-2.5 py-2">
                    <p className="text-[11px] font-semibold" style={{ color: isActive ? colors.primary : "rgba(255,255,255,0.85)" }}>{name}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color pickers */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">Custom Colors</p>
          <div className="flex gap-3">
            {[
              { label: "Primary", value: localPrimary, onChange: setLocalPrimary },
              { label: "Secondary", value: localSecondary, onChange: setLocalSecondary },
            ].map(({ label, value, onChange }) => (
              <div key={label} className="flex flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5">
                <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
                <input type="text" value={value}
                  onChange={(e) => { if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) onChange(e.target.value); }}
                  className="h-8 flex-1 rounded-md border border-white/10 bg-white/5 px-2 font-mono text-xs uppercase focus:outline-none" maxLength={7} />
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button size="sm" disabled={isSaving} onClick={() => onSave(localPrimary, localSecondary)}
            style={{ background: "var(--accent-primary)", color: "#fff" }}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Apply to Organization
          </Button>
          {hasOrgTheme && (
            <Button size="sm" variant="outline" disabled={isSaving} onClick={onClear}
              className="text-muted-foreground hover:text-foreground">
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Clear Org Theme
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
