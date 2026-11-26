"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { useCharacters } from "@/hooks/use-characters";
import {
  applySceneEvent,
  useSceneBehind,
  useSceneLine,
} from "@/lib/live/scene-state";
import { isBeingSaid } from "@/lib/scene/director";
import type { SceneLine } from "@/lib/scene/state";
import { actionLine } from "@/lib/source/chats/display";
import { useSources } from "@/lib/source/provider";
import { COMPOSER_DOCK } from "@/ui/composer";
import { cx } from "@/ui/cx";
import { lineKey, useRevealed } from "@/hooks/use-said-text";
import type { ReadingStatus } from "@/hooks/use-reading-mode";

/** A line arrives whole (M0): quickly, never slower than it can be read. */
const REVEAL = "motion-safe:animate-ui-rise";

/**
 * Who said a line, as shown: the player by their display name, someone still
 * speaking by the roster's name for them, anyone else as their message names
 * them.
 */
export function useSpeakerName(): (line: SceneLine) => string {
  const { player } = useSources();
  const { byId } = useCharacters();
  return (line) =>
    line.speakerId === player.id
      ? player.name
      : isBeingSaid(line)
        ? (byId.get(line.speakerId)?.name ?? line.speakerName)
        : line.speakerName;
}

/**
 * The bottom of the scene, in one centred column that shares a left edge: a
 * slim notice if one is given, then the panel, holding exactly one line under a
 * plate with its speaker's name (an action has no plate and reads as narration)
 * and, at its foot, the reply row or a caption. The panel is never taller than
 * half the scene: its line scrolls inside it. The line is real text in a polite
 * live region.
 */
export function DialogueBox({
  chatId,
  loading = false,
  notice,
  footer,
  reading,
  morph,
}: {
  chatId: string;
  /** The huddle's history is still being read: nobody speaking isn't known. */
  loading?: boolean;
  /** Shown directly above the panel (why nobody answers). */
  notice?: ReactNode;
  /** The panel's last row: the reply box, or a read-only caption. */
  footer?: ReactNode;
  /**
   * Reading mode: the panel's corner says what is happening (a caret when a
   * line is ready).
   */
  reading?: ReadingStatus;
  /** A view transition name for the panel, to morph into the reply box. */
  morph?: string;
}) {
  const line = useSceneLine(chatId);
  const behind = useSceneBehind(chatId);
  const nameOf = useSpeakerName();
  const plated = line !== undefined && line.kind === "speech";

  // A new line is read from its start.
  const text = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (text.current) text.current.scrollTop = 0;
  }, [line]);

  return (
    // A size container over the whole scene, so the panel and the reply box
    // are measured against the scene's height: the panel at most half of it
    // (never less than a line and the reply row), the line scrolling inside.
    <div
      data-dock
      data-mode={reading ? "reading" : "live"}
      className={cx(
        "@container-size pointer-events-none absolute inset-0 z-40 pt-12",
        COMPOSER_DOCK,
      )}
    >
      <div className="mx-auto flex size-full max-w-3xl flex-col justify-end">
        {/* Gone with nothing to say (the notice may render nothing). */}
        <div
          data-notice
          className="pointer-events-auto mb-5 shrink-0 empty:hidden"
        >
          {notice}
        </div>
        <div
          data-panel
          style={morph ? { viewTransitionName: morph } : undefined}
          className="pointer-events-auto relative flex max-h-[max(50cqh,9rem)] min-h-0 shrink-0 flex-col rounded-[1.5rem] bg-ui-surface/88 shadow-ui inset-ring inset-ring-ui-ink/10"
        >
          {plated ? (
            <span
              aria-hidden
              data-plate
              style={
                morph ? { viewTransitionName: `${morph}-plate` } : undefined
              }
              className="absolute inset-s-3 -top-3 z-10 max-w-[70%] truncate rounded-full bg-ui-ink px-3 py-0.5 text-sm font-bold text-ui-ground shadow-ui"
            >
              {nameOf(line)}
            </span>
          ) : null}
          {behind > 0 && !reading ? (
            <Button
              size="sm"
              // Only for a hold long enough to notice: a line waiting a moment
              // for the one before it to be read needs no button.
              className="absolute inset-e-3 -top-3.5 z-10 shadow-ui motion-safe:animate-ui-fade-in motion-safe:[animation-delay:700ms]"
              onClick={() =>
                applySceneEvent(chatId, { type: "jump", at: Date.now() })
              }
            >
              <span className="tabular-nums">{behind}</span>
              {" behind · Jump to live"}
            </Button>
          ) : null}
          <div className="relative flex min-h-[max(3.5rem,min(5.5rem,20cqh))] flex-1 flex-col">
            <div
              ref={text}
              role="log"
              aria-live="polite"
              aria-label="What is being said"
              className={cx(
                "min-h-0 flex-1 overflow-y-auto px-5 pb-3",
                plated ? "pt-5" : "pt-3.5",
              )}
            >
              {line === undefined ? (
                loading ? (
                  // The height of the line to come, so the panel doesn't jump.
                  <p aria-hidden className="h-7" />
                ) : (
                  <p className="text-sm text-ui-soft">
                    Nobody has said anything yet.
                  </p>
                )
              ) : (
                <Line
                  key={lineKey(line, "panel")}
                  line={line}
                  name={nameOf(line)}
                  className={REVEAL}
                />
              )}
            </div>
          </div>
          {reading ? <ReadingCorner status={reading} /> : null}
          {footer}
        </div>
      </div>
    </div>
  );
}

