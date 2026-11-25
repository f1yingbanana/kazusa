"use client";

import { BookOpenIcon, ListIcon, Minimize2Icon } from "lucide-react";
import { EXIT_ATTRIBUTE } from "@/hooks/use-scene-fullscreen";
import { cx } from "@/ui/cx";
import { Toolbar, ToolbarIconButton } from "@/ui/toolbar";
import { Clock } from "../../shell/clock";

/** What reading mode does, in plain words, for its tooltip. */
export const READING_HINT =
  "Reading mode: the world waits while a line is unread. Click or press Space for the next.";

export interface ReadingToggleProps {
  readonly on: boolean;
  readonly onToggle: () => void;
}

const CHIP =
  "absolute top-[max(0.5rem,env(safe-area-inset-top))] z-50 rounded-full bg-ui-surface/88 shadow-ui inset-ring inset-ring-ui-ink/10 motion-safe:animate-ui-fade-in";

/**
 * Over the top corners of a scene in full screen, where the top bar and the
 * header are hidden: the clock on one side, and on the other the transcript,
 * reading mode and the way out.
 */
export function FullscreenControls({
  onExit,
  onBacklog,
  reading,
}: {
  onExit: () => void;
  onBacklog?: () => void;
  reading?: ReadingToggleProps;
}) {
  return (
    <>
      <div className={cx(CHIP, "start-2 p-1 sm:start-3 [&>div]:gap-1")}>
        <Clock />
      </div>
      <Toolbar label="Scene" className={cx(CHIP, "end-2 shadow-ui sm:end-3")}>
        {onBacklog ? (
          <ToolbarIconButton
            label="Transcript"
            tooltipSide="bottom"
            onClick={onBacklog}
          >
            <ListIcon aria-hidden />
          </ToolbarIconButton>
        ) : null}
        {reading ? (
          <ToolbarIconButton
            label={READING_HINT}
            tooltipSide="bottom"
            aria-pressed={reading.on}
            className={cx(reading.on && "bg-ui-tint text-ui-ink")}
            onClick={(event) => {
              // Focus off the button, so Space then advances the scene.
              if (!reading.on) event.currentTarget.blur();
              reading.onToggle();
            }}
          >
            <BookOpenIcon aria-hidden />
          </ToolbarIconButton>
        ) : null}
        <ToolbarIconButton
          label="Exit full screen"
          shortcut="Esc"
          tooltipSide="bottom"
          onClick={onExit}
          {...{ [EXIT_ATTRIBUTE]: "" }}
        >
          <Minimize2Icon aria-hidden />
        </ToolbarIconButton>
      </Toolbar>
    </>
  );
}
