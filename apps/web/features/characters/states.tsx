"use client";

import {
  statValue,
  statWord,
  statsOf,
  type StatDefinition,
  type StatEntry,
  type StatValue,
  type StatsResponse,
} from "@kazusa/client";
import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useStats } from "@/hooks/use-stats";
import type { EntityRef } from "@/lib/state/entity-ref";
import { Button } from "@/ui/button";
import { AddPicker } from "@/ui/combobox";
import { cx } from "@/ui/cx";
import { Note } from "@/ui/note";
import { Tooltip } from "@/ui/tooltip";
import { useOpenSettings } from "../settings/search-params";
import { StatControl, statLabel, statProvenance } from "../stats/stat-control";
import { useCharacterOptions } from "./character-picker";

/** The states that exist for them, their own apart from those toward others. */
function statesOf(data: StatsResponse, id: string) {
  const theirs = statsOf(data.catalog, { outfits: data.outfits[id] });
  return {
    own: theirs.filter((stat) => stat.on === "character"),
    pair: theirs.filter((stat) => stat.on === "pair"),
  };
}

/** Where each of these stands, as its words in a row. */
function words(
  stats: readonly StatDefinition[],
  entries: Readonly<Record<string, StatEntry>> | undefined,
): string {
  return stats
    .map((stat) => statWord(stat, statValue(stat, entries?.[stat.name])))
    .join(" · ");
}

/** Folded: where their own states stand. */
export function CharacterStatesSummary({ entity }: { entity: EntityRef }) {
  const { data } = useStats();
  if (!data) return null;
  const { own } = statesOf(data, entity.id);
  return <>{words(own, data.records[entity.id]?.own)}</>;
}

/**
 * The world's states as they stand for this character: their own, then whoever
 * they hold something toward. Each has the control that changes it, for whoever
 * may.
 */
export function CharacterStatesSection({ entity }: { entity: EntityRef }) {
  const { data, error, canManage, set } = useStats();
  const openSettings = useOpenSettings();

  if (error && !data) return <Note>{error.message}</Note>;
  if (!data) return <Note>Loading…</Note>;

  const { own, pair } = statesOf(data, entity.id);
  const record = data.records[entity.id];

  if (!own.length && !pair.length) {
    return (
      <Note
        action={
          canManage ? (
            <Button
              tone="soft"
              size="sm"
              onClick={() => openSettings("states")}
            >
              Define states
            </Button>
          ) : undefined
        }
      >
        This world defines no states for characters.
      </Note>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {own.length ? (
        <ul className="flex flex-col gap-1.5">
          {own.map((stat) => (
            <StatRow
              key={stat.name}
              stat={stat}
              entry={record?.own[stat.name]}
              onSet={
                canManage
                  ? (value) =>
                      set({ name: stat.name, characterId: entity.id, value })
                  : undefined
              }
            />
          ))}
        </ul>
      ) : null}
      {pair.length ? (
        <Toward
          key={entity.id}
          entity={entity}
          stats={pair}
          toward={record?.toward ?? {}}
          onSet={
            canManage
              ? (name, other, value) =>
                  set({ name, characterId: entity.id, toward: other, value })
              : undefined
          }
        />
      ) : null}
    </div>
  );
}

function StatRow({
  stat,
  entry,
  onSet,
}: {
  stat: StatDefinition;
  entry: StatEntry | undefined;
  onSet?: (value: StatValue) => Promise<void>;
}) {
  const label = statLabel(stat.name);
  return (
    <li className="flex min-h-8 items-center justify-between gap-3">
      <Tooltip
        label={
          <span className="flex flex-col gap-0.5">
            <span>{stat.description}</span>
            <span className="font-medium opacity-75">
              {statProvenance(entry)}
            </span>
          </span>
        }
      >
        <span
          tabIndex={0}
          className="min-w-0 shrink cursor-default truncate rounded-[0.375rem] text-sm font-semibold underline decoration-ui-line decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-ui-primary"
        >
          {label}
        </span>
      </Tooltip>
      <StatControl stat={stat} entry={entry} onSet={onSet} label={label} />
    </li>
  );
}

/**
 * Who they hold something toward, each with where it stands: the relationships
 * that exist, at a glance. A name opens its states; anyone else in the world is
 * picked by name underneath.
 */
function Toward({
  entity,
  stats,
  toward,
  onSet,
}: {
  entity: EntityRef;
  stats: readonly StatDefinition[];
  toward: Readonly<Record<string, Readonly<Record<string, StatEntry>>>>;
  onSet?: (name: string, other: string, value: StatValue) => Promise<void>;
}) {
  const { options } = useCharacterOptions({ exclude: [entity.id] });
  const [open, setOpen] = useState<string | undefined>();
  // Someone picked from the list stays in view until something is set.
  const held = options.filter(({ value }) => value in toward || value === open);
  const rest = options.filter(
    ({ value }) => !(value in toward) && value !== open,
  );
  if (!options.length) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t border-ui-line pt-3">
      <span className="text-xs font-bold text-ui-soft">Toward</span>
      {held.length ? (
        <ul className="-mx-2 flex flex-col">
          {held.map(({ value: id, label: name }) => (
            <li key={id} className="flex flex-col">
              <button
                type="button"
                aria-expanded={open === id}
                onClick={() => setOpen(open === id ? undefined : id)}
                className="flex min-h-8 items-center gap-2 rounded-[0.625rem] px-2 text-start text-sm font-semibold outline-none hover:bg-ui-tint focus-visible:outline-2 focus-visible:outline-ui-primary"
              >
                <span className="shrink-0 truncate">{name}</span>
                <span className="min-w-0 flex-1 truncate text-end text-xs font-medium text-ui-soft">
                  {open === id ? null : words(stats, toward[id])}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className={cx(
                    "size-3.5 shrink-0 text-ui-soft transition-transform duration-150 motion-reduce:transition-none",
                    open === id && "rotate-90",
                  )}
                />
              </button>
              {open === id ? (
                <ul className="flex flex-col gap-1.5 py-1.5 ps-4 pe-2">
                  {stats.map((stat) => (
                    <StatRow
                      key={stat.name}
                      stat={stat}
                      entry={toward[id]?.[stat.name]}
                      onSet={
                        onSet
                          ? (value) => onSet(stat.name, id, value)
                          : undefined
                      }
                    />
                  ))}
                  {onSet ? (
                    // Measured: the number alone does not change behaviour.
                    <li className="text-xs text-pretty text-ui-soft">
                      {`This moves the meter, not how they treat ${name}. That comes from their page on ${name} in the Wiki.`}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Note>Nobody yet.</Note>
      )}
      {onSet && rest.length ? (
        <AddPicker
          label="Someone else"
          placeholder={`Someone else (${rest.length})`}
          options={rest}
          onAdd={(id) => setOpen(id)}
        />
      ) : null}
    </div>
  );
}
