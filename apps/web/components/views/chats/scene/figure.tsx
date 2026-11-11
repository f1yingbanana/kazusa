"use client";

import { useEffect, useState, type AnimationEvent } from "react";
import { useCharacter } from "@/hooks/use-characters";
import { usePortraits } from "@/hooks/use-scene";
import { applySceneEvent } from "@/lib/live/scene-state";
import {
  columnLeft,
  figureScale,
  floorPercent,
  type Framing,
  type SlotCount,
} from "@/lib/scene/layout";
import { NEUTRAL_MOOD, pickPortrait } from "@/lib/scene/pick";
import type { Figure } from "@/lib/scene/state";
import { cn } from "@/lib/utils";

/**
 * How long a figure takes to walk in or out, and to slide to a new column
 * (`duration-500` below times both).
 */
export const MOVE_MS = 500;
/**
 * A walk that never reports its end (a hidden tab, an element that never
 * painted) is settled this long after it started.
 */
export const SETTLE_SLACK_MS = 250;

/** Always on: a figure whose column changes slides there. */
const SLIDE = "transition-[left] duration-500 ease-out";
const ENTER = "animate-in fade-in slide-in-from-bottom-4";
const LEAVE = "animate-out fade-out slide-out-to-bottom-4 fill-mode-forwards";

/** Speaker in front, then the centre over the sides; anyone leaving behind. */
function layer(
  figure: Figure,
  lit: boolean | undefined,
  slots: SlotCount,
): number {
  if (figure.presence === "leaving") return 1;
  return lit ? 30 : 20 - Math.abs(2 * figure.column - (slots - 1));
}

/**
 * One person in the scene: their portrait for the look they wear, stood in
 * their column on the scene's floor line, drawn at its own natural size times
 * the scene's one scale (`figureScale`): never fitted, never sized per person
 * or outfit, so relative size is the pictures' own. Only people with portraits
 * are figures. `lit`: the speaker of the panel's line, at full brightness while
 * the others are dimmed (`undefined`: nobody dimmed); nobody changes size or
 * place for it. Walking in and out ends in `settle`; a change of column
 * slides.
 */
export function SceneFigure({
  chatId,
  figure,
  slots,
  sceneHeight,
  framing,
  lit,
}: {
  chatId: string;
  figure: Figure;
  /** Whether this is the panel's speaker; `undefined`: nobody is dimmed. */
  lit: boolean | undefined;
  slots: SlotCount;
  /** The scene's height in px, when measured. */
  sceneHeight?: number;
  framing: Framing;
}) {
  const { id, presence } = figure;
  const name = useCharacter(id)?.name ?? id;
  // SWR re-renders only for the fields read here.
  const set = usePortraits(id).data;
  const portrait = set ? pickPortrait(set, figure.look) : undefined;
  const [broken, setBroken] = useState<string | undefined>(undefined);
  const dimmed = lit === false || (lit !== undefined && presence === "leaving");

  useEffect(() => {
    if (presence === "here") return;
    const timer = setTimeout(
      () => applySceneEvent(chatId, { type: "settle", id }),
      MOVE_MS + SETTLE_SLACK_MS,
    );
    return () => clearTimeout(timer);
  }, [chatId, id, presence]);

  const settle = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || presence === "here") return;
    applySceneEvent(chatId, { type: "settle", id });
  };
  const motion =
    presence === "entering" ? ENTER : presence === "leaving" ? LEAVE : "";
  const left = `${columnLeft(figure.column, slots)}%`;
  const zIndex = layer(figure, lit, slots);
  const data = {
    "data-figure": id,
    "data-presence": presence,
    "data-lit": lit === undefined ? "none" : dimmed ? "false" : "true",
  };

  // Each form is its own element (`key`): the empty stand-in turned into the
  // portrait would carry the walk's timing into `top` and `height`.
  if (set && portrait && broken !== portrait.url) {
    const mood = figure.look.mood;
    return (
      <div
        key="portrait"
        {...data}
        onAnimationEnd={settle}
        className={cn(
          "pointer-events-none absolute -translate-x-1/2",
          SLIDE,
          motion,
        )}
        // Its bottom edge on the floor line.
        style={{ left, bottom: `${100 - floorPercent(framing)}%`, zIndex }}
      >
        <img
          src={portrait.url}
          alt={mood && mood !== NEUTRAL_MOOD ? `${name}, ${mood}` : name}
          draggable={false}
          onError={() => setBroken(portrait.url)}
          className={cn(
            "block h-auto w-auto max-w-none select-none",
            "transition-[filter] duration-300 ease-out",
            dimmed && "brightness-[0.72]",
          )}
          // Natural size, at the scene's one scale.
          style={sceneHeight ? { zoom: figureScale(sceneHeight, framing) } : {}}
        />
      </div>
    );
  }

  // Their portraits are on the way (or failed): nothing to see, in its place.
  return (
    <div
      key="empty"
      {...data}
      className={cn("pointer-events-none absolute", SLIDE)}
      style={{ left, bottom: `${100 - floorPercent(framing)}%`, zIndex }}
    />
  );
}
