/**
 * Each palette is a pair: the first hue carries structure (navigation,
 * buttons), the second carries life (presence, unread counts, the running
 * clock, whatever is "you"). Values are stable keys used by CSS and saved
 * preferences; only labels are shown.
 */
export const HALO_PALETTES = [
  { value: "schale", label: "Sky & Sakura", hint: "Sky blue and pink" },
  { value: "gehenna", label: "Crimson & Gold", hint: "Deep red and gold" },
  { value: "millennium", label: "Cyan & Lime", hint: "Cyan and lime green" },
  { value: "abydos", label: "Sand & Teal", hint: "Warm sand and teal" },
] as const;

export type HaloPalette = (typeof HALO_PALETTES)[number]["value"];
