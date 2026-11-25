import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * An empty state for a place people gather: three empty seats where faces would
 * be, a title and a line. `slim` lays it out in a row, for inside a list or
 * under a transcript.
 */
export function EmptySeats({
  title,
  children,
  action,
  slim = false,
}: {
  title: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  slim?: boolean;
}) {
  const seat = cx(
    "rounded-full border-2 border-dashed border-[color-mix(in_oklch,var(--ui-primary),transparent_50%)] bg-ui-surface motion-safe:animate-ui-bob",
    slim ? "size-7" : "size-9",
  );
  return (
    <div
      className={cx(
        "flex items-center gap-3",
        slim
          ? "w-full px-4 py-3 text-start"
          : "m-auto max-w-88 flex-col px-5 py-6 text-center",
      )}
    >
      <span aria-hidden="true" className="inline-flex shrink-0 items-center">
        <span className={seat} />
        <span className={cx(seat, "-ms-2.5 [animation-delay:0.3s]")} />
        <span className={cx(seat, "-ms-2.5 [animation-delay:0.6s]")} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[0.9375rem] font-extrabold">{title}</p>
        <p className="text-[0.8125rem] leading-normal text-pretty text-ui-soft">
          {children}
        </p>
      </div>
      {action}
    </div>
  );
}
