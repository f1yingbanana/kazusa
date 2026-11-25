"use client";

import type { CharacterSummary } from "@kazusa/client";
import { useState } from "react";
import { useSelection } from "@/hooks/use-selection";
import { matchesQuery } from "@/lib/state/grouping";
import { SearchInput } from "@/ui/input";
import {
  ListPane,
  ListPaneScroll,
  ListRow,
  ListRows,
  ListSection,
} from "@/ui/list";
import { Note } from "@/ui/note";
import { CharacterAvatar } from "../characters/character-avatar";
import { taskIcon, taskLabel } from "@/lib/state/task-icon";
import { usePresence } from "../characters/presence";
import { useWorldNow } from "../legacy";

/** Everyone onstage, grouped by the room they're in. */
export function WhosWhere({ onNavigated }: { onNavigated?: () => void }) {
  const { rooms, travelers, unplaced, cast } = useWorldNow();
  const [selection, select] = useSelection();
  const [query, setQuery] = useState("");
  const match = (c: CharacterSummary) => matchesQuery(c, query);
  const selectedId = selection?.kind === "character" ? selection.id : null;

  const pick = (c: CharacterSummary) => {
    void select({ kind: "character", id: c.id });
    onNavigated?.();
  };

  const groups = [
    ...rooms.map((room) => ({
      key: room.placeId,
      title: room.label,
      sub: room.area,
      members: room.members.filter(match),
    })),
    {
      key: "traveling",
      title: "On the way",
      sub: "",
      members: travelers.filter(match),
    },
    {
      key: "unplaced",
      title: "Somewhere",
      sub: "",
      members: unplaced.filter(match),
    },
  ].filter((g) => g.members.length > 0);

  return (
    <ListPane
      head={
        <SearchInput
          aria-label="Search characters"
          placeholder={`Search ${cast.total} characters`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      }
      foot={`${cast.onstage} of ${cast.total} onstage`}
    >
      <ListPaneScroll>
        {groups.length === 0 ? (
          <Note inset="list">
            {query.trim()
              ? `Nobody onstage matches “${query}”.`
              : "Nobody is onstage yet."}
          </Note>
        ) : (
          groups.map((g) => (
            <ListSection key={g.key} title={g.title} note={g.sub || undefined}>
              <ListRows>
                {g.members.map((c) => (
                  <li key={c.id}>
                    <ListRow
                      current={selectedId === c.id}
                      onClick={() => pick(c)}
                      leading={
                        <CharacterAvatar
                          id={c.id}
                          name={c.name}
                          avatarUrl={c.avatarUrl}
                          kind={c.kind}
                        />
                      }
                      title={c.name}
                      sub={<Activity character={c} />}
                    />
                  </li>
                ))}
              </ListRows>
            </ListSection>
          ))
        )}
      </ListPaneScroll>
    </ListPane>
  );
}

/**
 * What someone is doing, by its category's icon and their own words; their
 * summary when they're doing nothing in particular.
 */
function Activity({ character }: { character: CharacterSummary }) {
  const { status } = usePresence(character);
  const task = status?.onstage === false ? undefined : status?.task;
  if (!task) return character.summary ?? null;
  const Icon = taskIcon(task.type);
  return (
    <>
      <Icon
        aria-label={taskLabel(task.type)}
        className="me-1 inline size-3 align-[-0.125em]"
      />
      {task.description}
    </>
  );
}
