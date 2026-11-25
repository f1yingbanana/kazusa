"use client";

import { useEffect, useState } from "react";
import { DEFAULT_PALETTE, type Palette } from "@/ui/palettes";

/** The palette lives on <html>, since dialogs and popovers portal to <body>. */
export function usePalette() {
  const [palette, setPalette] = useState<Palette>(DEFAULT_PALETTE);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = palette;
    return () => {
      delete root.dataset.palette;
    };
  }, [palette]);
  return [palette, setPalette] as const;
}
