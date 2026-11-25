"use client";

import {
  LocateFixedIcon,
  MinusIcon,
  MoveIcon,
  NavigationIcon,
  PlusIcon,
} from "lucide-react";
import { memo } from "react";
import { Button } from "@/ui/button";
import { cx } from "@/ui/cx";
import { Segmented, SegmentedItem } from "@/ui/segmented";
import { Toolbar, ToolbarIconButton, ToolbarSeparator } from "@/ui/toolbar";
import { useLingering } from "./use-lingering";

/**
 * Zoom, show everything, and find yourself: the map's own controls, bottom
 * right.
 */
export const MapControls = memo(function MapControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onFindMe,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFindMe?: () => void;
}) {
  return (
    <Toolbar
      label="Map"
      orientation="vertical"
      className="absolute right-3 bottom-3 z-20"
    >
      <ToolbarIconButton
        label="Zoom in"
        shortcut="+"
        tooltipSide="left"
        onClick={onZoomIn}
      >
        <PlusIcon aria-hidden />
      </ToolbarIconButton>
      <ToolbarIconButton
        label="Zoom out"
        shortcut="-"
        tooltipSide="left"
        onClick={onZoomOut}
      >
        <MinusIcon aria-hidden />
      </ToolbarIconButton>
      <ToolbarSeparator />
      <ToolbarIconButton
        label="Show the whole map"
        shortcut="0"
        tooltipSide="left"
        onClick={onFit}
      >
        <LocateFixedIcon aria-hidden />
      </ToolbarIconButton>
      {onFindMe ? (
        <ToolbarIconButton
          label="Where you are"
          tooltipSide="left"
          onClick={onFindMe}
        >
          <NavigationIcon aria-hidden />
        </ToolbarIconButton>
      ) : null}
    </Toolbar>
  );
});

/** Which map: each plane (a city, the sky, a dream) is drawn on its own. */
export function PlanePicker({
  planes,
  plane,
  people,
  onPlaneChange,
}: {
  planes: readonly string[];
  plane: string;
  people: ReadonlyMap<string, number>;
  onPlaneChange: (plane: string) => void;
}) {
  return (
    <Segmented
      aria-label="Map plane"
      value={plane}
      onValueChange={(value) => value !== null && onPlaneChange(value)}
      className="ui-raised"
    >
      {planes.map((option) => (
        <SegmentedItem
          key={option}
          value={option}
          className="flex items-center gap-1.5 capitalize"
        >
          {option || "Elsewhere"}
          {people.get(option) ? (
            <span className="text-[11px] tabular-nums opacity-70">
              {people.get(option)}
            </span>
          ) : null}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}

/**
 * Names the area the camera is inside, like a road atlas's running head, so
 * deep in a zoom you still know where you are. Each new name rises in.
 */
export function LookingAt({ trail }: { trail: readonly string[] }) {
  // The chip fades out with the last place it named, rather than vanishing.
  const [chip] = useLingering(trail.length ? [trail] : [], () => "chip", 300);
  if (!chip) return null;
  const names = chip.item;
  const here = names[names.length - 1];
  const above = names.slice(0, -1);
  return (
    <div
      role="status"
      aria-hidden={chip.leaving || undefined}
      className={cx(
        "flex max-w-full min-w-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] starting:-translate-y-2 starting:opacity-0 motion-reduce:transition-none",
        chip.leaving && "-translate-y-2 opacity-0",
        "ui-raised",
      )}
    >
      {above.length > 0 ? (
        <span
          key={above.join("\n")}
          className="min-w-0 truncate text-ui-soft motion-safe:animate-ui-enter"
        >
          {above.join(" › ")} ›
        </span>
      ) : null}
      <span
        key={here}
        className="shrink-0 text-ui-ink motion-safe:animate-ui-enter"
      >
        {here}
      </span>
    </div>
  );
}

export function ArrangeButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      icon={<MoveIcon aria-hidden />}
      disabled={disabled}
      onClick={onClick}
      className="ui-raised max-md:hidden"
    >
      Arrange
    </Button>
  );
}

export function ArrangeBar({
  replacedAll,
  onAutoArrange,
  onCancel,
  onSave,
}: {
  replacedAll: boolean;
  onAutoArrange: () => void;
  onCancel: () => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div
      className={cx(
        "flex w-full flex-wrap items-center gap-2 rounded-[1.25rem] p-1.5 ps-4 motion-safe:animate-ui-enter",
        "ui-raised",
      )}
    >
      <p className="me-auto min-w-48 text-xs text-ui-soft">
        {replacedAll
          ? "Saving replaces where every place on this map is drawn."
          : "Drag places, or focus one and use the arrow keys. Travel times stay the same."}
      </p>
      <Button tone="ghost" onClick={onAutoArrange}>
        Auto-arrange
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
      <Button tone="primary" pendingAnnouncement="Saving" onClick={onSave}>
        Save layout
      </Button>
    </div>
  );
}
