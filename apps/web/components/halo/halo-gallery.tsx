"use client";

import type { CharacterSummary } from "@kazusa/client";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@ui-sdk/react/hover-card";
import { useMemo, useState } from "react";
import { presenceState } from "@/components/entities/presence-avatar";
import { useCharacterStatus, useCharacters } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { HaloFace } from "./halo-face";

const STATE_TEXT = {
  idle: "Awake",
  thinking: "Thinking",
  composing: "Typing",
  offstage: "Offstage",
  unknown: "",
} as const;

/** The cast as a yearbook: faces first, grouped by club, a peek on hover. */
export function HaloGallery() {
  const { byId } = useCharacters();
  const [selection, select] = useSelection();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const selectedId = selection?.kind === "character" ? selection.id : null;

  const groups = useMemo(() => {
    const map = new Map<string, CharacterSummary[]>();
    for (const c of byId.values()) {
      if (
        q &&
        !c.name.toLowerCase().includes(q) &&
        !(c.groups ?? []).some((g) => g.toLowerCase().includes(q))
      ) {
        continue;
      }
      const key = c.groups?.[0] ?? "Everyone else";
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [byId, q]);

  return (
    <div className="halo-gallery">
      <div className="halo-gallery-head">
        <h1 className="halo-gallery-title">Characters</h1>
        <input
          type="search"
          className="halo-input"
          aria-label="Find a character or club"
          placeholder={`Find among ${byId.size}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="halo-gallery-scroll">
        {groups.length === 0 ? (
          <p className="halo-group-empty">{`Nobody matches “${query}”.`}</p>
        ) : (
          groups.map(([name, members]) => (
            <section key={name} className="halo-gallery-group" aria-label={name}>
              <h2 className="halo-gallery-group-title">
                {name}
                <span className="halo-gallery-count">{members.length}</span>
              </h2>
              <ul className="halo-cards">
                {members.map((c) => (
                  <li key={c.id}>
                    <GalleryCard
                      character={c}
                      selected={selectedId === c.id}
                      onPick={() => void select({ kind: "character", id: c.id })}
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

function GalleryCard({
  character,
  selected,
  onPick,
}: {
  character: CharacterSummary;
  selected: boolean;
  onPick: () => void;
}) {
  const status = useCharacterStatus(
    character.kind === "agent" ? character.id : undefined,
  );
  const state = presenceState(character.kind, status);
  return (
    <HoverCard>
      <HoverCardTrigger
        className="halo-card"
        data-state={state}
        aria-current={selected ? "true" : undefined}
        onClick={onPick}
      >
        <HaloFace
          id={character.id}
          name={character.name}
          avatarUrl={character.avatarUrl}
          kind={character.kind}
          size="lg"
        />
        <span className="halo-card-name">{character.name}</span>
        {STATE_TEXT[state] ? (
          <span className="halo-card-state">{STATE_TEXT[state]}</span>
        ) : null}
      </HoverCardTrigger>
      <HoverCardContent className="halo-pop halo-peek">
        <p className="halo-peek-name">{character.name}</p>
        {status?.task ? <p className="halo-peek-task">{status.task.description}</p> : null}
        {character.summary ? (
          <p className="halo-peek-summary">{character.summary}</p>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
