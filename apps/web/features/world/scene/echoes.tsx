"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { applySceneEvent } from "@/lib/live/scene-state";
import { ECHO_MS } from "@/lib/scene/director";
import type { SceneLine } from "@/lib/scene/state";
import { actionLine } from "@/lib/source/chats/display";
import { cx } from "@/ui/cx";
import { lineKey, useRevealed } from "@/hooks/use-said-text";

/** How long an echo takes to fade out, at the end of its `ECHO_MS`. */
const FADE_MS = 1_000;

/**
 * What was just said, above the panel and apart from it: each earlier line in
 * small type on its own thin scrim (inset so its text starts where the panel's
 * does), with its own speaker's name, oldest on top and fainter, at most two
 * lines of each. Outside reading mode each fades out about `ECHO_MS` after it
 * left the panel, held while hovered or focused, and then leaves the scene's
 * state. Not a live region: the panel said it already.
 */
export function Echoes({
  chatId,
  echoes,
  nameOf,
  fading = true,
  onOpen,
}: {
  chatId: string;
  echoes: readonly SceneLine[];
  nameOf: (line: SceneLine) => string;
  /** Fade each out in time (live), or keep them until pushed out (reading mode). */
  fading?: boolean;
  /** Each echo opens the backlog. */
  onOpen?: () => void;
}) {
  // Newest first, laid out bottom up, each a full-width row: an echo that
  // doesn't fit wraps whole into a second column, out of sight, the older
  // first, instead of being cut at the top. The empty first row is there so
  // that even the newest wraps away when it alone doesn't fit.
  const newestFirst = [...echoes].reverse();
  return (
    <ol
      aria-label="Just said, newest first"
      className="flex min-h-0 shrink flex-col-reverse flex-wrap content-start gap-1.5 overflow-hidden pb-3.5 pl-2.5"
    >
      <li aria-hidden className="h-0 w-full" />
      {newestFirst.map((line, index) => (
        <Echo
          key={lineKey(line, index)}
          line={line}
          name={nameOf(line)}
          older={index > 0}
          fading={fading}
          onOpen={onOpen}
          onFaded={() => {
            if (line.messageId)
              applySceneEvent(chatId, {
                type: "fade",
                messageId: line.messageId,
              });
          }}
        />
      ))}
    </ol>
  );
}

function Echo({
  line,
  name,
  older,
  fading,
  onFaded,
  onOpen,
}: {
  line: SceneLine;
  name: string;
  older: boolean;
  fading: boolean;
  onFaded: () => void;
  onOpen?: () => void;
}) {
  const Surface = onOpen ? "button" : "div";
  // Counted from when it left the panel, so a remount doesn't restart it.
  const [mountedAt] = useState(() => Date.now());
  // Faded out while still being said: it goes once its message lands (the
  // scene's state names an echo by its message).
  const [faded, setFaded] = useState(false);
  const gone = useEffectEvent(onFaded);
  useEffect(() => {
    if (fading && faded && line.messageId) gone();
  }, [fading, faded, line.messageId]);
  const delay = Math.max(
    0,
    (line.leftAt ?? mountedAt) + ECHO_MS - FADE_MS - mountedAt,
  );
  // A line still being said goes on being revealed here.
  const text = useRevealed(line);
  const action = line.kind === "action" ? actionLine(name, line.text) : null;
  return (
    <li
      data-echo={line.kind}
      className={cx(
        "flex w-full motion-safe:animate-ui-rise",
        older && "opacity-75",
      )}
    >
      <Surface
        {...(onOpen
          ? {
              type: "button" as const,
              onClick: onOpen,
              title: "Open the backlog",
            }
          : {})}
        onAnimationEnd={(event) => {
          if (fading && event.target === event.currentTarget) setFaded(true);
        }}
        className={cx(
          "pointer-events-auto max-w-full rounded-[0.625rem] bg-ui-surface/84 px-2.5 py-1 text-start text-[0.8125rem] leading-snug outline-none focus-visible:outline-2 focus-visible:outline-ui-primary sm:max-w-[85%]",
          onOpen &&
            "cursor-pointer hover:inset-ring hover:inset-ring-ui-ink/20",
          fading &&
            "animate-ui-fade-out focus-within:[animation-play-state:paused] hover:[animation-play-state:paused]",
        )}
        style={fading ? { animationDelay: `${delay}ms` } : undefined}
      >
        <span className="line-clamp-2 block whitespace-pre-wrap">
          {action ? (
            <span className="text-ui-soft italic">
              <span className="font-bold text-ui-ink not-italic">
                {action.subject}
              </span>
              {action.rest}
            </span>
          ) : (
            <>
              <span className="mr-2 font-bold text-ui-ink">{name}</span>
              <span className="text-ui-ink/85">{text}</span>
            </>
          )}
        </span>
      </Surface>
    </li>
  );
}
