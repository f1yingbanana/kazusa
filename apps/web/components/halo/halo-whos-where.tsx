"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useState } from "react";
import { useWorldNow } from "@/components/views/world/world-state";
import { useSelection } from "@/hooks/use-selection";
import { HaloFace } from "./halo-face";

export function HaloWhosWhere({ onNavigated }: { onNavigated?: () => void }) {
  const { rooms, travelers, unplaced, cast } = useWorldNow();
  const [selection, select] = useSelection();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (c: CharacterSummary) => !q || c.name.toLowerCase().includes(q);

  const pick = (c: CharacterSummary) => {
    void select({ kind: "character", id: c.id });
    onNavigated?.();
  };
  const selectedId = selection?.kind === "character" ? selection.id : null;

  const groups = [
    ...rooms.map((room) => ({
      key: room.placeId,
      title: room.label,
      sub: room.area,
      members: room.members.filter(match),
    })),
    { key: "traveling", title: "On the way", sub: "", members: travelers.filter(match) },
    { key: "unplaced", title: "Somewhere", sub: "", members: unplaced.filter(match) },
  ].filter((g) => g.members.length > 0);

  return (
    <div className="halo-side">
      <div className="halo-side-head">
        <input
          type="search"
          className="halo-input"
          aria-label="Search characters"
          placeholder={`Search ${cast.total} characters`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="halo-side-scroll">
        {groups.length === 0 ? (
          <p className="halo-group-empty">
            {q ? `Nobody onstage matches “${query}”.` : "Nobody is onstage yet."}
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.key} className="halo-group" aria-label={g.title}>
              <h2 className="halo-group-title">
                {g.title}
                {g.sub ? <span className="halo-group-note">{g.sub}</span> : null}
              </h2>
              <ul className="halo-rows">
                {g.members.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="halo-row"
                      aria-current={selectedId === c.id ? "true" : undefined}
                      onClick={() => pick(c)}
                    >
                      <span className="halo-row-faces" data-count={1}>
                        <HaloFace
                          id={c.id}
                          name={c.name}
                          avatarUrl={c.avatarUrl}
                          kind={c.kind}
                        />
                      </span>
                      <span className="halo-row-text">
                        <span className="halo-row-name">{c.name}</span>
                        <span className="halo-row-sub">{c.summary}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
      <p className="halo-side-foot">
        {`${cast.onstage} of ${cast.total} onstage`}
      </p>
    </div>
  );
}
