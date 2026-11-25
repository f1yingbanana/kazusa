import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Controls that swell in where they stand when `shown` and shrink away when
 * not, one after another. They keep their room either way, so nothing beside
 * them moves, and they are inert while away.
 */
export function Reveal({
  shown,
  children,
  className,
}: {
  shown: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-shown={shown || undefined}
      inert={!shown}
      className={cx(
        "group/reveal flex items-center *:scale-50 *:opacity-0 *:transition-[scale,opacity] *:duration-200 *:ease-[cubic-bezier(0.3,1.5,0.5,1)] *:nth-2:delay-40 *:nth-3:delay-80 data-[shown]:*:scale-100 data-[shown]:*:opacity-100 motion-reduce:*:transition-none",
        className,
      )}
    >
      {children}
    </div>
  );
}
