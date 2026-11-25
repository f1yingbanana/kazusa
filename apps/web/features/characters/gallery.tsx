"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useMemo, useState } from "react";
import { useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { usePageName } from "@/hooks/use-wiki";
import { groupByNearest, matchesQuery } from "@/lib/state/grouping";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { SearchInput } from "@/ui/input";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "./character-avatar";
import { PRESENCE_TEXT, usePresence } from "./presence";

/** Everyone as faces, grouped by their first group, with a peek on hover. */
export function Gallery() {
  const { byId } = useCharacters();
  const [selection, select] = useSelection();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const pageName = usePageName();
  const selectedId = selection?.kind === "character" ? selection.id : null;

  const groups = useMemo(() => {
    // Found by name, id or alias, or by the name of a group they're in.
    const found = [...byId.values()].filter(
      (c) =>
        matchesQuery(c, q) ||
        (c.groups ?? []).some((g) => pageName(g).toLowerCase().includes(q)),
    );
    return groupByNearest(found, pageName);
  }, [byId, q, pageName]);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-4 px-6 pt-5 pb-2 max-md:px-4 max-md:pt-4 max-md:pb-1">
        <h1 className="text-[1.375rem] font-extrabold">Characters</h1>
        <SearchInput
          className="ms-auto max-w-72 bg-ui-ground"
          aria-label="Find a character or group"
          placeholder={`Find among ${byId.size}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-6 max-md:px-4 max-md:pt-3 max-md:pb-4">
        {groups.length === 0 ? (
          <Note inset="list">{`Nobody matches “${query}”.`}</Note>
        ) : (
          groups.map(({ key, label, members }) => (
            <section
              key={key}
              className="flex flex-col gap-3"
              aria-label={label}
            >
              <h2 className="flex items-center gap-2 text-[0.9375rem] font-extrabold">
                {label}
                <span className="rounded-full bg-ui-accent-tint px-2 text-xs text-ui-accent-ink">
                  {members.length}
                </span>
              </h2>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 max-md:grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))]">
                {members.map((c) => (
                  <li key={c.id}>
                    <Card
                      character={c}
                      selected={selectedId === c.id}
                      onPick={() =>
                        void select({ kind: "character", id: c.id })
                      }
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function Card({
  character,
  selected,
  onPick,
}: {
  character: CharacterSummary;
  selected: boolean;
  onPick: () => void;
}) {
  const { status, presence } = usePresence(character);
  return (
    <HoverCard>
      <HoverCardTrigger
        aria-label={character.name}
        className="group/card flex w-full flex-col items-center gap-1.5 rounded-[1.25rem] px-2 pt-4.5 pb-3 text-center transition-[background-color,translate] duration-200 ease-[cubic-bezier(0.3,1.3,0.5,1)] hover:-translate-y-0.5 hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary aria-current:bg-ui-tint aria-current:inset-ring-2 aria-current:inset-ring-ui-primary motion-reduce:transition-none"
        data-presence={presence}
        aria-current={selected ? "true" : undefined}
        onClick={onPick}
      >
        <CharacterAvatar
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="lg"
        />
        <span className="text-[0.8125rem] leading-[1.3] font-bold">
          {character.name}
        </span>
        {PRESENCE_TEXT[presence] ? (
          <span className="text-[0.6875rem] font-bold text-ui-accent-ink group-data-[presence=offstage]/card:text-ui-soft">
            {PRESENCE_TEXT[presence]}
          </span>
        ) : null}
      </HoverCardTrigger>
      <HoverCardContent>
        <p className="font-extrabold">{character.name}</p>
        {status?.task ? (
          <p className="text-[0.8125rem] font-bold text-ui-accent-ink">
            {status.task.description}
          </p>
        ) : null}
        {character.summary ? (
          <p className="text-[0.8125rem] leading-normal text-ui-soft">
            {character.summary}
          </p>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
