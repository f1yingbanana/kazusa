"use client";

import type {
  CharacterSummary,
  WikiReachNote,
  WikiReachPerson,
} from "@kazusa/client";
import { ArrowRightIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useMemo, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useWikiReach } from "@/hooks/use-wiki-editor";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { SearchInput } from "@/ui/input";
import { Note } from "@/ui/note";
import { PersonOptionAvatar } from "../characters/character-picker";
import { Prose } from "../entities/prose";
import { RichText, usePageTarget } from "./links";
import { wikiPatch } from "./open";
import { MEMBERSHIP_WORD } from "./reach";
import { wikiParsers } from "./search-params";
import { RAIL } from "./article";

export type ReachDepth = "well" | "knows" | "heard" | "none";
export type KnownReachDepth = Exclude<ReachDepth, "none">;

const KNOWN_LEVELS: ReadonlyArray<{
  key: KnownReachDepth;
  label: string;
  badgeLabel: string;
  dot: string;
  badgeTone: string;
}> = [
  {
    key: "well",
    label: "Know well",
    badgeLabel: "Knows well",
    dot: RAIL.close,
    badgeTone: "bg-ui-primary/12 text-ui-primary",
  },
  {
    key: "knows",
    label: "Know",
    badgeLabel: "Knows",
    dot: RAIL.opening,
    badgeTone: "bg-ui-tint text-ui-ink",
  },
  {
    key: "heard",
    label: "Heard of",
    badgeLabel: "Heard of",
    dot: "bg-[color-mix(in_oklch,var(--ui-soft)_45%,var(--ui-line))]",
    badgeTone: "bg-ui-ground text-ui-soft",
  },
];

const DEPTH_BADGE: Readonly<
  Record<ReachDepth, { label: string; tone: string }>
> = {
  well: { label: "Knows well", tone: "bg-ui-primary/12 text-ui-primary" },
  knows: { label: "Knows", tone: "bg-ui-tint text-ui-ink" },
  heard: { label: "Heard of", tone: "bg-ui-ground text-ui-soft" },
  none: { label: "Haven't heard", tone: "bg-ui-ground text-ui-soft" },
};

const DEPTH_ORDER: Readonly<Record<ReachDepth, number>> = {
  well: 0,
  knows: 1,
  heard: 2,
  none: 3,
};

const DISPLAY_CAP = 24;

export interface ReachLookupEntry {
  id: string;
  name: string;
  depth: ReachDepth;
  why?: string | undefined;
  through?: string | undefined;
  aliases: readonly string[];
  other: CharacterSummary | undefined;
}

const SHORT_WHY: Readonly<Record<string, string>> = {
  "they are in it": "Member",
  "they have their own page on it": "Own notes",
  "known to everyone": "Everyone",
  "known directly": "Direct",
  "their home": "Home",
  "around their home": "Near home",
};

function formatWhy(why: string | undefined): string | undefined {
  if (!why) return undefined;
  const trimmed = why.trim();
  if (!trimmed) return undefined;
  return (
    SHORT_WHY[trimmed.toLowerCase()] ??
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
  );
}

/**
 * Pure filter for the WhoKnows list:
 *
 * - While searching (`query`), searches across everyone including `"none"`
 *   (`Haven't heard`), matching name, id, aliases, or formatted `why`.
 * - Without a query, filters strictly to the selected known level (`well`,
 *   `knows`, or `heard`), excluding `"none"`.
 */
export function filterReachEntries(
  entries: readonly ReachLookupEntry[],
  options: {
    query?: string;
    depth?: KnownReachDepth | null;
  },
): ReachLookupEntry[] {
  const query = (options.query ?? "").trim().toLowerCase();
  if (query) {
    return entries.filter((entry) => {
      const shownWhy = formatWhy(entry.why)?.toLowerCase();
      return (
        entry.name.toLowerCase().includes(query) ||
        entry.id.toLowerCase().includes(query) ||
        entry.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
        (entry.why?.toLowerCase().includes(query) ?? false) ||
        (shownWhy?.includes(query) ?? false)
      );
    });
  }
  const { depth } = options;
  if (!depth) return entries.filter((entry) => entry.depth !== "none");
  return entries.filter((entry) => entry.depth === depth);
}

