"use client";

import type { CharacterSummary } from "@kazusa/client";
import { memo, type CSSProperties, type ReactNode } from "react";
import { AvatarStack } from "@/ui/avatar";
import { CanvasItem, CanvasSpot } from "@/ui/canvas";
import { cx } from "@/ui/cx";
import { Picture } from "@/ui/picture";
import { usePageName } from "@/hooks/use-wiki";
import { CharacterAvatar } from "../../characters/character-avatar";
import { PRESENCE_TEXT, usePresence } from "../../characters/presence";
import { taskIcon, taskLabel } from "@/lib/state/task-icon";
import { BACKDROP_POSITION } from "@/lib/scene/layout";
import { firstName } from "@/lib/format";
import { formatSimDuration } from "@/lib/time/sim";

/**
 * Words on the map stay readable over roads and regions without a box: an
 * outline in the ground's colour under the letters, which costs far less to
 * paint every frame of a zoom than blurred shadows.
 */
const HALO =
  "[-webkit-text-stroke:3px_var(--ui-ground)] [paint-order:stroke_fill]";

/** Words that appear as you zoom in fade in where they stand. */
const FADE_IN =
  "transition-opacity duration-300 starting:opacity-0 motion-reduce:transition-none";

/**
 * A place: a dot (a diamond for an area) with its name under it when there's
 * room. Hovered or focused it lifts; picked it sends out a ripple once and
 * keeps a ring; where you are, it pings.
 */
export const PlaceMarker = memo(function PlaceMarker({
  id,
  name,
  x,
  y,
  isArea,
  labeled,
  count,
  occupied,
  playerHere,
  talking = false,
  selected,
  arranging,
  dragging,
  onSelect,
  onOpen,
  onDragStart,
  onNudge,
  leaving = false,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Fading out where it stands, on its way out. */
  leaving?: boolean;
  isArea: boolean;
  labeled: boolean;
  count: number;
  occupied: boolean;
  playerHere: boolean;
  /** People are talking there face to face. */
  talking?: boolean;
  selected: boolean;
  arranging: boolean;
  dragging: boolean;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onDragStart: (id: string, event: React.PointerEvent<Element>) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
}) {
  return (
    <CanvasItem
      value={id}
      x={x}
      y={y}
      leaving={leaving}
      aria-hidden={leaving || undefined}
      anchor="-50%, -8px"
      aria-label={
        arranging
          ? `Move ${name}`
          : `${name}${playerHere ? ", you're here" : ""}${count ? `, ${count} here` : ""}${talking ? ", people talking" : ""}`
      }
      aria-current={selected ? "true" : undefined}
      data-canvas-hold={arranging ? "" : undefined}
      onClick={() => !arranging && onSelect(id)}
      onDoubleClick={() => onOpen(id)}
      onPointerDown={(event) => {
        if (arranging) onDragStart(id, event);
      }}
      onKeyDown={(event) => {
        if (!arranging) {
          if (event.key === "f" || event.key === "F") {
            event.preventDefault();
            onOpen(id);
          }
          return;
        }
        const step = event.shiftKey ? 64 : 16;
        const moves: Record<string, readonly [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step],
        };
        const move = moves[event.key];
        if (!move) return;
        event.preventDefault();
        onNudge(id, move[0], move[1]);
      }}
      className={cx(
        "group/place flex w-max touch-none flex-col items-center gap-1 rounded-[0.5rem] outline-none",
        dragging && "z-20",
        selected && "z-10",
        arranging && "cursor-grab active:cursor-grabbing",
      )}
    >
      <span className="flex flex-col items-center gap-1">
        <span
          aria-hidden="true"
          className={cx(
            "relative grid size-4 place-items-center transition-[scale] duration-200 ease-[cubic-bezier(0.3,1.6,0.5,1)] group-hover/place:scale-130 group-focus-visible/place:scale-130 group-data-[hovered]/place:scale-130",
            selected && "scale-125",
          )}
        >
          {playerHere ? (
            <span className="absolute inset-0 rounded-full bg-ui-accent motion-safe:animate-ui-ping" />
          ) : null}
          {selected ? <Found /> : null}
          {talking ? (
            <span className="absolute -top-3 -right-3.5 grid size-4 origin-bottom-left place-items-center rounded-full rounded-bl-[3px] bg-ui-accent text-ui-on-accent shadow-ui motion-safe:animate-ui-pop [&_svg]:size-2.5">
              <SpeechDots />
            </span>
          ) : null}
          <span
            className={cx(
              "relative block size-3.5 border-2 border-ui-soft bg-ui-surface shadow-[0_1px_3px_color-mix(in_oklch,var(--ui-ink)_25%,transparent)] transition-colors duration-200",
              isArea ? "rotate-45 rounded-[3px]" : "rounded-full",
              occupied && "border-ui-primary bg-ui-primary",
              playerHere && "border-ui-accent bg-ui-accent",
              selected && "outline-2 outline-offset-2 outline-ui-primary",
              arranging && "border-dashed border-ui-primary",
              "group-focus-visible/place:outline-2 group-focus-visible/place:outline-offset-3 group-focus-visible/place:outline-ui-primary",
            )}
          />
        </span>
        {labeled ? (
          <span
            className={cx(
              "px-1 text-[11.5px] leading-tight font-bold whitespace-nowrap text-ui-ink transition-[color,opacity] duration-300 starting:opacity-0",
              HALO,
              selected && "text-ui-primary",
            )}
          >
            {name}
          </span>
        ) : null}
      </span>
    </CanvasItem>
  );
});

