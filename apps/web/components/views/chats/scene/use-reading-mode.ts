"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useClockActions } from "@/hooks/use-clock";
import { useClockStore } from "@/lib/live/clock-state";
import {
  applySceneEvent,
  useSceneBehind,
  useSceneOpen,
  useSceneStore,
} from "@/lib/live/scene-state";
import { useLiveStore } from "@/lib/live/state";
import { sayingOnScreen } from "@/lib/scene/director";
import {
  READING_OFF,
  stepReadingClock,
  type ReadingClockEvent,
} from "@/lib/scene/reading";
import { executeClockAction } from "@/lib/source/clock/http";

/**
 * How long a speed it set may still come back as the clock's news: a pause and
 * the resume right after it (a quick advance) can arrive in either order, and
 * the late one is not someone else changing the speed.
 */
const ECHO_WINDOW_MS = 3_000;

/** The clock as reading mode sees it: its speed, and a way to set it. */
export interface ReadingClockSource {
  /** Sim speed now; `undefined` until the clock is known. */
  readonly speed: number | undefined;
  /** `leaving`: the page is going away; the call must outlive it. */
  readonly setSpeed: (speed: number, leaving?: boolean) => void;
}

/**
 * Reading mode's clock (`stepReadingClock`) bound to a clock: while `on`, it
 * follows the lines `waiting`, and lets go when someone else sets the speed
 * (`onTakenBack`). Turned off, unmounted or the page left, it puts back the
 * speed it found.
 */
export function useReadingClock({
  on,
  waiting,
  clock,
  onTakenBack,
}: {
  on: boolean;
  waiting: number;
  clock: ReadingClockSource;
  onTakenBack: () => void;
}): { readonly send: () => () => void } {
  const machine = useRef(READING_OFF);
  const latest = useRef({ waiting, clock, onTakenBack });
  useEffect(() => {
    latest.current = { waiting, clock, onTakenBack };
  });
  const asked = useRef<{ speed: number; at: number }[]>([]);
  const step = useCallback((event: ReadingClockEvent, leaving = false) => {
    const next = stepReadingClock(machine.current, event);
    machine.current = next.state;
    if (next.set !== undefined) {
      const now = Date.now();
      asked.current = [
        ...asked.current.filter((item) => now - item.at < ECHO_WINDOW_MS),
        { speed: next.set, at: now },
      ];
      latest.current.clock.setSpeed(next.set, leaving);
    }
    if (next.takenBack) latest.current.onTakenBack();
  }, []);
  const found = useEffectEvent(() => ({
    speed: clock.speed,
    waiting: latest.current.waiting,
  }));

  useEffect(() => {
    if (!on) return;
    step({ type: "enter", ...found() });
    const leave = () => step({ type: "leave" }, true);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      step({ type: "leave" });
    };
  }, [on, step]);

  useEffect(() => {
    if (on) step({ type: "waiting", waiting });
  }, [on, waiting, step]);

  // A speed it did not set (and did not just set) is the clock taken back.
  const last = useRef(clock.speed);
  useEffect(() => {
    const before = last.current;
    last.current = clock.speed;
    if (!on || clock.speed === before) return;
    const now = Date.now();
    const ours = asked.current.some(
      (item) => item.speed === clock.speed && now - item.at < ECHO_WINDOW_MS,
    );
    if (!ours) step({ type: "speed", speed: clock.speed });
  }, [on, clock.speed, step]);

  const send = useCallback(() => {
    step({ type: "send" });
    let done = false;
    return () => {
      if (done) return;
      done = true;
      step({ type: "sent", waiting: latest.current.waiting });
    };
  }, [step]);
  return { send };
}

const NOBODY: readonly string[] = [];

/** What the people here are doing, for reading mode's status. */
export interface HuddleActivity {
  /** Someone saying a line, or composing one, here. */
  readonly speaking?: string;
  /** Someone thinking. */
  readonly thinking?: string;
}

/**
 * Who in this huddle is speaking (a speaking event, or composing in this chat,
 * as the header's faces say "Speaking") or thinking (as the presence ring
 * says), from the live stores; the first of each, by member order. Someone
 * whose line is already on screen is not speaking: the reader has it, and what
 * they wait for is what comes after.
 */
