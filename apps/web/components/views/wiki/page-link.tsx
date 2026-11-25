"use client";

import { parseAsString, useQueryStates } from "nuqs";

import { isCast, useCharacters } from "@/hooks/use-characters";
import { useWikiList } from "@/hooks/use-wiki";
import { wikiParsers } from "./search-params";

/**
 * A `[[id]]` or `[[id|words]]` link: one of the cast opens in Characters, any
 * other page (a person who is only a page among them) here.
 */
export function WikiLink({
  id,
  words,
}: {
  id: string;
  words?: string | undefined;
}) {
  const { data: list } = useWikiList();
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates({
    ...wikiParsers,
    view: parseAsString,
    character: parseAsString,
  });
  const page = list?.pages.find(
    (one) => one.id === id || one.name.toLowerCase() === id.toLowerCase(),
  );
  const label = words?.trim() || page?.name || id;
  if (!page)
    return (
      <span className="text-muted-foreground" title={`No page called ${id}`}>
        {label}
      </span>
    );
  // Somewhere else is never still editing, nor a new page half named, nor
  // the Problems or Nights list in its place.
  const leave = {
    "wiki.tab": null,
    "wiki.edit": null,
    "wiki.raw": null,
    "wiki.part": null,
    "wiki.kind": null,
    "wiki.name": null,
  };
  const character = page.kind === "person" && isCast(byId.get(page.id));
  const target = character
    ? { view: "characters", character: page.id, ...leave }
    : { view: "wiki", "wiki.page": page.id, "wiki.agent": null, ...leave };
  // A real link, so it wraps like the words around it and opens in a new tab.
  const href = character
    ? `?view=characters&character=${encodeURIComponent(page.id)}`
    : `?view=wiki&wiki.page=${encodeURIComponent(page.id)}`;
  return (
    <a
      href={href}
      className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
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
        void setParams(target);
      }}
    >
      {label}
    </a>
  );
}

/** `**strong**`, `*emphasis*`, `code` and `[[links]]` inside a line. */
export function inline(text: string): React.ReactNode[] {
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
          <code key={index} className="rounded bg-muted px-1 font-mono text-xs">
            {part.slice(1, -1)}
          </code>
        );
      return part;
    });
}

/** A line of page text with its links live: for a summary or an opening. */
export function RichText({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

/**
 * Page text as plain words, links read as what they link to: for a row that is
 * itself a button, where a link can't go.
 */
export function usePlainText(): (text: string) => string {
  const { data: list } = useWikiList();
  return (text) =>
    text.replace(
      /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g,
      (_, id: string, words?: string) => {
        const ref = id.trim();
        return (
          words?.trim() ||
          list?.pages.find(
            (one) =>
              one.id === ref || one.name.toLowerCase() === ref.toLowerCase(),
          )?.name ||
          ref
        );
      },
    );
}

/** A few people as links, then how many more. */
export function PeopleLinks({
  people,
  max = 8,
  plain = false,
}: {
  people: readonly { id: string; name?: string }[];
  max?: number;
  /** Names without links. */
  plain?: boolean;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <>
      {shown.map(({ id, name }, at) => (
        <span key={id}>
          {at ? (at === shown.length - 1 && !rest ? " and " : ", ") : ""}
          {plain ? (name ?? id) : <WikiLink id={id} />}
        </span>
      ))}
      {rest ? (
        <span className="text-muted-foreground">
          {" "}
          and {rest} other{rest === 1 ? "" : "s"}
        </span>
      ) : null}
    </>
  );
}