/**
 * One face in a place's stack. Each person is drawn on their own, so when the
 * place they count toward changes (zooming into an area, or arriving somewhere)
 * the face glides there, and a stack fans out or folds into its count. Pointer
 * only: the place itself says how many are there.
 */
export const PersonFace = memo(function PersonFace({
  person,
  x,
  y,
  dx,
  dy,
  layer,
  isPlayer,
  selected,
  onSelect,
  placeId,
  onReach,
  onHover,
}: {
  person: CharacterSummary;
  x: number;
  y: number;
  /** Its seat in the stack, in screen pixels from the place's dot. */
  dx: number;
  dy: number;
  layer: number;
  isPlayer: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  placeId: string;
  /** The pointer reached for this stack, or left it. */
  onReach: (placeId: string, reaching: boolean) => void;
  /** The pointer is on this face, or left it. */
  onHover: (id: string, on: boolean) => void;
}) {
  return (
    <CanvasSpot x={x} y={y} anchor="-50%, 0px" glide="settle" layer={layer}>
      <FaceButton
        person={person}
        label={isPlayer ? `You (${person.name})` : person.name}
        selected={selected}
        onSelect={onSelect}
        onHover={(on) => {
          onReach(placeId, on);
          onHover(person.id, on);
        }}
        style={{ translate: `${dx}px ${dy}px` }}
        className={cx(
          "pointer-events-auto transition-[translate,opacity,scale] duration-450 ease-[cubic-bezier(0.22,1,0.36,1)] starting:scale-90 starting:opacity-0 hover:scale-112 motion-reduce:transition-none",
          isPlayer && !selected && "outline-2 outline-ui-accent",
        )}
      />
    </CanvasSpot>
  );
});

/** How many more are at a place than its stack has room for. */
export const CountBubble = memo(function CountBubble({
  x,
  y,
  dx,
  dy,
  count,
  plus,
  placeId,
  onPress,
  onReach,
}: {
  x: number;
  y: number;
  dx: number;
  dy: number;
  count: number;
  /** Shown beside faces, so it reads "+3" rather than "3". */
  plus: boolean;
  placeId: string;
  onPress: (placeId: string) => void;
  onReach: (placeId: string, reaching: boolean) => void;
}) {
  return (
    <CanvasSpot x={x} y={y} anchor="-50%, 0px" layer={0}>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onPress(placeId)}
        onPointerEnter={() => onReach(placeId, true)}
        onPointerLeave={() => onReach(placeId, false)}
        style={{ translate: `${dx}px ${dy}px` }}
        className="pointer-events-auto grid h-7 min-w-7 place-items-center rounded-full bg-ui-surface px-1.5 text-[11px] font-extrabold text-ui-ink tabular-nums shadow-[0_0_0_2px_var(--ui-surface)] inset-ring inset-ring-ui-line transition-opacity duration-250 hover:bg-ui-tint motion-reduce:transition-none starting:opacity-0"
      >
        {plus ? "+" : ""}
        {count}
      </button>
    </CanvasSpot>
  );
});

/** A face you can press on the map, ringed while it's the one picked. */
function FaceButton({
  person,
  label,
  selected,
  onSelect,
  onHover,
  className,
  style,
}: {
  person: CharacterSummary;
  label: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (on: boolean) => void;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onClick={() => onSelect(person.id)}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      style={style}
      className={cx(
        "relative grid size-7 place-items-center rounded-full outline-offset-2",
        selected && "outline-2 outline-ui-primary",
        className,
      )}
    >
      <CharacterAvatar
        id={person.id}
        name={person.name}
        avatarUrl={person.avatarUrl}
        kind={person.kind}
        size="sm"
        decorative
      />
      {selected ? <Found /> : null}
    </button>
  );
}

/** A ring that rings out once from something just picked, so the eye finds it. */
function Found() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -inset-1 rounded-full border-2 border-ui-primary opacity-0 motion-safe:animate-ui-ripple"
    />
  );
}

