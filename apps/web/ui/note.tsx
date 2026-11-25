import type { ReactNode } from "react";
import { cx } from "./cx";

const INSET = { list: "px-3", panel: "px-4 py-5" } as const;

/**
 * Quiet text for empty, loading and error states. `inset` lines it up with a
 * list or a panel.
 */
export function Note({
  inset,
  action,
  children,
}: {
  inset?: keyof typeof INSET;
  action?: ReactNode;
  children: ReactNode;
}) {
  const className = cx(
    "text-sm leading-normal text-ui-soft",
    inset && INSET[inset],
  );
  if (!action) return <p className={className}>{children}</p>;
  return (
    <div className={cx(className, "flex flex-col items-start gap-2")}>
      <p>{children}</p>
      {action}
    </div>
  );
}
