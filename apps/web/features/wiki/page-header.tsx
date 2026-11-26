"use client";

import type { WikiListItem } from "@kazusa/client";
import { ChevronRightIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { usePlaces } from "@/hooks/use-location";
import { ancestors } from "@/lib/location/places";
import { shelfOf, SHELF_LABEL } from "@/lib/wiki/index-tree";
import { cx } from "@/ui/cx";
import { WikiLink } from "./links";
import { TITLE_TRANSITION } from "./motion";
import { SHELF_ICON } from "./shelf-icon";

const KIND_WORD = {
  places: "Place",
  people: "Person",
  groups: "Group",
  things: "Page",
  days: "Diary day",
} as const;

/**
 * Above a title, what it is: for a place, the areas it is in, outermost first,
 * each a link; for anything else, its kind. A place that is a group says both.
 */
export function Eyebrow({
  page,
  lead,
}: {
  page: Pick<WikiListItem, "id" | "kind" | "place" | "group">;
  /** Words before it, like whose wiki this is. */
  lead?: ReactNode;
}) {
  const places = usePlaces();
  const shelf = shelfOf({ ...page, name: "", aliases: [], summary: "" });
  const areas =
    page.place && places ? ancestors(places, page.id).reverse() : [];
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.8125rem] font-bold text-ui-soft">
      {lead}
      <span className="inline-flex items-center gap-1.5 text-ui-primary [&_svg]:size-3.5">
        {SHELF_ICON[shelf]}
        {areas.length ? null : KIND_WORD[shelf]}
      </span>
      {areas.map((area, at) => (
        <Fragment key={area}>
          {at ? (
            <ChevronRightIcon
              aria-hidden
              className="size-3 shrink-0 opacity-60 rtl:-scale-x-100"
            />
          ) : null}
          <WikiLink id={area} />
        </Fragment>
      ))}
      {page.place && page.group ? (
        <span className="rounded-full bg-ui-tint px-2 py-px text-xs text-ui-soft">
          {SHELF_LABEL.groups.slice(0, -1)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A page's head: what it is, its name, the other names it goes by, and a line
 * under them (how far it reaches). `actions` sit at the far end.
 */
export function PageHead({
  eyebrow,
  title,
  aliases,
  actions,
  under,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  aliases?: readonly string[] | undefined;
  actions?: ReactNode;
  under?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-col gap-2", className)}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {eyebrow}
          <h1
            style={TITLE_TRANSITION}
            className="text-[1.75rem] leading-tight font-extrabold text-balance"
          >
            {title}
          </h1>
          {aliases?.length ? (
            <p className="text-[0.8125rem] text-ui-soft">
              {`Also ${aliases.join(" · ")}`}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-1 pt-0.5">
            {actions}
          </div>
        ) : null}
      </div>
      {under}
    </header>
  );
}

/** The scrolling sheet a Wiki stage draws on, a page's width at most. */
export function Sheet({
  label,
  wide = false,
  children,
}: {
  label: string;
  /** Room for two columns side by side. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mt-px flex min-h-0 scrollbar-gutter-stable flex-col overflow-y-auto">
      <article
        aria-label={label}
        className={cx(
          "@container mx-auto flex w-full min-w-0 flex-col gap-6 px-8 pt-6 pb-12 motion-safe:animate-ui-enter max-lg:px-6 max-md:px-4 max-md:pt-4",
          wide ? "max-w-6xl" : "max-w-5xl",
        )}
      >
        {children}
      </article>
    </div>
  );
}