/** The panel's line: speech under the plate, or an action narrated. */
function Line({
  line,
  name,
  className,
}: {
  line: SceneLine;
  name: string;
  className?: string;
}) {
  if (line.kind === "action") {
    const { subject, rest } = actionLine(name, line.text);
    return (
      <p
        data-line="action"
        className={cx(
          "text-base leading-relaxed whitespace-pre-wrap text-ui-soft italic sm:text-lg",
          className,
        )}
      >
        <span className="font-bold text-ui-ink not-italic">{subject}</span>
        {rest}
      </p>
    );
  }
  return (
    <p
      data-line="speech"
      data-saying={isBeingSaid(line) || undefined}
      className={cx(
        "text-base leading-relaxed whitespace-pre-wrap text-ui-ink sm:text-lg",
        className,
      )}
    >
      <span className="sr-only">{`${name}: `}</span>
      <Said line={line} />
    </p>
  );
}

/**
 * Speech as it is said: what has been heard so far for the eye, the whole line
 * at once for a screen reader (the reveal would announce every word).
 */
function Said({ line }: { line: SceneLine }) {
  const shown = useRevealed(line);
  if (!isBeingSaid(line)) return line.text;
  return (
    <>
      <span aria-hidden>{shown}</span>
      <span className="sr-only">{line.text}</span>
    </>
  );
}

/**
 * Reading mode's word at the panel's lower right: a caret breathing when a line
 * is ready; asked for with none ready, who is speaking or thinking, in plain
 * words with the person's name, or that the reader is waiting, never that a
 * line is coming; otherwise nothing. No animated dots.
 */
function ReadingCorner({ status }: { status: ReadingStatus }) {
  const { byId } = useCharacters();
  const name = (id: string) => byId.get(id)?.name ?? id;
  const words =
    status.kind === "speaking"
      ? `${name(status.id)} is speaking`
      : status.kind === "thinking"
        ? `${name(status.id)} is thinking`
        : status.kind === "waiting"
          ? "Waiting for someone to speak"
          : undefined;
  return (
    <div
      data-reading={status.kind}
      className="flex min-h-6 shrink-0 items-center justify-end gap-1.5 px-5 pb-2 text-xs text-ui-soft"
    >
      <span role="status">
        {words}
        {status.kind === "ready" ? (
          <span className="sr-only">
            A line is ready: click the scene or press Space.
          </span>
        ) : null}
      </span>
      {status.kind === "ready" ? (
        <ChevronDownIcon
          aria-hidden
          data-mark="ready"
          className="size-4 text-ui-ink motion-safe:animate-ui-pulse"
        />
      ) : null}
    </div>
  );
}
