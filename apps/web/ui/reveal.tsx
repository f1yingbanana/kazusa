import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Controls that swell in when `shown` and collapse to zero width when hidden so
 * neighbours (like a header title) expand into the freed space. Inert while
 * away.
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
        "group/reveal grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-[cubic-bezier(0.2,0.9,0.3,1)] data-[shown]:grid-cols-[1fr] motion-reduce:transition-none",
        className,
      )}
    >
      <div className="flex min-w-0 items-center overflow-hidden *:scale-50 *:opacity-0 *:transition-[scale,opacity] *:duration-200 *:ease-[cubic-bezier(0.3,1.5,0.5,1)] group-data-shown/reveal:*:scale-100 group-data-shown/reveal:*:opacity-100 *:nth-2:delay-40 *:nth-3:delay-80 motion-reduce:*:transition-none">
        {children}
      </div>
    </div>
  );
}
