"use client";

import type { WikiGroup, WikiPage, WikiReachResponse } from "@kazusa/client";
import { ChevronDownIcon } from "lucide-react";
import { usePageName } from "@/hooks/use-wiki";
import { readerWords, readersOf, type Layer } from "@/lib/wiki/layers";
import { cx } from "@/ui/cx";
import {
  Popover,
  PopoverContent,
  PopoverLabel,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { LAYER_NAME, RAIL } from "./article";
import { WikiLink } from "./links";

export const LEVEL_WORD = {
  "heard of": "Heard of",
  knows: "Know",
  close: "Know well",
} as const;

export const MEMBERSHIP_WORD = {
  "heard of": "Associate",
  knows: "Member",
  close: "Close member",
} as const;

/** A few people as links, then how many more. */
export function Names({
  people,
  max = 6,
}: {
  people: readonly { id: string; name: string }[];
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <>
      {shown.map(({ id }, at) => (
        <span key={id}>
          {at ? (at === shown.length - 1 && !rest ? " and " : ", ") : ""}
          <WikiLink id={id} />
        </span>
      ))}
      {rest ? (
        <span className="text-ui-soft">{` and ${rest} other${rest === 1 ? "" : "s"}`}</span>
      ) : null}
    </>
  );
}

/** Every group that knows a page, Everyone first. */
export function knownThrough(page: WikiPage): WikiGroup[] {
  const groups = page.known ?? [];
  return [
    ...(page.everyone ? [{ ref: "everyone", level: page.everyone }] : []),
    ...groups.filter((g) => g.ref.toLowerCase() !== "everyone"),
  ];
}

/**
 * How far a page reaches in the cast, in one line under its title: a bar of who
 * knows it how well, and the count. Pressing it says which part each of them
 * reads, and through which groups.
 */
export function ReachLine({
  page,
  reach,
  hasOwn,
}: {
  page: WikiPage;
  reach: WikiReachResponse;
  /** The page has a part only its subject reads. */
  hasOwn: boolean;
}) {
  const pageName = usePageName();
  const person = page.kind === "person";
  const them = person ? "them" : "it";
  const knowing = reach.well.length + reach.knows.length;
  const heard = reach.heard.length;
  const total = knowing + heard + reach.none;
  const segments = [
    { key: "well", count: reach.well.length, tone: RAIL.close },
    { key: "knows", count: reach.knows.length, tone: RAIL.opening },
    {
      key: "heard",
      count: heard,
      tone: "bg-[color-mix(in_oklch,var(--ui-soft)_45%,var(--ui-line))]",
    },
  ];
  const line = knowing
    ? `${knowing} know ${them}${heard ? ` · ${heard} more have heard of ${them}` : ""}`
    : heard
      ? `${heard} ${heard === 1 ? "has" : "have"} heard of ${them}`
      : `Nobody in the cast knows of ${them} yet`;
  const layers: Layer[] = [
    "summary",
    "opening",
    "close",
    ...(hasOwn ? (["self"] as const) : []),
  ];
  const groups = knownThrough(page);

  return (
    <Popover>
      <PopoverTrigger className="group/reach -ms-2 flex max-w-full min-w-0 items-center gap-2.5 self-start rounded-full px-2 py-1 text-[0.8125rem] font-semibold text-ui-soft transition-colors hover:bg-ui-tint hover:text-ui-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary data-open:bg-ui-tint data-open:text-ui-ink">
        <span
          aria-hidden
          className="flex h-1.5 w-16 shrink-0 gap-px overflow-hidden rounded-full bg-ui-tint"
        >
          {segments.map(({ key, count, tone }, index) =>
            count ? (
              <span
                key={key}
                style={{ flexGrow: count / Math.max(total, 1) }}
                className={cx(
                  "h-full basis-0 origin-left transition-[scale] duration-700 ease-[cubic-bezier(0.2,0.8,0.2,1)] starting:scale-x-0 motion-reduce:transition-none",
                  tone,
                  index === 1 && "delay-75",
                  index === 2 && "delay-150",
                )}
              />
            ) : null,
          )}
          <span
            style={{ flexGrow: reach.none / Math.max(total, 1) }}
            className="basis-0"
          />
        </span>
        <span className="min-w-0 truncate">{line}</span>
        <ChevronDownIcon
          aria-hidden
          className="size-3.5 shrink-0 transition-transform duration-200 group-data-open/reach:rotate-180"
        />
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-[min(24rem,calc(100vw-2rem))] gap-4"
      >
        <PopoverTitle>{`Who reads what of ${page.name}`}</PopoverTitle>
        <ul className="flex flex-col gap-2.5">
          {layers.map((layer) => {
            const readers = readersOf(layer, reach);
            return (
              <li
                key={layer}
                className="grid grid-cols-[3px_minmax(0,1fr)] gap-x-3"
              >
                <span
                  aria-hidden
                  className={cx("row-span-2 rounded-full", RAIL[layer])}
                />
                <span className="flex items-baseline justify-between gap-3 text-sm font-bold">
                  {LAYER_NAME[layer]}
                  <span className="text-xs font-semibold text-ui-soft">
                    {readerWords(layer, readers.length, person, page.name)}
                  </span>
                </span>
                <span className="text-[0.8125rem] leading-normal text-ui-soft">
                  {layer === "self" ? (
                    "Their own thoughts, read by no one else."
                  ) : readers.length ? (
                    <Names people={readers} max={layer === "close" ? 8 : 5} />
                  ) : (
                    "No one yet."
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {groups.length || page.in?.length ? (
          <div className="flex flex-col gap-1.5 border-t border-ui-line pt-3">
            {groups.length ? (
              <>
                <PopoverLabel>Known through</PopoverLabel>
                <GroupChips
                  groups={groups}
                  words={LEVEL_WORD}
                  name={pageName}
                />
              </>
            ) : null}
            {page.in?.length ? (
              <>
                <PopoverLabel>{`${page.name} is in`}</PopoverLabel>
                <GroupChips
                  groups={page.in}
                  words={MEMBERSHIP_WORD}
                  name={pageName}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function GroupChips({
  groups,
  words,
  name,
}: {
  groups: readonly WikiGroup[];
  words: Readonly<Record<WikiGroup["level"], string>>;
  name: (ref: string) => string;
}) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {groups.map(({ ref, level }) => (
        <li
          key={ref}
          className="inline-flex items-baseline gap-1.5 rounded-full bg-ui-ground px-2.5 py-1 text-[0.8125rem] font-bold"
        >
          {ref.toLowerCase() === "everyone" ? "Everyone" : name(ref)}
          <span className="text-xs font-semibold text-ui-soft">
            {words[level]}
          </span>
        </li>
      ))}
    </ul>
  );
}
