"use client";

import type { WikiPage, WikiReachResponse } from "@kazusa/client";
import { useWikiList } from "@/hooks/use-wiki";
import { cn } from "@/lib/utils";
import { PlaceFacts } from "./place-fields";
import { PeopleLinks, RichText, WikiLink, inline } from "./page-link";
import {
  AUDIENCE_OF,
  EVERYONE,
  Rail,
  TINT,
  audienceLabel,
  everyoneFirst,
  groupName,
  levelLabel,
  peopleIn,
} from "./levels";

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

/** A group by name, linked to its page; everyone is just words. */
function GroupLink({
  group: id,
  nameOf,
}: {
  group: string;
  nameOf: (ref: string) => string | undefined;
}) {
  return id.toLowerCase() === EVERYONE || !nameOf(id) ? (
    <>{groupName(id, nameOf)}</>
  ) : (
    <WikiLink id={id} />
  );
}

/**
 * Who knows a page and how well, as a short list: each group with what its
 * members know, and for a group, who in the cast is in it.
 */
export function WhoKnows({
  page,
  reach,
}: {
  page: WikiPage;
  reach?: WikiReachResponse | undefined;
}) {
  const { data: list } = useWikiList();
  const nameOf = (ref: string) =>
    list?.pages.find(
      (one) => one.id === ref || one.name.toLowerCase() === ref.toLowerCase(),
    )?.name;
  const groups = everyoneFirst([
    ...(page.everyone ? [{ ref: EVERYONE, level: page.everyone }] : []),
    ...(page.known ?? []),
  ]);
  const involvement = {
    "heard of": "Associate",
    knows: "Member",
    close: "Close member",
  } as const;
  const members = reach?.members ?? [];
  return (
    <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)]">
      {(page.in ?? []).map(({ ref, level }) => (
        <div key={`in-${ref}`} className="contents">
          <dt className="min-w-0 text-pretty">
            In <GroupLink group={ref} nameOf={nameOf} />
          </dt>
          <dd className={TINT[AUDIENCE_OF[level]]}>{involvement[level]}</dd>
        </div>
      ))}
      {groups.length || page.in?.length ? (
        groups.map(({ ref, level }) => (
          <div key={ref} className="contents">
            <dt className="min-w-0 text-pretty">
              <GroupLink group={ref} nameOf={nameOf} />
            </dt>
            <dd className={TINT[AUDIENCE_OF[level]]}>
              {levelLabel(level, page.kind === "person")}
            </dd>
          </div>
        ))
      ) : (
        <p className="text-muted-foreground sm:col-span-2">
          {page.place
            ? "Only those who live or have been here."
            : "Nobody yet."}
        </p>
      )}
      {members.length ? (
        <div className="contents">
          <dt className="text-muted-foreground">In {page.name}</dt>
          <dd>
            <PeopleLinks people={members} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * A World Wiki page as its parts, each on a rail saying who can know it, with
 * who that is in this world: who knows it first, then the summary line, the
 * opening, what those close to it know, and on a character's own page what only
 * they know.
 */
export function PageLayers({
  page,
  reach,
}: {
  page: WikiPage;
  reach?: WikiReachResponse | undefined;
}) {
  const subject = page.name;
  const close = page.sections.filter((section) => !section.knownBy.length);
  const own = page.sections.filter((section) => section.knownBy.length);
  const parts = (sections: WikiPage["sections"]) => (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="mb-1.5 text-sm font-semibold">{section.title}</h3>
          <Prose text={section.text} />
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-7">
      {page.place ? <PlaceFacts id={page.id} /> : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Who knows {subject}</h2>
        <WhoKnows page={page} reach={reach} />
      </section>
      <Rail
        audience="heard"
        label={audienceLabel("heard", subject)}
        people={peopleIn("heard", reach)}
      >
        <p className="text-sm">
          {page.summary ? (
            <RichText text={page.summary} />
          ) : (
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
      {close.length ? (
        <Rail
          audience="close"
          label={audienceLabel("close", subject)}
          people={peopleIn("close", reach)}
        >
          {parts(close)}
        </Rail>
      ) : null}
      {own.length ? (
        <Rail audience="self" label={audienceLabel("self", subject)}>
          {parts(own)}
        </Rail>
      ) : null}
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
    </div>
  );
}
