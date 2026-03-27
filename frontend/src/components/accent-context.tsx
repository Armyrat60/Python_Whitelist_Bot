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
  primary: string;
  secondary: string;
  setPrimary: (color: string) => void;
  setSecondary: (color: string) => void;
  applyPreset: (name: PresetName) => void;
  presets: typeof ACCENT_PRESETS;
}

const AccentContext = createContext<AccentContextType>({
  primary: "#a78bfa",
  secondary: "#fbbf24",
  setPrimary: () => {},
  setSecondary: () => {},
  applyPreset: () => {},
  presets: ACCENT_PRESETS,
});

function applyToDom(primary: string, secondary: string) {
  const root = document.documentElement;
  // User-facing accent vars (used in inline styles throughout the app)
  root.style.setProperty("--accent-primary", primary);
  root.style.setProperty("--accent-secondary", secondary);
  // Keep shadcn --primary in sync so Tailwind classes like bg-primary/10 and
  // text-primary also reflect the chosen accent color
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--sidebar-primary", primary);
  root.style.setProperty("--sidebar-ring", primary);
}

export function AccentProvider({ children }: { children: ReactNode }) {
  const [primary, setPrimaryState] = useState("#a78bfa");
  const [secondary, setSecondaryState] = useState("#fbbf24");

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
