"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ArrowDownToLineIcon, ArrowUpToLineIcon } from "lucide-react";
import { Button } from "@/ui/button";
import {
  dragEdge,
  nudgeEdge,
  visibleEnds,
  type ShotBounds,
  type ShotRange,
} from "@/lib/source/chats/screenshot";
import { cx } from "@/ui/cx";

/** Room around the first and last message, so the crop doesn't graze them. */
const PAD_PX = 8;
/**
 * The frame's corner radius, and its crop marks' thickness. Set here, not by
 * the theme's radius scale, so the marks can be drawn to meet the frame.
 */
const RADIUS_PX = 16;
const MARK_PX = 3;
/**
 * What isn't in the picture is covered by the page's background pulled toward
 * black: a light theme darkens, a dark one all but hides.
 */
const DIM =
  "color-mix(in oklch, color-mix(in oklch, var(--ui-ground) 55%, black) 82%, transparent)";
/** Hatching over a message left out inside the frame: out, at a glance. */
const HATCH =
  "repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklch, var(--ui-ink) 26%, transparent) 6px 7px)";
/** The floating bar and the button above it cover the viewport's foot. */
const BAR_CLEARANCE_PX = 96;
/** How close to the viewport's edge a drag starts scrolling it. */
const SCROLL_ZONE_PX = 56;
const SCROLL_STEP_PX = 14;

/** Where each message is in the transcript, which scrolls with it. */
function measure(content: HTMLElement, ids: readonly string[]): ShotBounds[] {
  const origin = content.getBoundingClientRect().top;
  return ids.map((id) => {
    const element = content.querySelector(`[data-shot-id="${CSS.escape(id)}"]`);
    const rect = element?.getBoundingClientRect();
    return rect
      ? { top: rect.top - origin, bottom: rect.bottom - origin }
      : { top: 0, bottom: 0 };
  });
}

/** Runs of consecutive left-out messages inside the range, as index pairs. */
function leftOutRuns(
  ids: readonly string[],
  range: ShotRange,
  excluded: ReadonlySet<string>,
): ShotRange[] {
  const runs: ShotRange[] = [];
  for (let index = range.start; index <= range.end; index++) {
    if (!excluded.has(ids[index])) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === index - 1)
      runs[runs.length - 1] = { ...last, end: index };
    else runs.push({ start: index, end: index });
  }
  return runs;
}

/**
 * The crop over the transcript while choosing what goes in a screenshot: what
 * is in stays lit, everything else is dimmed, messages left out inside it too,
 * and a handle on each edge drags it a message at a time (arrow keys too).
 * Lives inside the transcript's content, so it scrolls with the messages.
 */
