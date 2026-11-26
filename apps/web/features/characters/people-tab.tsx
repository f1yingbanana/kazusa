"use client";

import {
  statValue,
  statWord,
  type CharacterSummary,
  type StatDefinition,
  type WikiPage,
} from "@kazusa/client";
import { ArrowRightIcon, ChevronDownIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useStats } from "@/hooks/use-stats";
import { useWikiReach } from "@/hooks/use-wiki-editor";
import { useWikiList, useWikiPage } from "@/hooks/use-wiki";
import { acquaintances, type Acquaintance } from "@/lib/characters/cast-book";
import { firstName } from "@/lib/format";
import { Avatar } from "@/ui/avatar";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Note } from "@/ui/note";
import { RichText, usePlainText } from "../wiki/links";
import { Prose } from "../entities/prose";
import { CharacterAvatar } from "./character-avatar";
import { charactersParsers, profilePatch } from "./search-params";

/**
 * Who they know, each in their own words, then who knows them. Opening someone
 * sets the two views side by side: what each makes of the other, and what each
 * guesses the other thinks, which is where people are most often wrong.
 */
export function PeopleTab({ character }: { character: CharacterSummary }) {
  const isAgent = character.kind === "agent";
  const own = useWikiList(isAgent ? character.id : undefined);
  const { data: list, isLoading } = own;
  const { characters, byId } = useCharacters();
  const { data: stats } = useStats();
  const [open, setOpen] = useState<string | null>(null);
  const called = firstName(character.name);

  const pairStats = useMemo(
    () => (stats?.catalog ?? []).filter((stat) => stat.on === "pair"),
    [stats],
  );
  const people = useMemo(
    () =>
      acquaintances({
        self: character.id,
        pages: isAgent ? (list?.pages ?? []) : [],
        simulated: new Set(
          characters.filter((c) => c.kind === "agent").map((c) => c.id),
        ),
        toward: stats?.records[character.id]?.toward ?? {},
        exclude: characters.filter((c) => c.isSystemAgent).map((c) => c.id),
      }),
    [character.id, isAgent, list, characters, stats],
  );

  return (
    <div className="flex flex-col gap-8">
      {isAgent ? (
        <section
          aria-label={`Who ${called} knows`}
          className="flex flex-col gap-3"
        >
          <SectionTitle
            title={`Who ${called} knows`}
            note={people.length ? String(people.length) : undefined}
          />
          {isLoading ? (
            <Note>{`Reading ${called}'s notes on people…`}</Note>
          ) : own.error ? (
            <Note>{`Couldn't read ${called}'s wiki.`}</Note>
          ) : people.length === 0 ? (
            <Note>{`${called} hasn't written about anyone yet.`}</Note>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
              {people.map((one) => (
                <li
                  key={one.id}
                  className={cx(open === one.id && "col-span-full")}
                >
                  <Acquaintance
                    self={character}
                    one={one}
                    other={byId.get(one.id)}
                    stats={pairStats}
                    open={open === one.id}
                    onToggle={() => setOpen(open === one.id ? null : one.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      <KnownBy character={character} />
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <h3 className="flex items-baseline gap-2 text-[0.9375rem] font-extrabold">
      {title}
      {note ? (
        <span className="text-xs font-bold text-ui-soft tabular-nums">
          {note}
        </span>
      ) : null}
    </h3>
  );
}

function Face({
  id,
  name,
  other,
  size = "md",
}: {
  id: string;
  name: string;
  other: CharacterSummary | undefined;
  size?: "xs" | "sm" | "md";
}) {
  return other ? (
    <CharacterAvatar
      id={id}
      name={other.name}
      avatarUrl={other.avatarUrl}
      kind={other.kind}
      size={size}
      decorative
    />
  ) : (
    <Avatar name={name} size={size} decorative />
  );
}

/** Where the states they hold toward them stand, as words. */
function towardWords(
  stats: readonly StatDefinition[],
  toward: Acquaintance["toward"],
): string[] {
  return stats
    .filter((stat) => stat.name in toward)
    .map((stat) => statWord(stat, statValue(stat, toward[stat.name])));
}

function Acquaintance({
  self,
  one,
  other,
  stats,
  open,
  onToggle,
}: {
  self: CharacterSummary;
  one: Acquaintance;
  other: CharacterSummary | undefined;
  stats: readonly StatDefinition[];
  open: boolean;
  onToggle: () => void;
}) {
  const words = towardWords(stats, one.toward);
  const plain = usePlainText();
  return (
    <div
      className={cx(
        "flex h-full flex-col rounded-[1.25rem] bg-ui-ground transition-shadow",
        open && "inset-ring-2 inset-ring-ui-primary",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="group/who flex size-full flex-col gap-2.5 rounded-[1.25rem] p-3.5 text-start transition-colors hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Face id={one.id} name={one.name} other={other} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.9375rem] font-bold">
              {one.name}
            </span>
            {words.length ? (
              <span className="truncate text-xs font-bold text-ui-accent-ink">
                {words.join(" · ")}
              </span>
            ) : !one.simulated ? (
              <span className="text-xs text-ui-soft">Not simulated</span>
            ) : null}
          </span>
          <ChevronDownIcon
            aria-hidden
            className="size-4 shrink-0 text-ui-soft transition-transform duration-200 group-aria-expanded/who:rotate-180"
          />
        </span>
        {one.take ? (
          <span
            className={cx(
              "text-[0.875rem] leading-relaxed text-ui-ink italic",
              !open && "line-clamp-3",
            )}
          >
            {`“${plain(one.take)}”`}
          </span>
        ) : (
          <span className="text-[0.8125rem] text-ui-soft">
            {`${firstName(self.name)} keeps a page on them, with no line about them yet.`}
          </span>
        )}
      </button>
      {open ? <Mirror self={self} one={one} other={other} /> : null}
    </div>
  );
}

/** Each side's page on the other, as far as there is one. */
function Mirror({
  self,
  one,
  other,
}: {
  self: CharacterSummary;
  one: Acquaintance;
  other: CharacterSummary | undefined;
}) {
  const [, setParams] = useQueryStates(charactersParsers);
  const mine = useWikiPage(one.id, self.id);
  const theirs = useWikiPage(one.simulated ? self.id : undefined, one.id);
  const selfName = firstName(self.name);
  const otherName = firstName(one.name);
  return (
    <div className="flex flex-col gap-3 px-3.5 pb-3.5 motion-safe:animate-ui-enter">
      <div className="grid gap-3 md:grid-cols-2">
        <View
          by={selfName}
          about={otherName}
          page={mine.data?.personal}
          loading={mine.isLoading}
          error={Boolean(mine.error)}
          empty={`${selfName} has no more written on ${otherName}.`}
          face={<Face id={self.id} name={self.name} other={self} size="sm" />}
        />
        <View
          by={otherName}
          about={selfName}
          page={theirs.data?.personal}
          loading={one.simulated && theirs.isLoading}
          error={one.simulated && Boolean(theirs.error)}
          empty={
            one.simulated
              ? `${otherName} keeps no page on ${selfName}.`
              : `${otherName} isn't simulated, so has no view of their own.`
          }
          face={<Face id={one.id} name={one.name} other={other} size="sm" />}
        />
      </div>
      {other && other.kind === "agent" && !other.isSystemAgent ? (
        <Button
          tone="ghost"
          size="sm"
          className="self-end"
          icon={<ArrowRightIcon aria-hidden className="rtl:-scale-x-100" />}
          onClick={() => void setParams(profilePatch(one.id))}
        >
          {`${otherName}'s profile`}
        </Button>
      ) : null}
    </div>
  );
}

function View({
  by,
  about,
  page,
  loading,
  error,
  empty,
  face,
}: {
  by: string;
  about: string;
  page: WikiPage | undefined;
  loading: boolean;
  error: boolean;
  empty: string;
  face: React.ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-3 rounded-[1rem] bg-ui-surface p-3.5 inset-ring inset-ring-ui-line">
      <figcaption className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] font-extrabold">
        <span className="flex min-w-0 items-center gap-2">
          {face}
          <span className="truncate">{`${by} on ${about}`}</span>
        </span>
        {page?.relation ? (
          <span className="ms-auto max-w-full truncate rounded-full bg-ui-tint px-2 py-0.5 text-xs font-bold text-ui-soft">
            {page.relation}
          </span>
        ) : null}
      </figcaption>
      {loading ? (
        <Note>Reading…</Note>
      ) : error ? (
        <Note>{`Couldn't read ${by}'s notes.`}</Note>
      ) : !page ? (
        <Note>{empty}</Note>
      ) : (
        <>
          {page.lead.trim() ? (
            <Prose text={page.lead} className="text-[0.875rem]" />
          ) : page.summary ? (
            <p className="text-[0.875rem] italic">
              <RichText text={page.summary} />
            </p>
          ) : null}
          {page.theyThinkOfMe ? (
            <div className="flex flex-col gap-1 rounded-[0.75rem] bg-ui-accent-tint px-3 py-2">
              <span className="text-xs font-extrabold text-ui-accent-ink">
                {`${by} guesses ${about} thinks`}
              </span>
              <span className="text-[0.875rem] leading-relaxed italic">
                <RichText text={page.theyThinkOfMe} />
              </span>
            </div>
          ) : null}
          {page.openThreads.length ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-extrabold text-ui-soft">
                Still to do with them
              </span>
              <ul className="flex list-disc flex-col gap-0.5 ps-5 text-[0.875rem] marker:text-ui-soft">
                {page.openThreads.map((thread) => (
                  <li key={thread}>
                    <RichText text={thread} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </figure>
  );
}

const DEPTHS = [
  { key: "well", label: (them: string) => `Know ${them} well` },
  { key: "knows", label: (them: string) => `Know ${them}` },
  { key: "heard", label: (them: string) => `Have heard of ${them}` },
] as const;

/** Who in the cast knows them, and how well, from the World Wiki's page. */
function KnownBy({ character }: { character: CharacterSummary }) {
  const { data, isLoading } = useWikiReach(character.id);
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates(charactersParsers);
  const called = firstName(character.name);
  if (isLoading || !data) return null;
  const known = DEPTHS.filter(({ key }) => data[key].length);
  return (
    <section aria-label={`Who knows ${called}`} className="flex flex-col gap-3">
      <SectionTitle title={`Who knows ${called}`} />
      {known.length === 0 ? (
        <Note>{`Nobody in the cast has heard of ${called}.`}</Note>
      ) : (
        <dl className="flex flex-col gap-3">
          {known.map(({ key, label }) => (
            <div
              key={key}
              className="grid grid-cols-[9rem_minmax(0,1fr)] items-start gap-3 max-sm:grid-cols-1 max-sm:gap-1.5"
            >
              <dt className="pt-1.5 text-[0.8125rem] font-bold text-ui-soft">
                {label("them")}
              </dt>
              <dd className="flex flex-wrap gap-1.5">
                {data[key].map((person) => {
                  const who = byId.get(person.id);
                  return (
                    <button
                      key={person.id}
                      type="button"
                      onClick={() => void setParams(profilePatch(person.id))}
                      className="flex h-8 items-center gap-1.5 rounded-full bg-ui-ground ps-1 pe-3 text-[0.8125rem] font-bold transition-colors hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
                    >
                      <Face
                        id={person.id}
                        name={person.name}
                        other={who}
                        size="xs"
                      />
                      {person.name}
                    </button>
                  );
                })}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {data.none ? (
        <p className="text-[0.8125rem] text-ui-soft">
          {data.none === 1
            ? `One other hasn't heard of ${called}.`
            : `${data.none} others haven't heard of ${called}.`}
        </p>
      ) : null}
    </section>
  );
}