/** An area's name on the edge of its island, set like an atlas: spaced capitals. */
export const AreaLabel = memo(function AreaLabel({
  id,
  name,
  x,
  y,
  depth,
  selected,
  onSelect,
  leaving = false,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  leaving?: boolean;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <CanvasSpot
      x={x}
      y={y}
      leaving={leaving}
      className={leaving ? undefined : "pointer-events-auto"}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden={leaving || undefined}
        disabled={leaving}
        onClick={() => onSelect(id)}
        className={cx(
          "block rounded-[0.375rem] px-1.5 whitespace-nowrap uppercase outline-none hover:text-ui-primary",
          FADE_IN,
          HALO,
          depth === 0
            ? "text-[12.5px] font-extrabold tracking-[0.2em] text-ui-ink"
            : "text-[10.5px] font-extrabold tracking-[0.16em] text-ui-soft",
          selected && "text-ui-primary",
        )}
      >
        {name}
      </button>
    </CanvasSpot>
  );
});

/** Someone between places, gliding along the road with the clock. */
export const Traveler = memo(function Traveler({
  person,
  x,
  y,
  selected,
  onSelect,
  onHover,
}: {
  person: CharacterSummary;
  x: number;
  y: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string, on: boolean) => void;
}) {
  return (
    <CanvasSpot
      x={x}
      y={y}
      glide="steady"
      layer={selected ? 10 : 1}
      className="pointer-events-auto"
    >
      <FaceButton
        person={person}
        label={`${person.name}, on the way`}
        selected={selected}
        onSelect={onSelect}
        onHover={(on) => onHover(person.id, on)}
        className="transition-[scale] duration-200 hover:scale-115"
      />
    </CanvasSpot>
  );
});

/** How long a road takes, as a chip on its middle. */
export const RoadTime = memo(function RoadTime({
  x,
  y,
  text,
  called,
}: {
  x: number;
  y: number;
  text: string;
  called: boolean;
}) {
  return (
    <CanvasSpot x={x} y={y} className="pointer-events-none">
      <span
        className={cx(
          "block rounded-full px-1.5 py-px text-[10px] font-bold whitespace-nowrap tabular-nums",
          FADE_IN,
          HALO,
          called ? "text-ui-primary" : "text-ui-soft",
        )}
      >
        {text}
      </span>
    </CanvasSpot>
  );
});

/** A road out of a place, for the peek: where it goes and how long it takes. */
export interface PeekRoad {
  readonly to: string;
  readonly name: string;
  readonly text: string;
}

export const PEEK_WIDTH = 256;

/**
 * A card beside something on the map, settling in a beat after the pointer
 * stops on it. Decoration only: what it's beside names itself to a screen
 * reader.
 */
function MapPeek({
  x,
  y,
  anchor,
  children,
}: {
  x: number;
  y: number;
  /** Where it sits against its point, so it stays on screen. */
  anchor: string;
  children: ReactNode;
}) {
  return (
    <CanvasSpot
      x={x}
      y={y}
      anchor={anchor}
      layer={100}
      aria-hidden="true"
      className="pointer-events-none"
    >
      <div
        style={{ width: PEEK_WIDTH }}
        className="flex flex-col overflow-hidden rounded-[1.1rem] ui-raised text-start transition-[opacity,scale] delay-150 duration-250 ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-reduce:transition-none starting:scale-95 starting:opacity-0"
      >
        {children}
      </div>
    </CanvasSpot>
  );
}

/** Three dots in a speech bubble's tail, rising in turn. */
function SpeechDots() {
  return (
    <span className="flex gap-[1.5px]">
      {[
        "[animation-delay:0ms]",
        "[animation-delay:160ms]",
        "[animation-delay:320ms]",
      ].map((delay) => (
        <span
          key={delay}
          className={cx(
            "size-[2.5px] rounded-full bg-current motion-safe:animate-ui-dot",
            delay,
          )}
        />
      ))}
    </span>
  );
}

/**
 * A quiet preview beside the place under the pointer or keyboard: its picture
 * at this hour, where it sits, what it is, who's there and the nearest places a
 * road leads to.
 */

