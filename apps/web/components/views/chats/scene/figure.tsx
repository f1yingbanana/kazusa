"use client";

import { useEffect, useState, type AnimationEvent } from "react";
import { useCharacter } from "@/hooks/use-characters";
import { usePortraits } from "@/hooks/use-scene";
import { applySceneEvent } from "@/lib/live/scene-state";
import {
  columnLeft,
  floorPercent,
  standFigure,
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
 * One person in the scene: their portrait for the look they wear, drawn at its
 * own natural size times the scene's one scale, never fitted, so relative size
 * is the pictures' own. It stands with its feet on the scene's floor line and
 * its centre on its column's, each outfit at the scale that draws the character
 * as tall as they are (`standFigure`; `portraits.json` says where and how
 * large). Its face is the mood of its look (a line's face, §6.3), else, or
 * where the outfit has no picture of that mood, its neutral one. Only people
 * with portraits are figures. `lit`: the speaker of the panel's line, at full
 * brightness while the others are dimmed (`undefined`: nobody dimmed); nobody
 * changes size or place for it. Walking in and out ends in `settle`; a change
 * of column slides.
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
    // The face drawn: a mood the outfit lacks shows its neutral one.
    const mood = portrait.mood;
    const stood = sceneHeight
      ? standFigure(portrait.placement, sceneHeight, framing)
      : undefined;
    return (
      <div
        key="portrait"
        {...data}
        onAnimationEnd={settle}
        className={cn("pointer-events-none absolute", SLIDE, motion)}
        // Hung by one point of the picture: across, the figure's centre on the
        // column; down, the row it stands on at the floor line (or its eyes,
        // framed closely). `translate` is its own property, so the walk's
        // `transform` adds to it.
        style={{
          left,
          top: `${stood ? stood.atPercent : floorPercent(framing)}%`,
          zIndex,
          translate: stood
            ? `calc(${-stood.centrePercent}% + ${stood.x}px) calc(${-stood.rowPercent}% + ${stood.y}px)`
            : "-50% -100%",
        }}
      >
        <img
          src={portrait.url}
          alt={mood && mood !== NEUTRAL_MOOD ? `${name}, ${mood}` : name}
          draggable={false}
          onError={() => setBroken(portrait.url)}
          className={cn(
            "block size-auto max-w-none select-none",
            "transition-[filter] duration-300 ease-out",
            dimmed && "brightness-[0.72]",
          )}
          // Natural size, at the scene's scale times its own.
          style={stood ? { zoom: stood.zoom } : {}}
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