export function useHuddleActivity(
  chatId: string,
  members: readonly string[],
): HuddleActivity {
  const shown = useSceneStore(
    useShallow((state) => {
      const scene = state.scenes[chatId];
      return scene ? sayingOnScreen(scene) : NOBODY;
    }),
  );
  const speaker = useSceneStore((state) =>
    state.scenes[chatId]?.speakers.find((id) => !shown.includes(id)),
  );
  const [composing, thinking] = useLiveStore(
    useShallow((state) => {
      let composer: string | undefined;
      let thinker: string | undefined;
      for (const id of members) {
        const status = state.statuses.get(id);
        if (!status) continue;
        if (
          composer === undefined &&
          status.composingIn.includes(chatId) &&
          !shown.includes(id)
        )
          composer = id;
        if (thinker === undefined && status.brain === "thinking") thinker = id;
      }
      return [composer, thinker] as const;
    }),
  );
  const speaking = speaker ?? composing;
  return {
    ...(speaking !== undefined ? { speaking } : {}),
    ...(thinking !== undefined ? { thinking } : {}),
  };
}

/** What the panel's corner says in reading mode. */
export type ReadingStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "speaking"; readonly id: string }
  | { readonly kind: "thinking"; readonly id: string }
  | { readonly kind: "waiting" }
  | { readonly kind: "none" };

/**
 * A line ready: the caret. Asked for with nothing ready: who is speaking or
 * thinking, else only that the reader is waiting (nothing says a line is
 * coming). Otherwise nothing.
 */
export function readingStatus(
  waiting: number,
  wanted: boolean,
  activity: HuddleActivity,
): ReadingStatus {
  if (waiting > 0) return { kind: "ready" };
  if (!wanted) return { kind: "none" };
  if (activity.speaking) return { kind: "speaking", id: activity.speaking };
  if (activity.thinking) return { kind: "thinking", id: activity.thinking };
  return { kind: "waiting" };
}

export interface ReadingMode {
  /** Offered: the viewer may control the clock and the scene shows. */
  readonly available: boolean;
  readonly on: boolean;
  readonly toggle: () => void;
  /** Show the next waiting line, or the next to arrive. */
  readonly advance: () => void;
  /** Whether an advance would do anything now (the pointer says so). */
  readonly canAdvance: boolean;
  /** Before sending: shows what waited; call the result once it is sent. */
  readonly beforeSend: () => () => void;
  readonly status: ReadingStatus;
}

/**
 * Reading mode for a huddle's scene, a view state (never persisted, never in
 * the link, so opening a chat never pauses the world): new lines wait for the
 * reader (the director's `reading`), and the world runs only while nothing
 * waits (`useReadingClock`). Offered only to a viewer who may control the
 * clock; it ends, showing everything that waited and putting back the speed it
 * found, when turned off, when `allowed` turns false (the transcript, an ended
 * huddle) and when the view or the page goes; when someone else sets the speed
 * it ends without putting it back.
 */
export function useReadingMode(
  chatId: string,
  allowed: boolean,
  members: readonly string[],
): ReadingMode {
  const { apply, enabled } = useClockActions();
  const available = allowed && enabled;
  const [wantedOn, setWantedOn] = useState(false);
  const on = wantedOn && available;
  if (wantedOn && !available) setWantedOn(false);

  // The scene follows: lines wait while on, and all show when it ends.
  const open = useSceneOpen(chatId);
  useEffect(() => {
    if (open) applySceneEvent(chatId, { type: "reading", on, at: Date.now() });
  }, [chatId, open, on]);

  const waiting = useSceneBehind(chatId);
  const wanted = useSceneStore(
    (state) => state.scenes[chatId]?.wanted ?? false,
  );
  const activity = useHuddleActivity(chatId, members);
  const speed = useClockStore((state) => state.clock?.clock.speed);
  const { send } = useReadingClock({
    on,
    waiting,
    clock: {
      speed,
      setSpeed: (next, leaving) =>
        leaving
          ? void executeClockAction(
              { action: "set_speed", speed: next },
              { keepalive: true },
            ).catch(() => {})
          : void apply({ action: "set_speed", speed: next }),
    },
    onTakenBack: () => setWantedOn(false),
  });

  const toggle = useCallback(() => setWantedOn((current) => !current), []);
  const advance = useCallback(
    () => applySceneEvent(chatId, { type: "show-next", at: Date.now() }),
    [chatId],
  );
  const beforeSend = useCallback(() => {
    if (!on) return () => {};
    const sent = send();
    applySceneEvent(chatId, { type: "jump", at: Date.now() });
    return sent;
  }, [chatId, on, send]);
  return {
    available,
    on,
    toggle,
    advance,
    canAdvance: on && !(wanted && waiting === 0),
    beforeSend,
    status: readingStatus(waiting, wanted, activity),
  };
}