export function PlacePeek({
  x,
  y,
  anchor,
  name,
  path,
  summary,
  picture,
  inside,
  roads,
  moreRoads,
  people,
  extra,
  hint,
}: {
  x: number;
  y: number;
  /** Where it sits against the place, so it stays on screen. */
  anchor: string;
  name: string;
  path: string;
  summary: string;
  picture: string | undefined;
  /** Places inside an area; 0 for a place. */
  inside: number;
  roads: readonly PeekRoad[];
  moreRoads: number;
  people: readonly CharacterSummary[];
  extra: number;
  hint: string | undefined;
}) {
  const here = people.length + extra;
  return (
    <MapPeek x={x} y={y} anchor={anchor}>
      {picture ? (
        <Picture
          src={picture}
          position={BACKDROP_POSITION}
          className="aspect-16/7"
        />
      ) : null}
      <div className="flex flex-col gap-1.5 p-3">
        {path ? (
          <span className="text-[10px] leading-snug font-extrabold tracking-[0.14em] text-ui-soft uppercase">
            {path}
          </span>
        ) : null}
        <span className="text-sm leading-tight font-extrabold">{name}</span>
        {summary ? (
          <span className="text-xs leading-snug text-ui-ink/80">{summary}</span>
        ) : null}

        <span className="mt-0.5 flex items-center gap-2">
          {people.length > 0 ? (
            <AvatarStack>
              {people.map((person) => (
                <CharacterAvatar
                  key={person.id}
                  id={person.id}
                  name={person.name}
                  avatarUrl={person.avatarUrl}
                  kind={person.kind}
                  decorative
                  size="sm"
                />
              ))}
            </AvatarStack>
          ) : null}
          <span className="min-w-0 truncate text-xs text-ui-soft">
            {[
              here === 0
                ? "Nobody here"
                : here === 1
                  ? firstName(people[0].name)
                  : `${here} here`,
              inside > 0
                ? `${inside} ${inside === 1 ? "place" : "places"} inside`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>

        {roads.length > 0 ? (
          <ul className="flex flex-col gap-0.5 border-t border-ui-line pt-1.5 text-[11px]">
            {roads.map((road) => (
              <li key={road.to} className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1">{road.name}</span>
                <span className="shrink-0 text-ui-soft tabular-nums">
                  {road.text}
                </span>
              </li>
            ))}
            {moreRoads > 0 ? (
              <li className="text-ui-soft">
                {moreRoads} more {moreRoads === 1 ? "road" : "roads"}
              </li>
            ) : null}
          </ul>
        ) : null}

        {hint ? (
          <span className="text-[11px] font-bold text-ui-primary">{hint}</span>
        ) : null}
      </div>
    </MapPeek>
  );
}

/**
 * The same quiet preview for someone on the map: who they are, what they're
 * doing and for how long, and where they are or are headed.
 */
export function PersonPeek({
  x,
  y,
  anchor,
  person,
  where,
  isPlayer,
  now,
}: {
  x: number;
  y: number;
  anchor: string;
  person: CharacterSummary;
  /** "At the library", "On the way to the station · 4 min". */
  where: string;
  isPlayer: boolean;
  /** Sim ms, for how long their task has left. */
  now: number;
}) {
  const { status, presence } = usePresence(person);
  const task = status?.task;
  const groupName = usePageName();
  // Only the nearest group, so it never outweighs the name.
  const group = person.groups?.[0] ? groupName(person.groups[0]) : undefined;
  const TaskIcon = taskIcon(task?.type);
  // What they're at, and what their mind is doing only while it's busy.
  const doing = [
    task ? taskLabel(task.type) : null,
    presence === "thinking" ||
    presence === "composing" ||
    presence === "offstage"
      ? PRESENCE_TEXT[presence]
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <MapPeek x={x} y={y} anchor={anchor}>
      <div className="flex flex-col gap-1.5 p-3">
        <span className="flex items-center gap-2.5">
          <CharacterAvatar
            id={person.id}
            name={person.name}
            avatarUrl={person.avatarUrl}
            kind={person.kind}
            decorative
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm leading-tight font-extrabold">
              {isPlayer ? `${person.name} (you)` : person.name}
            </span>
            {group ? (
              <span className="text-[11px] leading-snug text-ui-soft">
                {group}
              </span>
            ) : null}
            {doing ? (
              <span className="flex items-center gap-1 text-[11px] font-bold text-ui-accent-ink">
                {task ? <TaskIcon aria-hidden className="size-3" /> : null}
                {doing}
              </span>
            ) : null}
          </span>
        </span>
        {task ? (
          <span className="flex flex-col gap-0.5">
            <span className="line-clamp-3 text-xs leading-snug font-bold">
              {task.description}
            </span>
            {task.endAt > now ? (
              <span className="text-[11px] text-ui-soft">
                {formatSimDuration(task.endAt - now)} left
              </span>
            ) : null}
          </span>
        ) : null}
        {person.summary ? (
          <span className="text-xs leading-snug text-ui-ink/80">
            {person.summary}
          </span>
        ) : null}
        <span className="border-t border-ui-line pt-1.5 text-[11px] text-ui-soft">
          {where}
        </span>
      </div>
    </MapPeek>
  );
}
