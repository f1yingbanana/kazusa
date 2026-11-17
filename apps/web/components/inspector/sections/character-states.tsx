"use client";

import { useState } from "react";
import { parseAsString, useQueryStates } from "nuqs";
import { ChevronRightIcon } from "lucide-react";
import {
  statValue,
  statWord,
  statsOf,
  type StatDefinition,
  type StatEntry,
  type StatValue,
  type StatsResponse,
} from "@kazusa/client";
import {
  StatControl,
  statLabel,
  statProvenance,
} from "@/components/stats/stat-control";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { settingsParsers } from "@/components/views/settings/search-params";
import { useCharacters } from "@/hooks/use-characters";
import { useStats } from "@/hooks/use-stats";
import { useSources } from "@/lib/source/provider";
import type { EntityRef } from "@/lib/state/entity-ref";
import { cn } from "@/lib/utils";

/** The states that exist for them, their own apart from those toward others. */
function statesOf(data: StatsResponse, id: string, player: boolean) {
  // The player's for the player alone, and their outfit if any.
  const theirs = statsOf(data.catalog, {
    player,
    outfits: data.outfits[id],
  });
  return {
    own: theirs.filter(
      (stat) => stat.on === "character" || stat.on === "player",
    ),
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

/**
 * The player sets their own states by hand, so theirs start open. A character's
 * are meters to read, and start folded.
 */
export function useIsPlayer(entity: EntityRef): boolean {
  return useSources().player.id === entity.id;
}
export function useIsNotPlayer(entity: EntityRef): boolean {
  return !useIsPlayer(entity);
}

/** Folded: where their own states stand. */
export function CharacterStatesSummary({ entity }: { entity: EntityRef }) {
  const { data } = useStats();
  const { player } = useSources();
  if (!data) return null;
  const { own } = statesOf(data, entity.id, entity.id === player.id);
  return <>{words(own, data.records[entity.id]?.own)}</>;
}

/**
 * The world's states as they stand for this character: their own, then whoever
 * they hold something toward. Each has the control that changes it, for whoever
 * may. For the player, opened by You in the status bar, their own include the
 * states only the player has.
 */
export function CharacterStatesSection({ entity }: { entity: EntityRef }) {
  const { data, error, canManage, set } = useStats();
  const { player } = useSources();
  const [, setParams] = useQueryStates({
    view: parseAsString,
    "settings.tab": settingsParsers["settings.tab"],
  });

  if (error && !data)
    return <p className="text-sm text-destructive">{error.message}</p>;
  if (!data) return <Skeleton className="h-4" aria-hidden />;

  const { own, pair } = statesOf(data, entity.id, entity.id === player.id);
  const record = data.records[entity.id];

  if (!own.length && !pair.length) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          This world defines no states for characters.
        </p>
        {canManage ? (
          <Button
            variant="ghost"
            size="xs"
            className="-mr-2 shrink-0 text-muted-foreground"
            onClick={() =>
              void setParams({ view: "settings", "settings.tab": "states" })
            }
          >
            Define states
          </Button>
        ) : null}
      </div>
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
    <li className="flex min-h-7 items-center justify-between gap-3">
      <Tooltip>
        <TooltipTrigger
          render={<span />}
          className="min-w-0 shrink cursor-default truncate text-sm"
        >
          {label}
        </TooltipTrigger>
        <TooltipContent className="flex max-w-64 flex-col gap-1">
          <span>{stat.description}</span>
          <span className="font-mono text-[11px] tabular-nums opacity-80">
            {statProvenance(entry)}
          </span>
        </TooltipContent>
      </Tooltip>
      <StatControl stat={stat} entry={entry} onSet={onSet} label={label} />
    </li>
  );
}

/**
 * Who they hold something toward, each with where it stands: the relationships
 * that exist, at a glance. A name opens its states; anyone else in the world is
 * picked from the list underneath.
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
  const { characters } = useCharacters();
  const [open, setOpen] = useState<string | undefined>();
  const others = characters
    .filter(({ id, kind }) => id !== entity.id && kind !== "npc")
    .sort((a, b) => a.name.localeCompare(b.name));
  // Someone picked from the list stays in view until something is set.
  const held = others.filter(({ id }) => id in toward || id === open);
  const rest = others.filter(({ id }) => !(id in toward) && id !== open);
  if (!others.length) return null;

  return (
    <div className="flex flex-col gap-1.5 border-t pt-3">
      <span className="text-xs font-medium text-muted-foreground">Toward</span>
      {held.length ? (
        <ul className="-mx-2 flex flex-col">
          {held.map(({ id, name }) => (
            <li key={id} className="flex flex-col">
              <button
                type="button"
                aria-expanded={open === id}
                onClick={() => setOpen(open === id ? undefined : id)}
                className="flex min-h-7 items-center gap-2 rounded-md px-2 text-left text-sm outline-none hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="shrink-0 truncate">{name}</span>
                <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">
                  {open === id ? null : words(stats, toward[id])}
                </span>
                <ChevronRightIcon
                  aria-hidden
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                    open === id && "rotate-90",
                  )}
                />
              </button>
              {open === id ? (
                <ul className="flex flex-col gap-1.5 py-1.5 pr-2 pl-4">
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
                    <li className="text-xs text-pretty text-muted-foreground">
                      {`This moves the meter, not how they treat ${name}. That comes from their page on ${name} in the Wiki.`}
                    </li>
                  ) : null}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nobody yet.</p>
      )}
      {onSet && rest.length ? (
        <Select
          items={rest.map(({ id, name }) => ({ value: id, label: name }))}
          value={null}
          onValueChange={(next: string | null) => next && setOpen(next)}
        >
          <SelectTrigger size="sm" aria-label="Someone else" className="w-fit">
            <SelectValue placeholder="Someone else" />
          </SelectTrigger>
          <SelectContent>
            {rest.map(({ id, name }) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}
