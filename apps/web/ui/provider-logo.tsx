import type { ComponentProps } from "react";
import { cx } from "./cx";

/**
 * Masked monochrome mark so provider icons match text color in light and dark
 * themes.
 */
export function ProviderLogo({
  provider,
  className,
  style,
  ...props
}: Omit<ComponentProps<"span">, "aria-hidden"> & {
  provider: string;
}) {
  const url = `url(https://models.dev/logos/${provider}.svg)`;
  return (
    <span
      {...props}
      aria-hidden
      className={cx("inline-block size-3.5 shrink-0 bg-current", className)}
      style={{
        maskImage: url,
        maskSize: "contain",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        ...style,
      }}
    />
  );
}
