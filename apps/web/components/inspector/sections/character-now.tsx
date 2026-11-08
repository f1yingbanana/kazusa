"use client";

import { useMemo, useState } from "react";
import {
  AudioLinesIcon,
  ChevronDownIcon,
  FootprintsIcon,
  MapPinIcon,
  PenLineIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import type { TaskSummary } from "@kazusa/client";
import {
  CharacterChip,
  ChatChip,
  PlaceChip,
  useChatTitle,
} from "@/components/entities/chips";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { taskIcon, taskLabel } from "@/components/entities/task-icon";
import {
  useCharacter,
  useCharacterStatus,
  useCharacters,
} from "@/hooks/use-characters";
import { useSimNow } from "@/hooks/use-clock";
import {
  useLocationRecord,
  useOccupancy,
  usePlace,
  usePlaces,
} from "@/hooks/use-location";
import {
  areaPath,
  positionAt,
  type PlaceIndex,
  type Position,
} from "@/lib/location/places";
import { listNames } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";
import type { EntityRef } from "@/lib/state/entity-ref";
import { formatSimDuration, formatSimTime, progress } from "@/lib/time/sim";
import { cn } from "@/lib/utils";

const MAX_FACES = 4;

/**
 * What the character is doing and where, in one glance: the task, then the
 * place (or the trip), who else is there, and any chat being typed or spoken
 * in. Brain state is left to the presence ring on the avatar.
 */
export function CharacterNowSection({ entity }: { entity: EntityRef }) {
  const character = useCharacter(entity.id);
  const status = useCharacterStatus(
    character?.kind === "agent" ? entity.id : undefined,
  );
  const places = usePlaces();
  const record = useLocationRecord(entity.id);
  const now = useSimNow();

  if (!character) return null;
  const position = record && now > 0 ? positionAt(record, now) : undefined;
  const task = status?.task;

  // Offstage, they aren't doing anything anywhere: the last task and place wait.
  if (status?.onstage === false) {
    return (
      <p className="text-sm text-muted-foreground">
        {status.queued > 0
          ? `Offstage. ${status.queued} waiting for when they're back.`
          : "Offstage: not simulated until they're back."}
      </p>
    );
  }

  if (!task && !position) {
    return (
      <p className="text-sm text-muted-foreground">
        {character.kind === "npc"
          ? "Not simulated: no activity or position."
          : character.kind === "agent" && !status
            ? "No status reported yet."
            : "Not placed anywhere yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {task ? <Task task={task} now={now} /> : null}
      {position && places ? (
        <Where
          id={entity.id}
          places={places}
          position={position}
          now={now}
          noticed={record?.noticed}
        />
      ) : null}
      {status?.composingIn.map((chatId) => (
        <Composing key={chatId} id={entity.id} chatId={chatId} />
      ))}
    </div>
  );
}

/**
 * A chat they are composing in, said the way it happens: typed to someone,
 * typed in a group, or said aloud where they stand. The chip opens the chat.
 */
function Composing({ id, chatId }: { id: string; chatId: string }) {
  const { type, mine, members, placeId } = useChatTitle(chatId);
  const place = usePlace(placeId);
  const { byId } = useCharacters();
  const { player } = useSources();
  // The player's own chats may leave the player out of their members.
  const everyone =
    mine && !members.includes(player.id) ? [...members, player.id] : members;
  // Empty when the chat can't be read: then it is just "A chat".
  const others = listNames(
    everyone
      .filter((other) => other !== id)
      .map((other) => byId.get(other)?.name ?? other),
  );

  if (type === "huddle") {
    return (
      <Line icon={AudioLinesIcon}>
        <span className="text-muted-foreground">
          {place ? "Speaking at" : others ? "Speaking to" : "Speaking in"}
        </span>
        <ChatChip id={chatId} label={place?.name ?? (others || undefined)} />
      </Line>
    );
  }
  const to = type === "direct" && others;
  return (
    <Line icon={PenLineIcon}>
      <span className="text-muted-foreground">
        {to ? "Typing to" : "Typing in"}
      </span>
      <ChatChip id={chatId} label={to ? others : undefined} />
    </Line>
  );
}

function Task({ task, now }: { task: TaskSummary; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = taskIcon(task.type);
  const fraction = now > 0 ? progress(task.startedAt, task.endAt, now) : 0;
  const span = `${formatSimTime(task.startedAt)}–${formatSimTime(task.endAt)}`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{taskLabel(task.type)}</span>
        </span>
        <span
          title={span}
          className="shrink-0 font-mono text-[11px] text-foreground tabular-nums"
        >
          {now > 0 && task.endAt > now
            ? `${formatSimDuration(task.endAt - now)} left`
            : "Due"}
        </span>
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "text-left text-sm leading-snug font-medium text-pretty outline-none focus-visible:outline-2 focus-visible:outline-ring",
          !expanded && "line-clamp-2",
        )}
      >
        {task.description}
      </button>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`Task progress, ${span}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(fraction * 100)}
      >
        <div
          className="h-full bg-primary transition-[width] duration-700"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
    </div>
  );
}

function Where({
  id,
  places,
  position,
  now,
  noticed,
}: {
  id: string;
  places: PlaceIndex;
  position: Position;
  now: number;
  noticed: readonly string[] | undefined;
}) {
  const { characters } = useCharacters();
  const everyone = useMemo(() => characters.map((c) => c.id), [characters]);
  const occupied = useOccupancy(everyone);

  if (position.kind === "traveling") {
    const { trip } = position;
    const near = places.byId.get(position.near)?.name ?? position.near;
    return (
      <div className="flex flex-col gap-1">
        <Line
          icon={FootprintsIcon}
          trailing={`arrives ${formatSimTime(trip.arriveAt)}`}
        >
          <span className="text-muted-foreground">To</span>
          <PlaceChip id={trip.to} bare />
        </Line>
        <p className="pl-5 text-xs leading-relaxed text-muted-foreground">
          {`Near ${near}`}
          {trip.purpose ? `, then ${trip.purpose.description}` : null}
        </p>
      </div>
    );
  }

  const area = areaPath(places, position.placeId);
  const here = (occupied.at.get(position.placeId) ?? []).filter(
    (other) => other !== id,
  );
  const seen = new Set(noticed ?? []);
  // Noticed people first: who they know is here is what drives them.
  const people = [...here].sort(
    (a, b) => Number(seen.has(b)) - Number(seen.has(a)),
  );
  const stay =
    position.since > 0
      ? `${formatSimDuration(Math.max(0, now - position.since))} here`
      : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <Line icon={MapPinIcon} trailing={stay}>
        <span title={area || undefined} className="min-w-0">
          <PlaceChip
            id={position.placeId}
            bare
            className="max-w-full sm:max-w-full"
          />
        </span>
      </Line>
      <People people={people} seen={seen} />
    </div>
  );
}

/**
 * Who else is there, as faces and a name or two; the full list (unnoticed
 * people dimmed) opens on demand, so a crowded room stays one line.
 */
function People({
  people,
  seen,
}: {
  people: readonly string[];
  seen: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);
  const { byId } = useCharacters();
  if (people.length === 0) {
    return (
      <Line icon={UsersIcon}>
        <span className="text-muted-foreground">Alone</span>
      </Line>
    );
  }
  // One companion is just their chip: it opens them, nothing to list.
  if (people.length === 1) {
    const other = people[0];
    return (
      <Line icon={UsersIcon}>
        <span className="text-muted-foreground">With</span>
        <span
          title={seen.has(other) ? undefined : "Hasn't noticed them"}
          className={cn("min-w-0", !seen.has(other) && "opacity-50")}
        >
          <CharacterChip id={other} />
        </span>
      </Line>
    );
  }
  const nameOf = (other: string) => byId.get(other)?.name ?? other;
  const first = nameOf(people[0]);
  const label =
    people.length === 2
      ? `${first} and ${nameOf(people[1])}`
      : `${first} and ${people.length - 1} others`;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="-mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm outline-none hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span aria-hidden className="flex shrink-0 items-center pl-0.5">
          {people.slice(0, MAX_FACES).map((other, index) => {
            const character = byId.get(other);
            return (
              <PresenceAvatar
                key={other}
                id={other}
                name={nameOf(other)}
                avatarUrl={character?.avatarUrl}
                kind={character?.kind}
                size="xs"
                className={cn(
                  "ring-2 ring-background",
                  index > 0 && "-ml-1.5",
                  !seen.has(other) && "opacity-50",
                )}
              />
            );
          })}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-muted-foreground">With </span>
          {label}
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="flex flex-wrap gap-1 pl-0.5">
          {people.map((other) => (
            <span
              key={other}
              title={seen.has(other) ? undefined : "Hasn't noticed them"}
              className={cn(!seen.has(other) && "opacity-50")}
            >
              <CharacterChip id={other} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One fact line: icon, a wrapping value, and an optional mono readout on the
 * right.
 */
function Line({
  icon: Icon,
  trailing,
  children,
}: {
  icon: LucideIcon;
  trailing?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-1.5 text-sm">
      <Icon
        aria-hidden
        className="mt-1 size-3.5 shrink-0 text-muted-foreground"
      />
      <div className="-my-0.5 flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
        {children}
      </div>
      {trailing ? (
        <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
