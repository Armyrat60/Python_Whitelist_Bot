"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

/* ─── Presets ─── */
export const ACCENT_PRESETS = {
  Nocturne:          { primary: "#a78bfa", secondary: "#fbbf24" }, // violet + amber — default, high contrast on dark
  "Precision Intel": { primary: "#22d3ee", secondary: "#818cf8" }, // cyan + indigo
  "Operator":        { primary: "#22C55E", secondary: "#38BDF8" }, // emerald + sky — military green
  "Command Gold":    { primary: "#EAB308", secondary: "#F97316" }, // amber + orange — authority / rank
  "Spectre":         { primary: "#A78BFA", secondary: "#38BDF8" }, // violet + sky — elite / premium
  "Crimson":         { primary: "#F43F5E", secondary: "#FB923C" }, // rose + amber — danger / alert
  "Cobalt":          { primary: "#60A5FA", secondary: "#34D399" }, // blue + teal — clean / enterprise
  "Night Vision":    { primary: "#84CC16", secondary: "#22D3EE" }, // lime + cyan — NVG readout
  "Phantom":         { primary: "#C084FC", secondary: "#F472B6" }, // purple + pink — esports / flair
} as const;

export type PresetName = keyof typeof ACCENT_PRESETS;

const STORAGE_KEY = "squad-wl-accent";

interface AccentContextType {
  /** User's personal colors (persisted in localStorage) */
  primary: string;
  secondary: string;
  setPrimary: (color: string) => void;
  setSecondary: (color: string) => void;
  applyPreset: (name: PresetName) => void;
  /** Org-level colors (from DB, overrides personal when set) */
  orgPrimary: string;
  orgSecondary: string;
  orgThemeActive: boolean;
  setOrgColors: (primary: string, secondary: string) => void;
  clearOrgColors: () => void;
  presets: typeof ACCENT_PRESETS;
}

const AccentContext = createContext<AccentContextType>({
  primary: "#a78bfa",
  secondary: "#fbbf24",
  setPrimary: () => {},
  setSecondary: () => {},
  applyPreset: () => {},
  orgPrimary: "",
  orgSecondary: "",
  orgThemeActive: false,
  setOrgColors: () => {},
  clearOrgColors: () => {},
  presets: ACCENT_PRESETS,
});

function applyToDom(primary: string, secondary: string) {
  const root = document.documentElement;
  root.style.setProperty("--accent-primary", primary);
  root.style.setProperty("--accent-secondary", secondary);
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-ring", primary);
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [primary, setPrimaryState] = useState("#a78bfa");
  const [secondary, setSecondaryState] = useState("#fbbf24");
  const [orgPrimary, setOrgPrimaryState] = useState("");
  const [orgSecondary, setOrgSecondaryState] = useState("");

  const orgThemeActive = Boolean(orgPrimary && orgSecondary);

  // Load user's personal theme from localStorage once on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { primary: p, secondary: s } = JSON.parse(stored) as {
          primary: string;
          secondary: string;
        };
        if (p && s) {
          setPrimaryState(p);
          setSecondaryState(s);
          // Only apply user colors immediately; org colors applied by OrgThemeSync
          applyToDom(p, s);
        }
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  // Whenever org or personal colors change, apply the right set to DOM
  useEffect(() => {
    if (orgThemeActive) {
      applyToDom(orgPrimary, orgSecondary);
    } else {
      applyToDom(primary, secondary);
    }
  }, [orgPrimary, orgSecondary, orgThemeActive, primary, secondary]);

  const setPrimary = useCallback((color: string) => {
    setPrimaryState(color);
    setSecondaryState((prev) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ primary: color, secondary: prev }));
      return prev;
    });
  }, []);

  const setSecondary = useCallback((color: string) => {
    setSecondaryState(color);
    setPrimaryState((prev) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ primary: prev, secondary: color }));
      return prev;
    });
  }, []);

  const applyPreset = useCallback((name: PresetName) => {
    const { primary: p, secondary: s } = ACCENT_PRESETS[name];
    setPrimaryState(p);
    setSecondaryState(s);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ primary: p, secondary: s }));
  }, []);

  const setOrgColors = useCallback((p: string, s: string) => {
    setOrgPrimaryState(p);
    setOrgSecondaryState(s);
  }, []);

  const clearOrgColors = useCallback(() => {
    setOrgPrimaryState("");
    setOrgSecondaryState("");
  }, []);

  return (
    <AccentContext.Provider
      value={{
        primary, secondary, setPrimary, setSecondary, applyPreset,
        orgPrimary, orgSecondary, orgThemeActive, setOrgColors, clearOrgColors,
        presets: ACCENT_PRESETS,
      }}
    >
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent() {
  return useContext(AccentContext);
}
