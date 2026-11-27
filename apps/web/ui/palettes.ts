/**
 * Values are stable keys used by the theme and saved preferences; only labels
 * are shown. `swatch` is the pair drawn in a picker, whatever palette is
 * active.
 */
export const PALETTES = [
  {
    value: "sky",
    label: "Sky & Sakura",
    hint: "Sky blue and pink",
    swatch: ["oklch(0.6 0.15 248)", "oklch(0.72 0.16 355)"],
  },
  {
    value: "crimson",
    label: "Crimson & Gold",
    hint: "Deep red and gold",
    swatch: ["oklch(0.55 0.16 18)", "oklch(0.8 0.15 82)"],
  },
  {
    value: "cyan",
    label: "Cyan & Lime",
    hint: "Cyan and lime green",
    swatch: ["oklch(0.6 0.12 205)", "oklch(0.82 0.17 128)"],
  },
  {
    value: "sand",
    label: "Sand & Teal",
    hint: "Warm sand and teal",
    swatch: ["oklch(0.72 0.11 62)", "oklch(0.62 0.12 190)"],
  },
] as const;

export type Palette = (typeof PALETTES)[number]["value"];

export const DEFAULT_PALETTE: Palette = "sky";
