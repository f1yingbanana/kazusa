"use client";

import { memo } from "react";
import type { CharacterSummary } from "@kazusa/client";
import { PresenceAvatar } from "@/components/entities/presence-avatar";
import { cn } from "@/lib/utils";

/** People shown by name at a place before the rest become "+N". */
const SHOWN_PEOPLE = 4;

/** Names over roads and regions stay readable without a box around each. */
const HALO =
  "[text-shadow:0_0_3px_var(--background),0_0_3px_var(--background),0_0_6px_var(--background)]";

/** Positions a child at a map point at constant screen size. */
export const atPoint = (x: number, y: number) => ({
  transform: `translate(${x}px, ${y}px) scale(var(--inv, 1))`,
});

export const MapPlace = memo(function MapPlace({
  id,
  name,
  x,
  y,
  isArea,
  labeled,
  people,
  extra,
  playerHere,
  selected,
  selectedCharacter,
  playerId,
  arranging,
  dragging,
  onSelect,
  onSelectCharacter,
  onHover,
  onFocus,
  onDragStart,
  onNudge,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  isArea: boolean;
  /** An area's name sits on its region, so here it's only the marker. */
  labeled: boolean;
  people: readonly CharacterSummary[];
  /** People here or further inside who aren't shown. */
  extra: number;
  playerHere: boolean;
  selected: boolean;
  selectedCharacter: string | null;
  playerId: string;
  arranging: boolean;
  dragging: boolean;
  onSelect: (id: string) => void;
  onSelectCharacter: (id: string) => void;
  onHover: (id: string | null) => void;
  onFocus: (id: string) => void;
  onDragStart: (id: string, event: React.PointerEvent<Element>) => void;
  onNudge: (id: string, dx: number, dy: number) => void;
}) {
  const occupied = people.length + extra > 0;
  return (
    <div
      className={cn("absolute top-0 left-0 w-0", dragging && "z-20")}
      style={atPoint(x, y)}
      data-map-place=""
    >
      <div className="absolute top-0 left-0 flex w-36 -translate-x-1/2 -translate-y-[7px] flex-col items-center gap-1">
        <button
          type="button"
          aria-label={
            arranging
              ? `Move ${name}`
              : `${name}${occupied ? `, ${people.length + extra} here` : ""}`
          }
          aria-current={selected ? "true" : undefined}
          data-map-drag={arranging ? "" : undefined}
          onClick={() => !arranging && onSelect(id)}
          onDoubleClick={() => onFocus(id)}
          onPointerEnter={() => onHover(id)}
          onPointerLeave={() => onHover(null)}
          onFocus={() => onHover(id)}
          onBlur={() => onHover(null)}
          onPointerDown={(event) => {
            if (arranging) onDragStart(id, event);
          }}
          onKeyDown={(event) => {
            if (!arranging) return;
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
            event.stopPropagation();
            onNudge(id, move[0], move[1]);
          }}
          className={cn(
            "group flex max-w-full touch-none flex-col items-center gap-1 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            arranging && "cursor-grab active:cursor-grabbing",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "block size-3.5 border-[1.5px] border-foreground/70 bg-background transition-transform duration-150 group-hover:scale-125",
              isArea ? "rotate-45 rounded-[2px]" : "rounded-full",
              occupied && "border-foreground bg-foreground",
              playerHere && "border-primary bg-primary",
              selected && "outline-2 outline-offset-2 outline-primary",
              arranging && "border-primary",
            )}
          />
          {labeled ? (
            <span
              className={cn(
                "max-w-full truncate text-[11.5px] leading-tight text-foreground",
                HALO,
                selected && "font-semibold",
              )}
            >
              {name}
            </span>
          ) : null}
        </button>
        {people.length + extra > 0 && !arranging ? (
          <div className="flex items-center">
            {people.map((person) => (
              <button
                key={person.id}
                type="button"
                title={
                  person.id === playerId ? `You (${person.name})` : person.name
                }
                onClick={() => onSelectCharacter(person.id)}
                className={cn(
                  "-ml-1.5 rounded-full bg-background p-px outline-none first:ml-0 hover:z-10 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring",
                  selectedCharacter === person.id &&
                    "z-10 outline-2 outline-primary",
                  person.id === playerId && "ring-2 ring-primary",
                )}
              >
                <PresenceAvatar
                  id={person.id}
                  name={person.name}
                  avatarUrl={person.avatarUrl}
                  kind={person.kind}
                  size="xs"
                />
              </button>
            ))}
            {extra > 0 ? (
              <button
                type="button"
                onClick={() => onSelect(id)}
                className="z-[1] -ml-1 flex h-[22px] min-w-[22px] items-center justify-center rounded-full border border-border bg-background px-1 font-mono text-[10px] text-foreground tabular-nums outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                {people.length > 0 ? "+" : ""}
                {extra}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
});

/** An area's name on the upper edge of its region. */
export const MapAreaLabel = memo(function MapAreaLabel({
  id,
  name,
  x,
  y,
  depth,
  selected,
  onSelect,
  onFocus,
}: {
  id: string;
  name: string;
  x: number;
  y: number;
  depth: number;
  selected: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  return (
    <div
      className="absolute top-0 left-0 w-0"
      style={atPoint(x, y)}
      data-map-place=""
    >
      <button
        type="button"
        onClick={() => onSelect(id)}
        onDoubleClick={() => onFocus(id)}
        className={cn(
          "absolute top-0 left-0 max-w-52 -translate-x-1/2 -translate-y-1/2 truncate rounded-sm px-1 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ring",
          HALO,
          depth === 0
            ? "text-[14px] font-semibold tracking-[0.01em] text-foreground"
            : "text-xs font-medium text-foreground/85",
          selected && "text-primary",
        )}
      >
        {name}
      </button>
    </div>
  );
});

/** Someone on the road. Glides between sim-minute updates. */
export const MapTraveler = memo(function MapTraveler({
  person,
  x,
  y,
  selected,
  onSelect,
}: {
  person: CharacterSummary;
  x: number;
  y: number;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "absolute top-0 left-0 w-0 transition-transform duration-1000 ease-linear motion-reduce:transition-none",
        selected && "z-10",
      )}
      style={atPoint(x, y)}
      data-map-place=""
    >
      <button
        type="button"
        title={`${person.name}, on the way`}
        onClick={() => onSelect(person.id)}
        className={cn(
          "absolute top-0 left-0 flex -translate-x-1/2 -translate-y-1/2 rounded-full bg-background p-px outline-none focus-visible:outline-2 focus-visible:outline-ring",
          selected && "outline-2 outline-primary",
        )}
      >
        <PresenceAvatar
          id={person.id}
          name={person.name}
          avatarUrl={person.avatarUrl}
          kind={person.kind}
          size="xs"
        />
      </button>
    </div>
  );
});

export { SHOWN_PEOPLE, HALO };
