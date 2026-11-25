"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * How each kind of name on the map is set; mirrors the classes in
 * map-marker.tsx.
 */
const STYLES = {
  place: { weight: 700, size: 11.5, tracking: 0, upper: false, padding: 10 },
  area: { weight: 800, size: 10.5, tracking: 0.16, upper: true, padding: 14 },
  region: { weight: 800, size: 12.5, tracking: 0.2, upper: true, padding: 14 },
} as const;

export type NameStyle = keyof typeof STYLES;

/**
 * Measures a name as the map draws it, so a name shows whole where it fits and
 * not at all where it doesn't. Measures again once the web font arrives.
 */
export function useNameWidth() {
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => live && setFontsReady((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => {
    const context =
      typeof document === "undefined"
        ? null
        : document.createElement("canvas").getContext("2d");
    const family =
      typeof document === "undefined"
        ? "system-ui"
        : getComputedStyle(document.documentElement).getPropertyValue(
            "--ui-font",
          ) || "system-ui";
    const cache = new Map<string, number>();
    return (text: string, style: NameStyle) => {
      const key = `${style}\n${text}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const { weight, size, tracking, upper, padding } = STYLES[style];
      const shown = upper ? text.toUpperCase() : text;
      let width = shown.length * size * 0.62;
      if (context) {
        context.font = `${weight} ${size}px ${family}`;
        width = context.measureText(shown).width;
      }
      const total = Math.ceil(width + shown.length * size * tracking + padding);
      cache.set(key, total);
      return total;
    };
    // `fontsReady` measures again once the font that draws the names arrives.
  }, [fontsReady]);
}
