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
  const seats = (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center">
      <span className={seat} />
      <span className={cx(seat, "-ms-2.5 [animation-delay:0.3s]")} />
      <span className={cx(seat, "-ms-2.5 [animation-delay:0.6s]")} />
    </span>
  );
  const words = (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <p className="text-[0.9375rem] font-extrabold">{title}</p>
      <p className="text-[0.8125rem] leading-normal text-pretty text-ui-soft">
        {children}
      </p>
    </div>
  );
  if (slim)
    // Narrow, the action goes under the words rather than squeezing them.
    return (
      <div className="@container w-full">
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 px-4 py-3 text-start @md:grid-cols-[auto_minmax(0,1fr)_auto]">
          {seats}
          {words}
          {action ? (
            <div className="col-start-2 justify-self-start @md:col-start-3 @md:row-start-1">
              {action}
            </div>
          ) : null}
        </div>
      </div>
    );
  return (
    <div className="m-auto flex max-w-88 flex-col items-center gap-3 px-5 py-6 text-center">
      {seats}
      {words}
      {action}
    </div>
  );
}
