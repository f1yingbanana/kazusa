"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { applySceneEvent } from "@/lib/live/scene-state";
import { ECHO_MS } from "@/lib/scene/director";
import type { SceneLine } from "@/lib/scene/state";
import { actionLine } from "@/lib/source/chats/display";
import { cn } from "@/lib/utils";
import { lineKey, useRevealed } from "./said-text";

/** How long an echo takes to fade out, at the end of its `ECHO_MS`. */
const FADE_MS = 1_000;
/** An echo's own surface: thinner than the panel's, flat, from the token. */
const ECHO_SCRIM = "color-mix(in oklch, var(--background) 84%, transparent)";

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
    if (faded && line.messageId) gone();
  }, [faded, line.messageId]);
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
      className={cn(
        "flex w-full animate-in fade-in slide-in-from-bottom-1 duration-200",
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
        className={cn(
          "pointer-events-auto max-w-full rounded-md px-2.5 py-1 text-left text-[13px] leading-snug outline-none focus-visible:outline-2 focus-visible:outline-ring sm:max-w-[85%]",
          onOpen && "cursor-pointer hover:ring-1 hover:ring-foreground/20",
          fading &&
            "animate-out fade-out fill-mode-forwards duration-1000 hover:paused focus-within:paused",
        )}
        style={{
          backgroundColor: ECHO_SCRIM,
          ...(fading ? { animationDelay: `${delay}ms` } : {}),
        }}
      >
        <span className="line-clamp-2 block whitespace-pre-wrap">
          {action ? (
            <span className="text-muted-foreground italic">
              <span className="font-medium text-foreground not-italic">
                {action.subject}
              </span>
              {action.rest}
            </span>
          ) : (
            <>
              <span className="mr-2 font-semibold text-foreground">{name}</span>
              <span className="text-foreground/85">{text}</span>
            </>
          )}
        </span>
      </Surface>
    </li>
  );
}
