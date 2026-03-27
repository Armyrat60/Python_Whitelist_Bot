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
  "Operator":     { primary: "#22C55E", secondary: "#38BDF8" }, // emerald + sky — default military
  "Command Gold": { primary: "#EAB308", secondary: "#F97316" }, // amber + orange — authority / rank
  "Spectre":      { primary: "#A78BFA", secondary: "#38BDF8" }, // violet + sky — elite / premium
  "Crimson":      { primary: "#F43F5E", secondary: "#FB923C" }, // rose + amber — danger / alert
  "Arctic":       { primary: "#22D3EE", secondary: "#818CF8" }, // cyan + indigo — cold precision
  "Cobalt":       { primary: "#60A5FA", secondary: "#34D399" }, // blue + teal — clean / enterprise
  "Night Vision": { primary: "#84CC16", secondary: "#22D3EE" }, // lime + cyan — NVG readout
  "Phantom":      { primary: "#C084FC", secondary: "#F472B6" }, // purple + pink — esports / flair
} as const;

export type PresetName = keyof typeof ACCENT_PRESETS;

const STORAGE_KEY = "squad-wl-accent";

interface AccentContextType {
  primary: string;
  secondary: string;
  setPrimary: (color: string) => void;
  setSecondary: (color: string) => void;
  applyPreset: (name: PresetName) => void;
  presets: typeof ACCENT_PRESETS;
}

const AccentContext = createContext<AccentContextType>({
  primary: "#22C55E",
  secondary: "#38BDF8",
  setPrimary: () => {},
  setSecondary: () => {},
  applyPreset: () => {},
  presets: ACCENT_PRESETS,
});

function applyToDom(primary: string, secondary: string) {
  const root = document.documentElement;
  root.style.setProperty("--accent-primary", primary);
  root.style.setProperty("--accent-secondary", secondary);
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [primary, setPrimaryState] = useState("#22C55E");
  const [secondary, setSecondaryState] = useState("#38BDF8");

  // Load from localStorage once on mount
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
          applyToDom(p, s);
        }
      }
    } catch {
      // ignore malformed storage
    }
  }, []);

  const setPrimary = useCallback((color: string) => {
    setPrimaryState(color);
    setSecondaryState((prev) => {
      applyToDom(color, prev);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ primary: color, secondary: prev }));
      return prev;
    });
  }, []);

  const setSecondary = useCallback((color: string) => {
    setSecondaryState(color);
    setPrimaryState((prev) => {
      applyToDom(prev, color);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ primary: prev, secondary: color }));
      return prev;
    });
  }, []);

  const applyPreset = useCallback((name: PresetName) => {
    const { primary: p, secondary: s } = ACCENT_PRESETS[name];
    setPrimaryState(p);
    setSecondaryState(s);
    applyToDom(p, s);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ primary: p, secondary: s }));
  }, []);

  return (
    <AccentContext.Provider
      value={{ primary, secondary, setPrimary, setSecondary, applyPreset, presets: ACCENT_PRESETS }}
    >
      {children}
    </AccentContext.Provider>
  );
}

export function useAccent() {
  return useContext(AccentContext);
}
