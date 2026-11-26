"use client";

import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import { ChevronUpIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useCast } from "@/hooks/use-characters";
import { useSelection } from "@/hooks/use-selection";
import { useLiveStore } from "@/lib/live/state";
import { statusOf } from "@/lib/state/grouping";
import { ListRow, ListRows } from "@/ui/list";
import {
  Popover,
  PopoverContent,
  PopoverText,
  PopoverTitle,
  PopoverTrigger,
} from "@/ui/popover";
import { CharacterAvatar } from "../../characters/character-avatar";
import { STATUS_LINK } from "./look";

const GROUPS = [
  {
    key: "thinking",
    word: "thinking",
    heading: "Thinking",
    about: "Deciding what to do or say.",
  },
  {
    key: "composing",
    word: "writing",
    heading: "Writing",
    about: "Typing a message, or saying something aloud.",
  },
  {
    key: "waiting",
    word: "waiting",
    heading: "Waiting their turn",
    about:
      "Something to notice or answer, like a text or someone coming in. They take it in on their next turn.",
  },
] as const;
type Busy = (typeof GROUPS)[number]["key"];

const LISTED = 30;

interface Row {
  readonly character: CharacterSummary;
  readonly status: CharacterStatus;
}

/** Who in the cast is busy right now, by what they're busy with. */
export function useActivity() {
  const cast = useCast();
  const statuses = useLiveStore((state) => state.statuses);
  return useMemo(() => {
    const groups = new Map<Busy, Row[]>(GROUPS.map(({ key }) => [key, []]));
    for (const character of cast) {
      const status = statuses.get(character.id);
      const key = statusOf(status);
      if (status && groups.has(key as Busy))
        groups.get(key as Busy)?.push({ character, status });
    }
    const counts = GROUPS.map((group) => ({
      ...group,
      rows: groups.get(group.key) ?? [],
    }));
    return {
      groups: counts.filter((group) => group.rows.length > 0),
      summary:
        counts
          .filter((group) => group.rows.length > 0)
          .map((group) => `${group.rows.length} ${group.word}`)
          .join(" · ") || "All quiet",
    };
  }, [cast, statuses]);
}

function detailOf(key: Busy, status: CharacterStatus): string | undefined {
  if (key === "waiting")
    return `${status.queued} waiting${status.task ? ` · ${status.task.description}` : ""}`;
  return status.task?.description;
}

/**
 * Everyone busy, grouped; picking someone opens them. Shared by the bar's popup
 * and the phone's More sheet.
 */
export function ActivityList({ onPicked }: { onPicked?: () => void }) {
  const { groups } = useActivity();
  const [, select] = useSelection();
  if (groups.length === 0)
    return (
      <PopoverText>
        Nobody is thinking, writing or waiting right now.
      </PopoverText>
    );
  return (
    <div className="-mx-2 flex flex-col gap-3">
      {groups.map((group) => (
        <section
          key={group.key}
          aria-label={group.heading}
          className="flex flex-col"
        >
          <h3 className="px-2 text-xs font-bold text-ui-soft">
            {`${group.heading} · ${group.rows.length}`}
          </h3>
          <p className="px-2 pb-1 text-xs text-ui-soft">{group.about}</p>
          <ListRows>
            {group.rows.slice(0, LISTED).map(({ character, status }) => (
              <li key={character.id}>
                <ListRow
                  leading={
                    <CharacterAvatar
                      id={character.id}
                      name={character.name}
                      avatarUrl={character.avatarUrl}
                      kind={character.kind}
                      size="sm"
                      decorative
                    />
                  }
                  title={character.name}
                  sub={detailOf(group.key, status)}
                  onClick={() => {
                    void select({ kind: "character", id: character.id });
                    onPicked?.();
                  }}
                />
              </li>
            ))}
          </ListRows>
          {group.rows.length > LISTED ? (
            <p className="px-3 text-xs text-ui-soft">
              {`and ${group.rows.length - LISTED} more`}
            </p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

/** "2 thinking · 1 writing": opens who they are. */
export function ActivityItem() {
  const { summary, groups } = useActivity();
  const [open, setOpen] = useState(false);
  if (groups.length === 0) return <span>{summary}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={STATUS_LINK}
        aria-label={`Who's busy: ${summary}`}
      >
        <span className="tabular-nums">{summary}</span>
        <ChevronUpIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="max-h-[min(32rem,70dvh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
      >
        <PopoverTitle>Who's busy</PopoverTitle>
        <ActivityList onPicked={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