function WhoKnowsRow({
  entry,
  showBadge,
  onOpen,
}: {
  entry: ReachLookupEntry;
  showBadge: boolean;
  onOpen: () => void;
}) {
  const badge = DEPTH_BADGE[entry.depth];
  const reason = formatWhy(entry.why);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-[0.875rem] bg-ui-ground px-2.5 py-2 text-start transition-colors hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary"
    >
      <PersonOptionAvatar name={entry.name} person={entry.other} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] leading-snug font-bold text-ui-ink">
          {entry.name}
        </span>
        {reason ? (
          <span className="block truncate text-[0.75rem] leading-snug text-ui-soft">
            {reason}
          </span>
        ) : null}
      </span>
      {showBadge ? (
        <span
          className={cx(
            "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold whitespace-nowrap",
            badge.tone,
          )}
        >
          {badge.label}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Who in the cast knows a character, place, group, or concept, and through
 * what. Shows Know well / Know / Heard of tabs directly, while searching looks
 * across the full cast (including those who haven't heard of it).
 */
export function WhoKnows({ id }: { id: string }) {
  const { data, isLoading } = useWikiReach(id);
  const { characters, byId } = useCharacters();
  const target = usePageTarget();
  const [query, setQuery] = useState("");
  const [selectedDepth, setSelectedDepth] = useState<KnownReachDepth | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);

  const { entries, counts } = useMemo(() => {
    if (!data) {
      return {
        entries: [] as ReachLookupEntry[],
        counts: { well: 0, knows: 0, heard: 0 },
      };
    }

    const reached = new Map<
      string,
      { depth: KnownReachDepth; person: WikiReachPerson }
    >();
    const pairs: ReadonlyArray<
      readonly [KnownReachDepth, readonly WikiReachPerson[]]
    > = [
      ["well", data.well],
      ["knows", data.knows],
      ["heard", data.heard],
    ];
    for (const [depth, bucket] of pairs) {
      for (const person of bucket) {
        if (!reached.has(person.id)) reached.set(person.id, { depth, person });
      }
    }

    const memberLevelById = new Map(
      data.members.flatMap((m) => (m.level ? [[m.id, m.level] as const] : [])),
    );
    const reasonOf = (personId: string, rawWhy: string | undefined) => {
      if (rawWhy?.toLowerCase() === "they are in it") {
        const level = memberLevelById.get(personId);
        if (level) return MEMBERSHIP_WORD[level];
      }
      return rawWhy;
    };

    const list: ReachLookupEntry[] = [];
    const seen = new Set<string>();
    for (const other of characters) {
      if (other.isSystemAgent || other.kind !== "agent" || other.id === id)
        continue;
      seen.add(other.id);
      const hit = reached.get(other.id);
      list.push({
        id: other.id,
        name: other.name,
        depth: hit?.depth ?? "none",
        why: reasonOf(other.id, hit?.person.why),
        through: hit?.person.through,
        aliases: other.aliases,
        other,
      });
    }
    for (const [personId, hit] of reached) {
      if (seen.has(personId) || personId === id) continue;
      const other = byId.get(personId);
      list.push({
        id: personId,
        name: other?.name ?? hit.person.name,
        depth: hit.depth,
        why: reasonOf(personId, hit.person.why),
        through: hit.person.through,
        aliases: other?.aliases ?? [],
        other,
      });
    }
    list.sort(
      (a, b) =>
        DEPTH_ORDER[a.depth] - DEPTH_ORDER[b.depth] ||
        a.name.localeCompare(b.name),
    );

    return {
      entries: list,
      counts: {
        well: data.well.length,
        knows: data.knows.length,
        heard: data.heard.length,
      },
    };
  }, [data, characters, byId, id]);

  const availableLevels = useMemo(
    () => KNOWN_LEVELS.filter(({ key }) => counts[key] > 0),
    [counts],
  );
  const activeDepth: KnownReachDepth | null =
    selectedDepth && counts[selectedDepth] > 0
      ? selectedDepth
      : (availableLevels[0]?.key ?? null);

  const trimmed = query.trim();
  const matches = useMemo(
    () =>
      filterReachEntries(entries, {
        query,
        depth: trimmed ? null : activeDepth,
      }),
    [entries, query, trimmed, activeDepth],
  );

  if (isLoading || !data) return null;

  const aware = counts.well + counts.knows + counts.heard;
  const total = aware + data.none;
  const shown = expanded ? matches : matches.slice(0, DISPLAY_CAP);

  return (
    <section aria-label="Who knows" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-baseline gap-2 text-[0.9375rem] font-extrabold">
          Who knows
          {total > 0 ? (
            <span className="text-xs font-bold text-ui-soft tabular-nums">
              {`${aware} of ${total}`}
            </span>
          ) : null}
        </h3>
        {total > 0 ? (
          <SearchInput
            aria-label="Look up someone"
            value={query}
            placeholder="Look up someone…"
            onChange={(event) => {
              setQuery(event.target.value);
              setExpanded(false);
            }}
            className="h-9 max-w-xs text-[0.8125rem]"
          />
        ) : null}
      </div>

      {!trimmed && availableLevels.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {availableLevels.map((meta) => {
            const count = counts[meta.key];
            const active = activeDepth === meta.key;
            return (
              <button
                key={meta.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSelectedDepth(meta.key);
                  setExpanded(false);
                }}
                className={cx(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary",
                  active
                    ? "bg-ui-primary/14 text-ui-primary inset-ring inset-ring-ui-primary/40"
                    : "bg-ui-ground text-ui-soft hover:bg-ui-tint hover:text-ui-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cx("size-2 rounded-full", meta.dot)}
                />
                <span>{meta.label}</span>
                <span className="tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {trimmed ? (
        matches.length === 0 ? (
          <Note>{`Nobody matching “${trimmed}” found.`}</Note>
        ) : (
          <div className="flex flex-col gap-2">
            <ul className="grid grid-cols-1 gap-2 @min-[34rem]:grid-cols-2">
              {shown.map((entry) => (
                <li key={entry.id} className="min-w-0">
                  <WhoKnowsRow
                    entry={entry}
                    showBadge
                    onOpen={() =>
                      target({ id: entry.id, kind: "person" }).open()
                    }
                  />
                </li>
              ))}
            </ul>
            {matches.length > DISPLAY_CAP && !expanded ? (
              <p className="text-xs text-ui-soft">
                {`Showing first ${DISPLAY_CAP} of ${matches.length} — keep typing to narrow down.`}
              </p>
            ) : null}
          </div>
        )
      ) : aware === 0 ? (
        <Note>No one has heard.</Note>
      ) : (
        <div className="flex flex-col gap-2">
          <ul className="grid grid-cols-1 gap-2 @min-[34rem]:grid-cols-2">
            {shown.map((entry) => (
              <li key={entry.id} className="min-w-0">
                <WhoKnowsRow
                  entry={entry}
                  showBadge={false}
                  onOpen={() => target({ id: entry.id, kind: "person" }).open()}
                />
              </li>
            ))}
          </ul>
          {matches.length > DISPLAY_CAP && !expanded ? (
            <div>
              <Button tone="ghost" size="sm" onClick={() => setExpanded(true)}>
                {`Show all ${matches.length}`}
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * What particular characters have written about a place, group, or concept in
 * their own wiki.
 */
export function CastNotes({ id }: { id: string }) {
  const { data, isLoading } = useWikiReach(id);
  const { byId } = useCharacters();
  const [, setParams] = useQueryStates(wikiParsers);
  const notes: readonly WikiReachNote[] = data?.notes ?? [];
  if (isLoading || !data) return null;
  return (
    <section aria-label="What people think" className="flex flex-col gap-3">
      <h3 className="flex items-baseline gap-2 text-[0.9375rem] font-extrabold">
        What people think
        {notes.length ? (
          <span className="text-xs font-bold text-ui-soft tabular-nums">
            {notes.length}
          </span>
        ) : null}
      </h3>
      {notes.length === 0 ? (
        <Note>No one has kept notes yet.</Note>
      ) : (
        <ul className="grid grid-cols-1 gap-3 @min-[36rem]:grid-cols-2">
          {notes.map((note) => {
            const character = byId.get(note.id);
            const author = character?.name ?? note.name;
            return (
              <li key={note.id} className="min-w-0">
                <figure className="flex h-full flex-col gap-3 rounded-[1rem] bg-ui-ground p-3.5">
                  <figcaption className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[0.8125rem] font-extrabold">
                    <span className="flex min-w-0 items-center gap-2">
                      <PersonOptionAvatar
                        name={note.name}
                        person={character}
                        size="sm"
                      />
                      <span className="truncate">{author}</span>
                    </span>
                    {note.relation ? (
                      <span className="max-w-full truncate rounded-full bg-ui-tint px-2 py-0.5 text-xs font-bold text-ui-soft">
                        {note.relation}
                      </span>
                    ) : null}
                  </figcaption>
                  <div className="flex-1">
                    {note.lead.trim() ? (
                      <Prose text={note.lead} className="text-[0.875rem]" />
                    ) : note.summary ? (
                      <p className="text-[0.875rem] italic">
                        <RichText text={note.summary} />
                      </p>
                    ) : null}
                    {note.openThreads?.length ? (
                      <div className="mt-2.5 flex flex-col gap-1">
                        <span className="text-xs font-extrabold text-ui-soft">
                          Open threads
                        </span>
                        <ul className="flex list-disc flex-col gap-0.5 ps-5 text-[0.8125rem] marker:text-ui-soft">
                          {note.openThreads.map((thread) => (
                            <li key={thread}>
                              <RichText text={thread} />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <Button
                    tone="ghost"
                    size="sm"
                    className="-mx-2 -mb-1 self-end"
                    icon={
                      <ArrowRightIcon
                        aria-hidden
                        className="rtl:-scale-x-100"
                      />
                    }
                    onClick={() =>
                      void setParams(wikiPatch(id, { agent: note.id }))
                    }
                  >
                    Open notes
                  </Button>
                </figure>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
