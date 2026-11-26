import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import { DAY, HOUR, MINUTE } from "@/lib/time/sim";

export const SPEEDS = [1, 2, 5, 10, 60] as const;

/** What a speed means in real time, said the way a player thinks of it. */
export function speedLine(speed: number): string {
  if (speed <= 0) return "Time stands still. Nobody thinks or moves.";
  if (speed === 1) return "Real time: an hour here takes an hour.";
  const minutes = 60 / speed;
  return `An hour here takes ${
    minutes >= 1
      ? `${Math.round(minutes)} ${Math.round(minutes) === 1 ? "minute" : "minutes"}`
      : `${Math.round(minutes * 60)} seconds`
  }.`;
}

/**
 * Characters think in real time whatever the speed, so above a point a turn's
 * thinking eats a noticeable part of their day.
 */
export function speedCaution(speed: number): string | null {
  if (speed < 10) return null;
  const minutes = Math.round((30 * speed) / 60);
  return `Characters still think in real time, so half a minute of thinking costs them ${
    minutes >= 60
      ? `${minutes / 60 === 1 ? "an hour" : `${minutes / 60} hours`}`
      : `${minutes} minutes`
  } of their day. Replies and meetups land later than they meant.`;
}

export type Skip =
  | { readonly by: "minutes"; readonly minutes: number }
  | { readonly by: "time"; readonly time: string }
  | { readonly by: "next" };

export const SKIP_PRESETS = [
  { minutes: 10, label: "10 min" },
  { minutes: 60, label: "1 h" },
  // A night's sleep.
  { minutes: 360, label: "6 h" },
  { minutes: 1440, label: "24 h" },
] as const;

export interface Waker {
  readonly id: string;
  readonly name: string;
  /** The kind of thing they're doing, like "studying". */
  readonly type: string;
  readonly endAt: number;
}

/**
 * Whose plan ends, and so who wakes to decide what's next, if the clock jumps
 * from `from` to `to`: onstage characters thinking for themselves (not played
 * by someone), soonest first.
 */
export function wakersBetween(
  cast: readonly CharacterSummary[],
  statuses: ReadonlyMap<string, CharacterStatus>,
  from: number,
  to: number,
): Waker[] {
  return cast
    .flatMap((character) => {
      const status = statuses.get(character.id);
      const task = status?.task;
      if (!status?.onstage || status.playedBy || !task) return [];
      if (task.endAt <= from || task.endAt > to) return [];
      return [
        {
          id: character.id,
          name: character.name,
          type: task.type,
          endAt: task.endAt,
        },
      ];
    })
    .sort((a, b) => a.endAt - b.endAt);
}

/** The next moment someone's plan ends, after `now`. */
export function nextEvent(
  cast: readonly CharacterSummary[],
  statuses: ReadonlyMap<string, CharacterStatus>,
  now: number,
): Waker | undefined {
  return wakersBetween(cast, statuses, now, Number.POSITIVE_INFINITY)[0];
}

/**
 * When a skip lands, in sim time: a duration from now, the next time of day
 * (tomorrow if it's already past), or just after the next plan ends.
 */
export function landingOf(
  skip: Skip,
  now: number,
  next: Waker | undefined,
): number | undefined {
  if (skip.by === "minutes") return now + skip.minutes * MINUTE;
  if (skip.by === "next") return next ? next.endAt + MINUTE : undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(skip.time);
  if (!match) return undefined;
  const dayStart = now - (now % DAY);
  let at = dayStart + Number(match[1]) * HOUR + Number(match[2]) * MINUTE;
  if (at <= now) at += DAY;
  return at;
}

/** Whole minutes to advance the clock by to land at `at`; 0 for none. */
export function minutesTo(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / MINUTE));
}

/** Short, like "2 h 30 min" or "45 min". */
export function formatSkip(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest
    ? `${hours} h ${rest} min`
    : `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** A skip big enough to stop and explain first. */
export function isLargeSkip(minutes: number, wakers: number): boolean {
  return minutes >= 180 || wakers >= 5;
}
