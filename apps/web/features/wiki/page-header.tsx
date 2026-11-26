"use client";

import type { WikiListItem } from "@kazusa/client";
import { ChevronRightIcon } from "lucide-react";
import { parseAsString, useQueryStates } from "nuqs";
import { Fragment, type ReactNode } from "react";
import { usePlaces } from "@/hooks/use-location";
import { useWikiLint } from "@/hooks/use-wiki";
import { ancestors } from "@/lib/location/places";
import { shelvesOf } from "@/lib/wiki/index-tree";
import { cx } from "@/ui/cx";
import { WikiLink } from "./links";
import { TITLE_TRANSITION } from "./motion";
import { wikiPatch } from "./open";
import { wikiParsers } from "./search-params";
import { SHELF_ICON } from "./shelf-icon";
import { PaneBackButton } from "@/ui/pane-nav";

const KIND_WORD = {
  places: "Place",
  people: "Character",
  groups: "Group",
  concepts: "Concept",
  days: "Diary day",
} as const;

/**
 * Above a title, what it is: a place's areas, outermost first, each a link, and
 * every other kind it also is. A place that is a group says both.
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
  const shelves = shelvesOf({ ...page, name: "", aliases: [], summary: "" });
  const areas =
    page.place && places ? ancestors(places, page.id).reverse() : [];
  const kinds = shelves.filter((shelf) => shelf !== "places" || !areas.length);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.8125rem] font-bold text-ui-soft max-sm:flex-nowrap max-sm:overflow-hidden max-sm:whitespace-nowrap">
      {lead}
      {areas.length ? (
        <span className="inline-flex shrink-0 items-center text-ui-primary [&_svg]:size-3.5">
          {SHELF_ICON.places}
        </span>
      ) : null}
      {areas.map((area, at) => {
        // On a phone a long chain keeps its ends on one line: the outermost
        // area, an ellipsis, then the place just around this one.
        const middle = at > 0 && at < areas.length - 1;
        return (
          <Fragment key={area}>
            {at ? (
              <ChevronRightIcon
                aria-hidden
                className={cx(
                  "size-3 shrink-0 opacity-60 rtl:-scale-x-100",
                  middle && "max-sm:hidden",
                )}
              />
            ) : null}
            {at === 1 && areas.length > 2 ? (
              <span aria-hidden className="hidden max-sm:inline">
                …
              </span>
            ) : null}
            <span
              className={cx(
                middle && "max-sm:hidden",
                at > 0 && at === areas.length - 1
                  ? "min-w-0 max-sm:truncate"
                  : "shrink-0",
              )}
            >
              <WikiLink id={area} />
            </span>
          </Fragment>
        );
      })}
      {kinds.map((shelf, at) => (
        <Fragment key={shelf}>
          {at || areas.length ? <span aria-hidden>·</span> : null}
          <span className="inline-flex items-center gap-1.5 text-ui-primary [&_svg]:size-3.5">
            {SHELF_ICON[shelf]}
            {KIND_WORD[shelf]}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/**
 * A page's head: what it is, its name, and a line under it (how far it
 * reaches). `actions` sit at the far end.
 */
export function PageHead({
  eyebrow,
  title,
  actions,
  under,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  under?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cx("flex flex-col gap-2", className)}>
      <div className="flex items-start gap-3">
        <PaneBackButton className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {eyebrow}
          <h1
            style={TITLE_TRANSITION}
            className="text-[1.75rem] leading-tight font-extrabold text-balance"
          >
            {title}
          </h1>
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
    <div className="mt-px flex min-h-0 scrollbar-gutter-stable flex-col overflow-y-auto ui-vt-clip">
      {/* Outside the CSS build, which can't parse this pseudo-element yet. */}
      <style href="wiki-sheet-clip" precedence="default">
        {"::view-transition-group-children(wiki-sheet){overflow:clip}"}
      </style>
      <article
        aria-label={label}
        className={cx(
          "@container mx-auto flex w-full min-w-0 flex-col gap-6 px-8 pt-6 pb-12 lg:motion-safe:animate-ui-enter max-lg:px-6 max-md:px-4 max-md:pt-4",
          wide ? "max-w-6xl" : "max-w-5xl",
        )}
      >
        {children}
      </article>
    </div>
  );
}

/**
 * Lint problems belonging to the page in view, shown inline where they can be
 * fixed; hidden when the page has none.
 */
export function PageProblems({ pages }: { pages: readonly string[] }) {
  const { data } = useWikiLint();
  const [, setParams] = useQueryStates({ ...wikiParsers, view: parseAsString });
  const hits = (data?.findings ?? []).filter((f) => pages.includes(f.page));
  if (!hits.length) return null;
  return (
    <aside
      aria-label="Problems on this page"
      className="flex items-start gap-3 rounded-[1rem] bg-ui-ground px-3.5 py-2.5"
    >
      <ul className="flex min-w-0 flex-1 flex-col gap-1">
        {hits.map((finding) => (
          <li
            key={`${finding.page}:${finding.message}`}
            className="flex items-start gap-2.5 text-[0.8125rem] leading-snug"
          >
            <span
              aria-label={finding.level === "error" ? "Error" : "Warning"}
              className={cx(
                "mt-1.5 size-2 shrink-0 rounded-full",
                finding.level === "error" ? "bg-ui-danger" : "bg-ui-accent",
              )}
            />
            <span className="min-w-0">{finding.message}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void setParams(wikiPatch(null, { tab: "lint" }))}
        className="shrink-0 rounded-[0.375rem] text-xs font-bold text-ui-soft hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
      >
        All
      </button>
    </aside>
  );
}
