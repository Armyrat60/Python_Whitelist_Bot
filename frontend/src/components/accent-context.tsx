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
  "Green / Blue (Default)": { primary: "#22C55E", secondary: "#38BDF8" },
  "Blue / Green": { primary: "#38BDF8", secondary: "#22C55E" },
  "Purple / Pink": { primary: "#A855F7", secondary: "#EC4899" },
  "Amber / Orange": { primary: "#F59E0B", secondary: "#F97316" },
  "Red / Amber": { primary: "#EF4444", secondary: "#F59E0B" },
  "Cyan / Violet": { primary: "#06B6D4", secondary: "#8B5CF6" },
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
