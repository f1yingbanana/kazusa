import { cx } from "./cx";
import { PALETTES, type Palette } from "./palettes";

const SIZE = { sm: "size-3.5", md: "size-5", lg: "size-7" } as const;

export function PaletteSwatch({
  palette,
  size = "md",
}: {
  palette: Palette;
  size?: keyof typeof SIZE;
}) {
  const [a, b] = PALETTES.find((p) => p.value === palette)!.swatch;
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block shrink-0 rounded-full shadow-[inset_0_0_0_2px_oklch(1_0_0/0.5)]",
        SIZE[size],
      )}
      style={{ background: `linear-gradient(135deg, ${a} 50%, ${b} 50%)` }}
    />
  );
}
