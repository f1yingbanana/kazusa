/**
 * Each palette is a pair, like the school colours in Blue Archive: the first
 * hue carries structure (navigation, buttons), the second carries life
 * (halos, unread counts, the running clock, whatever is "you").
 */
export const HALO_PALETTES = [
  { value: "schale", label: "Schale", hint: "Sky blue and sakura" },
  { value: "gehenna", label: "Gehenna", hint: "Crimson and gold" },
  { value: "millennium", label: "Millennium", hint: "Cyan and lime" },
  { value: "abydos", label: "Abydos", hint: "Sand and teal" },
] as const;

export type HaloPalette = (typeof HALO_PALETTES)[number]["value"];
