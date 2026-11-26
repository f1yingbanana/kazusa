"use client";

import type { WikiListItem } from "@kazusa/client";
import { parseAsString, useQueryStates } from "nuqs";
import type { ReactNode } from "react";
import { isCast, useCharacters } from "@/hooks/use-characters";
import { usePageLookup } from "@/hooks/use-wiki";
import { charactersParsers, profilePatch } from "../characters/search-params";
import { wikiPatch } from "./open";
import { wikiParsers } from "./search-params";

const LINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/**
 * Where a page opens: one of the cast in their profile, any other page in the
 * Wiki, as a URL and as the state to set.
 */
export function usePageTarget() {
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates({
    ...wikiParsers,
    ...charactersParsers,
    view: parseAsString,
  });
  return (page: Pick<WikiListItem, "id" | "kind">) => {
    const cast = page.kind === "person" && isCast(byId.get(page.id));
    return {
      href: cast
        ? `?view=characters&character=${encodeURIComponent(page.id)}`
        : `?view=wiki&wiki.page=${encodeURIComponent(page.id)}`,
      open: () =>
        void setParams(
          cast
            ? { ...wikiPatch(null), ...profilePatch(page.id) }
            : wikiPatch(page.id),
        ),
    };
  };
}

/**
 * A `[[id]]` or `[[id|words]]` link. A real link, so it wraps with the words
 * around it and opens in a new tab; a page that doesn't exist reads as words.
 */
export function WikiLink({
  id,
  words,
}: {
  id: string;
  words?: string | undefined;
}) {
  const lookup = usePageLookup();
  const target = usePageTarget();
  const page = lookup(id);
  const label = words?.trim() || page?.name || id;
  if (!page)
    return (
      <span
        className="text-ui-soft underline decoration-ui-line decoration-dotted underline-offset-3"
        title={`No page called ${id} yet`}
      >
        {label}
      </span>
    );
  const { href, open } = target(page);
  return (
    <a
      href={href}
      className="rounded-[0.3rem] font-semibold text-ui-primary underline decoration-[color-mix(in_oklch,var(--ui-primary)_30%,transparent)] decoration-[0.08em] underline-offset-3 transition-[text-decoration-color] duration-150 hover:decoration-ui-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        open();
      }}
    >
      {label}
    </a>
  );
}

/** `**strong**`, `*emphasis*`, `code` and `[[links]]` inside a line. */
export function inline(text: string): ReactNode[] {
  return text
    .split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g)
    .map((part, index) => {
      const link = /^\[\[([^\]|]+)(?:\|([^\]]*))?\]\]$/.exec(part);
      if (link)
        return <WikiLink key={index} id={link[1].trim()} words={link[2]} />;
      if (/^\*\*[^*]+\*\*$/.test(part))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (/^\*[^*]+\*$/.test(part))
        return <em key={index}>{part.slice(1, -1)}</em>;
      if (/^`[^`]+`$/.test(part))
        return (
          <code
            key={index}
            className="rounded-[0.375rem] bg-ui-tint px-1 font-[ui-monospace,monospace] text-[0.8125em]"
          >
            {part.slice(1, -1)}
          </code>
        );
      return part;
    });
}

/** A line of page text with its links live. */
export function RichText({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

/** Page text as plain words, each link read as what it links to. */
export function plainText(
  text: string,
  lookup: (ref: string) => WikiListItem | undefined,
): string {
  return text.replace(LINK, (_, id: string, words?: string) => {
    const ref = id.trim();
    return words?.trim() || lookup(ref)?.name || ref;
  });
}

/** `plainText` with this world's pages, for a row that is itself a button. */
export function usePlainText(): (text: string) => string {
  const lookup = usePageLookup();
  return (text) => plainText(text, lookup);
}
