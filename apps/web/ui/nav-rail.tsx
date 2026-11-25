import type { ReactNode } from "react";
import { cx } from "./cx";

/**
 * Sections down the side on wide screens; on a phone the same items become a
 * bottom tab bar.
 */
export function NavRail({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={label}
      className={cx(
        "flex flex-col items-center gap-1 pt-2 pb-4",
        "max-md:flex-row max-md:justify-around max-md:gap-0 max-md:bg-ui-surface max-md:px-1 max-md:pt-1.5 max-md:pb-[calc(0.375rem+env(safe-area-inset-bottom))] max-md:shadow-[0_-1px_0_var(--ui-line)]",
        className,
      )}
    >
      {children}
    </nav>
  );
}

/**
 * `end` items sit at the bottom of the rail and are left off the phone's tab
 * bar.
 */
export function NavRailItem({
  icon,
  label,
  badge,
  current,
  end,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
  current?: boolean;
  end?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group/item flex w-18 flex-col items-center gap-1 rounded-[1rem] py-1.5 text-xs font-bold text-ui-soft hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary aria-[current=page]:text-ui-ink data-end:mt-auto max-md:w-auto max-md:flex-1 max-md:text-[0.6875rem] max-md:data-end:hidden [&[data-end]~[data-end]]:mt-0"
      data-end={end ? "" : undefined}
      aria-current={current ? "page" : undefined}
      onClick={onClick}
    >
      <span className="relative grid h-8 w-13 place-items-center rounded-full transition-colors duration-200 group-hover/item:bg-ui-tint group-aria-[current=page]/item:bg-ui-primary group-aria-[current=page]/item:text-ui-on-primary [&>svg]:size-5">
        {icon}
        {badge ? (
          <span className="absolute -top-1 -right-0.5 *:bg-ui-accent! *:text-ui-on-accent!">
            {badge}
          </span>
        ) : null}
      </span>
      <span>{label}</span>
    </button>
  );
}
