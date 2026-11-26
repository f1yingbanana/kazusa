"use client";

import { useEffect } from "react";
import {
  usePalettePreference,
  useThemeMode,
} from "@/lib/state/preferences-store";

/** Syncs palette and light/dark mode onto <html>, since popups portal to <body>. */
export function useAppearance(): void {
  const palette = usePalettePreference();
  const mode = useThemeMode();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = palette;
    root.classList.toggle("dark", mode === "dark");
    root.classList.toggle("light", mode === "light");
    return () => {
      delete root.dataset.palette;
      root.classList.remove("dark", "light");
    };
  }, [palette, mode]);
}
