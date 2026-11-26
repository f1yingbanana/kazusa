"use client";

import { Tabs, TabsIndicator, TabsList, TabsTab } from "@ui-sdk/react/tabs";
import {
  createContext,
  useContext,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cx } from "./cx";
import { useCoarsePointer } from "./pointer";
import { Tooltip } from "./tooltip";

const Orientation = createContext(true);

/*
  The sections are route tabs, as ui-sdk's Tabs draw them: one pill marks the
  current section and springs to the next with the curve every tab row and
  segmented control uses, centred on the tab's icon.
*/
const PILL =
  "pointer-events-none absolute top-[calc(var(--active-tab-top)+0.25rem)] left-[calc(var(--active-tab-left)+var(--active-tab-width)/2-1.5rem)] h-10 w-12 rounded-[0.875rem] bg-ui-primary shadow-[0_2px_8px_-2px_color-mix(in_oklch,var(--ui-primary)_60%,transparent)] transition-[top,left] duration-280 ease-[cubic-bezier(0.3,1.3,0.5,1)] data-[activation-direction=none]:transition-none motion-reduce:transition-none max-md:left-[calc(var(--active-tab-left)+var(--active-tab-width)/2-1.625rem)] max-md:h-9 max-md:w-13 max-md:rounded-full";

/**
 * Sections down the side on wide screens, as icons named by their tooltips; on
 * a phone the same items become a compact icon bar at the bottom. `current` is
 * the open section's value; choosing another goes there.
 */
export function NavRail({
  label,
  vertical,
  current,
  currentOffBar = false,
  className,
  children,
}: {
  label: string;
  /** Down the side; otherwise along the bottom. */
  vertical: boolean;
  current: string;
  /** The current item is one the phone's bar leaves off (an `end` item). */
  currentOffBar?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Orientation.Provider value={vertical}>
      <Tabs
        value={current}
        orientation={vertical ? "vertical" : "horizontal"}
        className={cx(
          "flex flex-col pt-2 pb-4",
          "max-md:z-10 max-md:border-t max-md:border-ui-line max-md:bg-ui-surface max-md:px-1 max-md:pt-1.5 max-md:pb-[calc(0.375rem+env(safe-area-inset-bottom))]",
          className,
        )}
      >
        <TabsList
          aria-label={label}
          className="relative flex flex-1 flex-col items-center gap-2 max-md:flex-row max-md:justify-around max-md:gap-0"
        >
          {/* Off the bar, its item has no box: the pill would fall to a corner.
              Back on it, a fresh pill is placed there without springing. */}
          <TabsIndicator
            key={currentOffBar ? "off" : "on"}
            className={cx(PILL, currentOffBar && "max-md:hidden")}
          />
          {children}
        </TabsList>
      </Tabs>
    </Orientation.Provider>
  );
}

/**
 * `end` items sit at the bottom of the rail and are left off the phone's tab
 * bar. A plain press goes there in place; a modified one (a new tab) follows
 * `href` as a link does.
 */
export function NavRailItem({
  value,
  icon,
  label,
  badge,
  end,
  href,
  onClick,
}: {
  value: string;
  icon: ReactNode;
  label: string;
  badge?: ReactNode;
  end?: boolean;
  href: string;
  onClick: () => void;
}) {
  const vertical = useContext(Orientation);
  const coarse = useCoarsePointer();

  const press = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onClick();
  };
  return (
    <Tooltip
      label={label}
      side={vertical ? "right" : "top"}
      disabled={coarse || undefined}
      names
    >
      <TabsTab
        value={value}
        render={<a href={href} onClick={press} />}
        data-end={end ? "" : undefined}
        className="group/item relative flex w-14 flex-col items-center rounded-[1rem] py-1 text-ui-soft hover:not-data-selected:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-end:mt-auto max-md:w-auto max-md:flex-1 max-md:data-end:hidden data-selected:text-ui-on-primary [&[data-end]~[data-end]]:mt-0"
      >
        <span className="relative grid h-10 w-12 place-items-center rounded-[0.875rem] transition-colors duration-200 group-hover/item:not-group-data-selected/item:bg-ui-tint max-md:h-9 max-md:w-13 max-md:rounded-full [&>svg]:size-5">
          {icon}
          {badge ? (
            <span className="absolute -top-1 -right-1 *:bg-ui-accent! *:text-ui-on-accent!">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="sr-only">{label}</span>
      </TabsTab>
    </Tooltip>
  );
}