export function ScreenshotFrame({
  ids,
  range,
  excluded,
  onChange,
}: {
  ids: readonly string[];
  range: ShotRange;
  excluded: ReadonlySet<string>;
  onChange: (range: ShotRange) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{
    top: number;
    height: number;
    /**
     * Left-out runs, in the transcript's coordinates like the frame (not inside
     * it, so they never ride along while the frame moves), flush with an edge
     * they touch.
     */
    gaps: {
      key: string;
      top: number;
      bottom: number;
      atStart: boolean;
      atEnd: boolean;
    }[];
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const content = () => frame.current?.parentElement ?? null;

  const place = useCallback(() => {
    const parent = frame.current?.parentElement;
    if (!parent) return;
    const [first, last] = measure(parent, [ids[range.start], ids[range.end]]);
    const top = first.top - PAD_PX;
    const height = last.bottom - first.top + PAD_PX * 2;
    const gaps = leftOutRuns(ids, range, excluded).map((run) => {
      const [from, to] = measure(parent, [ids[run.start], ids[run.end]]);
      const atStart = run.start === range.start;
      const atEnd = run.end === range.end;
      return {
        key: ids[run.start],
        top: atStart ? top : from.top - PAD_PX / 2,
        bottom: atEnd ? top + height : to.bottom + PAD_PX / 2,
        atStart,
        atEnd,
      };
    });
    setBox({ top, height, gaps });
  }, [ids, range.start, range.end, excluded]);

  // Messages grow as they load in, scroll into view or arrive.
  useLayoutEffect(() => {
    place();
    const parent = frame.current?.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(place);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [place]);

  // Keeps an end moved by a click or a key in view, as a text selection does.
  // Runs once the box has caught up with the range (`place` sets it first).
  const shown = useRef(range);
  useLayoutEffect(() => {
    const previous = shown.current;
    shown.current = range;
    if (dragging) return;
    const moved =
      range.start !== previous.start
        ? range.start
        : range.end !== previous.end
          ? range.end
          : undefined;
    if (moved === undefined) return;
    content()
      ?.querySelector(`[data-shot-id="${CSS.escape(ids[moved])}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [box]);

  function startDrag(edge: "start" | "end", event: React.PointerEvent) {
    const parent = content();
    const viewport = parent?.closest<HTMLElement>(
      '[data-slot="message-scroller-viewport"], [data-slot="scroll-area-viewport"]',
    );
    if (!parent || !viewport) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    setDragging(true);

    const bounds = measure(parent, ids);
    let pointerY = event.clientY;
    let current = range;
    let frameRequest = 0;

    const update = () => {
      const y = pointerY - parent.getBoundingClientRect().top;
      const next = dragEdge(current, edge, y, bounds);
      if (next.start !== current.start || next.end !== current.end) {
        current = next;
        onChange(next);
      }
    };
    // Past the viewport's edge the transcript scrolls under the finger.
    const scroll = () => {
      const { top, bottom } = viewport.getBoundingClientRect();
      const step =
        pointerY < top + SCROLL_ZONE_PX
          ? -SCROLL_STEP_PX
          : pointerY > bottom - SCROLL_ZONE_PX
            ? SCROLL_STEP_PX
            : 0;
      if (step) {
        viewport.scrollBy({ top: step });
        update();
      }
      frameRequest = requestAnimationFrame(scroll);
    };
    frameRequest = requestAnimationFrame(scroll);

    const move = (moveEvent: PointerEvent) => {
      pointerY = moveEvent.clientY;
      update();
    };
    const end = () => {
      cancelAnimationFrame(frameRequest);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      setDragging(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function nudge(edge: "start" | "end", event: React.KeyboardEvent) {
    const step =
      event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    onChange(nudgeEdge(range, edge, step, ids.length));
  }

  return (
    <>
      {box?.gaps.map((gap) => (
        <div
          key={gap.key}
          style={{
            top: gap.top,
            height: gap.bottom - gap.top,
            borderTopLeftRadius: gap.atStart ? RADIUS_PX : 0,
            borderTopRightRadius: gap.atStart ? RADIUS_PX : 0,
            borderBottomLeftRadius: gap.atEnd ? RADIUS_PX : 0,
            borderBottomRightRadius: gap.atEnd ? RADIUS_PX : 0,
            // The outside's dim, struck through: left out reads without
            // relying on how dark it is.
            backgroundColor: DIM,
            backgroundImage: HATCH,
          }}
          className="pointer-events-none absolute inset-x-2 z-10"
        />
      ))}
      <div
        ref={frame}
        aria-hidden={!box}
        style={{
          ...(box ? { top: box.top, height: box.height } : {}),
          borderRadius: RADIUS_PX,
          // The dim is the frame's own shadow, so it can't catch clicks: the
          // messages under it stay pickable.
          boxShadow: `0 0 0 200vmax ${DIM}`,
        }}
        className={cx(
          "pointer-events-none absolute inset-x-2 z-10",
          "outline-[1.5px] outline-ui-primary outline-solid",
          !box && "invisible",
        )}
      >
        {(["start", "end"] as const).map((edge) => (
          <Corners key={edge} edge={edge} />
        ))}
        {(["start", "end"] as const).map((edge) => (
          <button
            type="button"
            key={edge}
            data-edge={edge}
            aria-label={
              edge === "start"
                ? "Top of the screenshot. Arrow keys move it a message."
                : "Bottom of the screenshot. Arrow keys move it a message."
            }
            onPointerDown={(event) => startDrag(edge, event)}
            onKeyDown={(event) => nudge(edge, event)}
            className={cx(
              "pointer-events-auto absolute start-1/2 grid h-6 w-16 -translate-x-1/2 cursor-ns-resize touch-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-primary rtl:translate-x-1/2",
              edge === "start" ? "-top-3" : "-bottom-3",
            )}
          >
            <span className="h-1.5 w-10 rounded-full bg-ui-primary shadow-ui ring-2 ring-ui-surface" />
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * The crop marks on a pair of corners: what reads as "this is the picture".
 * Each sits just outside the frame, so its inner curve is the frame's own
 * radius and its outer curve wider by its thickness. The box is bigger than
 * that, or the browser would shrink the curve to fit and they wouldn't meet.
 */
function Corners({ edge }: { edge: "start" | "end" }) {
  const size = RADIUS_PX + MARK_PX + 8;
  const curve = RADIUS_PX + MARK_PX;
  const top = edge === "start";
  const mark = {
    width: size,
    height: size,
    borderTopWidth: top ? MARK_PX : 0,
    borderBottomWidth: top ? 0 : MARK_PX,
    ...(top ? { top: -MARK_PX } : { bottom: -MARK_PX }),
  };
  return (
    <>
      <span
        style={{
          ...mark,
          left: -MARK_PX,
          borderLeftWidth: MARK_PX,
          borderRightWidth: 0,
          ...(top
            ? { borderTopLeftRadius: curve }
            : { borderBottomLeftRadius: curve }),
        }}
        className="absolute border-solid border-ui-primary"
      />
      <span
        style={{
          ...mark,
          right: -MARK_PX,
          borderLeftWidth: 0,
          borderRightWidth: MARK_PX,
          ...(top
            ? { borderTopRightRadius: curve }
            : { borderBottomRightRadius: curve }),
        }}
        className="absolute border-solid border-ui-primary"
      />
    </>
  );
}

/**
 * "Select up to here" at the top and foot of the screen, like a phone's chat
 * app: each takes the selection to the last message showing at that end, and
 * hides once the selection already reaches it. Fixed over the transcript, so it
 * follows scrolling rather than the messages.
 */
export function ScreenshotReach({
  ids,
  range,
  onChange,
}: {
  ids: readonly string[];
  range: ShotRange;
  onChange: (range: ShotRange) => void;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState<ShotRange | undefined>();

  useEffect(() => {
    const viewport = anchor.current?.parentElement?.querySelector<HTMLElement>(
      '[data-slot="message-scroller-viewport"], [data-slot="scroll-area-viewport"]',
    );
    if (!viewport) return;
    const index = new Map(ids.map((id, at) => [id, at]));
    let request = 0;
    const look = () => {
      cancelAnimationFrame(request);
      request = requestAnimationFrame(() => {
        const { top, bottom } = viewport.getBoundingClientRect();
        // One pass over the rows, in transcript order, as the ids are.
        const rows = Array.from(
          viewport.querySelectorAll<HTMLElement>("[data-shot-id]"),
        );
        const ends = visibleEnds(
          rows.map((row) => row.getBoundingClientRect()),
          top,
          bottom - BAR_CLEARANCE_PX,
        );
        const at = (row: HTMLElement | undefined) =>
          row ? (index.get(row.dataset.shotId ?? "") ?? -1) : -1;
        const start = at(ends && rows[ends.start]);
        const end = at(ends && rows[ends.end]);
        setOnScreen(start !== -1 && end !== -1 ? { start, end } : undefined);
      });
    };
    look();
    viewport.addEventListener("scroll", look, { passive: true });
    const observer = new ResizeObserver(look);
    observer.observe(viewport);
    return () => {
      cancelAnimationFrame(request);
      viewport.removeEventListener("scroll", look);
      observer.disconnect();
    };
  }, [ids]);

  const up =
    onScreen && onScreen.start < range.start ? onScreen.start : undefined;
  const down = onScreen && onScreen.end > range.end ? onScreen.end : undefined;
  const reach =
    "absolute start-1/2 z-20 -translate-x-1/2 shadow-ui motion-safe:animate-ui-fade-in rtl:translate-x-1/2";

  return (
    <div ref={anchor} className="contents">
      {up !== undefined ? (
        <Button
          size="sm"
          icon={<ArrowUpToLineIcon aria-hidden />}
          onClick={() => onChange({ start: up, end: range.end })}
          className={cx(reach, "top-3")}
        >
          Select up to here
        </Button>
      ) : null}
      {down !== undefined ? (
        <Button
          size="sm"
          icon={<ArrowDownToLineIcon aria-hidden />}
          onClick={() => onChange({ start: range.start, end: down })}
          className={cx(reach, "bottom-22")}
        >
          Select up to here
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Floats over the transcript's foot while choosing: how much is in, how to
 * change it, and the way out either side.
 */
export function ScreenshotBar({
  count,
  onCancel,
  onCreate,
}: {
  /** Messages that go in: the frame's, less those left out. */
  count: number;
  onCancel: () => void;
  onCreate: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Screenshot"
      className="absolute inset-x-3 bottom-4 z-20 mx-auto flex max-w-md items-center gap-2 rounded-full ui-raised py-1.5 ps-5 pe-1.5 motion-safe:animate-ui-enter"
    >
      <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
        <span className="text-sm font-bold tabular-nums">
          {count === 1 ? "1 message" : `${count} messages`}
        </span>
        <span className="text-xs leading-tight text-ui-soft">
          <span className="pointer-coarse:hidden">Click to add or remove</span>
          <span className="pointer-fine:hidden">Tap to add or remove</span>
        </span>
      </div>
      <Button tone="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button tone="primary" onClick={onCreate} disabled={count === 0}>
        Create image
      </Button>
    </div>
  );
}
