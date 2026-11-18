"use client";

import type { WikiPage, WikiReachResponse } from "@kazusa/client";
import { useCharacters } from "@/hooks/use-characters";
import { cn } from "@/lib/utils";
import {
  REACH,
  Rail,
  audienceLabel,
  audienceOf,
  peopleIn,
  type Reach,
} from "./levels";

/** `**strong**`, `*emphasis*` and `code` inside a line. */
function inline(text: string): React.ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/g)
    .map((part, index) => {
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

/**
 * The little Markdown pages use: paragraphs, bulleted lists (a wrapped bullet
 * goes on indented), quotes, and emphasis. Lines a source wraps join up.
 */
export function Prose({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = text.split(/\n\s*\n/).filter((block) => block.trim());
  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {blocks.map((block, index) => {
        const lines = block.split(/\n/);
        if (/^\s*[-*] /.test(lines[0] ?? "")) {
          const items: string[] = [];
          for (const line of lines) {
            if (/^\s*[-*] /.test(line))
              items.push(line.replace(/^\s*[-*] /, ""));
            else if (items.length) items[items.length - 1] += ` ${line.trim()}`;
          }
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
              {items.map((item, at) => (
                <li key={at}>{inline(item)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((line) => line.startsWith(">")))
          return (
            <blockquote
              key={index}
              className="border-l-2 pl-3 text-muted-foreground italic"
            >
              {inline(lines.map((line) => line.replace(/^>\s?/, "")).join(" "))}
            </blockquote>
          );
        return (
          <p key={index}>
            {inline(lines.map((line) => line.trim()).join(" "))}
          </p>
        );
      })}
    </div>
  );
}

/** Parts in a row for the same audience, under one rail. */
function groupParts(
  sections: WikiPage["sections"],
  self: string | undefined,
): {
  audience: ReturnType<typeof audienceOf>;
  knownBy: readonly string[];
  parts: WikiPage["sections"];
}[] {
  const groups: ReturnType<typeof groupParts> = [];
  for (const section of sections) {
    const audience = audienceOf(section.knownBy, self);
    const last = groups.at(-1);
    if (
      last &&
      last.audience === audience &&
      last.knownBy.join() === section.knownBy.join()
    )
      last.parts.push(section);
    else groups.push({ audience, knownBy: section.knownBy, parts: [section] });
  }
  return groups;
}

/**
 * A World Wiki page as its parts, each on a rail saying who can know it, with
 * who that is in this world: the summary line, the opening, then each part for
 * those close to it or only for some. Then who knows it, and why.
 */
export function PageLayers({
  page,
  self,
  reach,
}: {
  page: WikiPage;
  /** The character the page is about, when it is one of the cast. */
  self?: string | undefined;
  reach?: WikiReachResponse | undefined;
}) {
  const { byId } = useCharacters();
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const subject = page.name;
  const how: Reach = page.knownBy.length
    ? "secret"
    : ((page.renown as Reach | undefined) ??
      (page.kind === "concept" ? "known" : "local"));
  const reachLine = REACH.find((option) => option.value === how);

  return (
    <div className="flex flex-col gap-7">
      <Rail
        audience="heard"
        label={audienceLabel("heard", subject)}
        people={peopleIn("heard", reach)}
      >
        <p className="text-sm">
          {page.summary || (
            <span className="text-muted-foreground">No summary yet.</span>
          )}
        </p>
      </Rail>
      <Rail
        audience="knows"
        label={audienceLabel("knows", subject)}
        people={peopleIn("knows", reach)}
      >
        {page.lead ? (
          <Prose text={page.lead} />
        ) : (
          <p className="text-sm text-muted-foreground">No opening yet.</p>
        )}
      </Rail>
      {groupParts(page.sections, self).map((group) => (
        <Rail
          key={group.parts[0].title}
          audience={group.audience}
          label={audienceLabel(
            group.audience,
            subject,
            group.knownBy.map(nameOf),
          )}
          people={
            group.audience === "close" ? peopleIn("close", reach) : undefined
          }
        >
          <div className="flex flex-col gap-5">
            {group.parts.map((section) => (
              <div key={section.title}>
                <h3 className="mb-1.5 text-sm font-semibold">
                  {section.title}
                </h3>
                <Prose text={section.text} />
              </div>
            ))}
          </div>
        </Rail>
      ))}
      {page.history.length ? (
        <Rail audience="knows" label="What happened">
          <ul className="space-y-1 text-sm">
            {page.history.map((line) => (
              <li key={`${line.date}${line.text}`}>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {line.date}
                </span>{" "}
                {line.text}
              </li>
            ))}
          </ul>
        </Rail>
      ) : null}
      <dl className="grid gap-x-6 gap-y-2 border-t pt-5 text-sm sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Known</dt>
        <dd>
          {how === "secret"
            ? `Only ${page.knownBy.map(nameOf).join(", ")}`
            : reachLine?.label}
          <span className="block text-xs text-muted-foreground">
            {reachLine?.hint(subject)}
          </span>
        </dd>
        {page.groups?.length ? (
          <>
            <dt className="text-muted-foreground">Groups</dt>
            <dd>
              {page.groups
                .map(({ ref, close }) => (close ? `${ref} (close)` : ref))
                .join(", ")}
            </dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
