export const HALO_PALETTES = [
  { value: "sky", label: "Sky" },
  { value: "sakura", label: "Sakura" },
  { value: "matcha", label: "Matcha" },
  { value: "yuuhi", label: "Yuuhi" },
] as const;

export type HaloPalette = (typeof HALO_PALETTES)[number]["value"];
