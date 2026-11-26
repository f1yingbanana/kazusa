"use client";

import type { Knowledge, WikiPage, WikiReachResponse } from "@kazusa/client";
import { EyeIcon, LockIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  isOwnSection,
  leadAfterSummary,
  readerWords,
  readersOf,
  reads,
  type Layer,
} from "@/lib/wiki/layers";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Prose } from "../entities/prose";
import { RichText } from "./links";

/**
 * The colour of a layer's rail: the fewer who read it, the stronger. The same
 * marks the editor's fields, so a part reads the same in both.
 */
export const RAIL: Readonly<Record<Layer, string>> = {
  summary: "bg-ui-line",
  opening: "bg-[color-mix(in_oklch,var(--ui-primary)_38%,var(--ui-line))]",
  close: "bg-ui-primary",
  self: "bg-ui-accent",
};

export const LAYER_NAME: Readonly<Record<Layer, string>> = {
  summary: "Summary",
  opening: "Opening",
  close: "For those close",
  self: "Inner voice",
};

/**
 * One layer of a page with its rail at the inline start. Hovering the rail says
 * who reads it; the reach popover says the same for everyone else.
 */
export function Layered({
  layer,
  label,
  className,
  children,
}: {
  layer: Layer;
  label?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div data-layer={layer} className={cx("relative ps-5", className)}>
      <span
        aria-hidden
        className="group/rail absolute inset-y-0 -inset-s-2 w-5 cursor-default"
      >
        <span
          className={cx(
            "absolute inset-y-1 start-2 w-[3px] rounded-full transition-[width,inset] duration-200 ease-out group-hover/rail:start-[0.4375rem] group-hover/rail:w-[5px] motion-reduce:transition-none",
            RAIL[layer],
          )}
        />
        {label ? (
          <span className="pointer-events-none absolute inset-s-5 top-0 z-10 translate-y-[-calc(100%+0.25rem)] scale-95 rounded-full bg-ui-ink px-2.5 py-1 text-xs font-bold whitespace-nowrap text-ui-ground opacity-0 shadow-ui transition-[opacity,scale] duration-150 group-hover/rail:scale-100 group-hover/rail:opacity-100 motion-reduce:transition-none">
            {`${LAYER_NAME[layer]} · ${label}`}
          </span>
        ) : null}
      </span>
      {children}
    </div>
  );
}

/**
 * Text someone doesn't know, kept in its place but out of focus: there is
 * something here, not what. "Show anyway" brings it into focus.
 */
function Veil({ why, children }: { why: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  if (shown)
    return <div className="motion-safe:animate-ui-step-in">{children}</div>;
  return (
    <div className="relative min-h-24">
      <div
        aria-hidden
        inert
        className="max-h-32 overflow-hidden mask-[linear-gradient(to_bottom,black_30%,transparent)] opacity-55 blur-[5px] select-none"
      >
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
        <p className="max-w-80 text-[0.8125rem] font-bold text-balance text-ui-ink">
          {why}
        </p>
        <Button
          tone="soft"
          size="sm"
          icon={<EyeIcon aria-hidden />}
          onClick={() => setShown(true)}
        >
          Show anyway
        </Button>
      </div>
    </div>
  );
}

/** Someone reading the page as one character knows it. */
export interface Reader {
  readonly id: string;
  readonly name: string;
  readonly depth: Knowledge["depth"];
}

function veilWords(
  layer: Layer,
  reader: Reader,
  subject: string,
  person: boolean,
): string {
  const them = person ? subject : "it";
  if (layer === "self") return `Only ${subject} knows this`;
  if (reader.depth === "none")
    return `${reader.name} has never heard of ${them}`;
  if (layer === "close") return `${reader.name} doesn't know ${them} this well`;
  return `${reader.name} has only heard of ${them}`;
}

function SectionBody({ section }: { section: WikiPage["sections"][number] }) {
  return (
    <section aria-label={section.title} className="flex flex-col gap-2">
      <h2 className="text-[1.0625rem] leading-snug font-extrabold text-balance">
        {section.title}
      </h2>
      <Prose text={section.text} />
    </section>
  );
}

function OwnMark({ subject }: { subject: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 self-start rounded-full bg-ui-accent-tint px-2 py-0.5 text-xs font-bold text-ui-accent-ink [&_svg]:size-3"
      title={`Only ${subject} reads this, as their own thoughts.`}
    >
      <LockIcon aria-hidden />
      {`Only ${subject}`}
    </span>
  );
}

/**
 * A World Wiki page below its title, in the order its readers reach it: the
 * summary in bold, the rest of the opening, the sections those close to it get,
 * what only its subject knows, then what happened. Each layer has a rail at its
 * start; with a `reader`, what they don't know is out of focus.
 */
export function PageArticle({
  page,
  subject,
  subjectName,
  reach,
  reader,
}: {
  page: WikiPage;
  /** Whose page it is, when it is someone's: their own sections are marked. */
  subject?: string | undefined;
  subjectName?: string | undefined;
  reach?: WikiReachResponse | undefined;
  reader?: Reader | undefined;
}) {
  const person = page.kind === "person";
  const name = subjectName ?? page.name;
  const summary = page.summary.trim();
  const lead = leadAfterSummary(page);
  const close = page.sections.filter((s) => !isOwnSection(s, subject));
  const own = page.sections.filter((s) => isOwnSection(s, subject));
  const label = (layer: Layer) =>
    reach
      ? readerWords(layer, readersOf(layer, reach).length, person, name)
      : layer === "self"
        ? `Only ${name}`
        : undefined;
  const shown = (layer: Layer) =>
    !reader || reads(reader.depth, layer, reader.id === subject);
  const layer = (which: Layer, content: ReactNode) => (
    <Layered layer={which} label={label(which)}>
      {shown(which) || !reader ? (
        content
      ) : (
        <Veil why={veilWords(which, reader, name, person)}>{content}</Veil>
      )}
    </Layered>
  );

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {summary || lead ? (
        <div className="flex flex-col gap-3">
          {summary
            ? layer(
                "summary",
                <p className="text-[1.0625rem] leading-[1.6] font-bold text-pretty">
                  <RichText text={summary} />
                </p>,
              )
            : null}
          {lead ? layer("opening", <Prose text={lead} />) : null}
        </div>
      ) : null}

      {close.length
        ? layer(
            "close",
            <div className="flex flex-col gap-7">
              {close.map((section) => (
                <SectionBody key={section.title} section={section} />
              ))}
            </div>,
          )
        : null}

      {own.length
        ? layer(
            "self",
            <div className="flex flex-col gap-7">
              <OwnMark subject={name} />
              {own.map((section) => (
                <SectionBody key={section.title} section={section} />
              ))}
            </div>,
          )
        : null}

      {page.history.length ? <History entries={page.history} /> : null}
    </div>
  );
}

function History({ entries }: { entries: WikiPage["history"] }) {
  return (
    <section
      aria-label="History"
      className="flex flex-col gap-3 border-t border-ui-line pt-5"
    >
      <h2 className="text-[1.0625rem] font-extrabold">History</h2>
      <ol className="flex flex-col gap-3">
        {entries.map((entry) => (
          <li
            key={`${entry.date}${entry.text}`}
            className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 text-[0.9375rem] leading-relaxed max-sm:grid-cols-1 max-sm:gap-0.5"
          >
            <span className="pt-0.5 text-xs font-bold text-ui-soft tabular-nums">
              {entry.date}
            </span>
            <span>
              <RichText text={entry.text} />
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
