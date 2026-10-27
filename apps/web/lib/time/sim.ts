import type { ClockState } from "@kazusa/client";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * Interpolates sim time at a wall-clock instant. `offset` is
 * `serverNow - Date.now()` measured when the anchor arrived, so a skewed
 * browser clock doesn't drift the simulation display.
 */
export function simTimeAt(clock: ClockState, wallNow: number, offset = 0) {
  if (clock.speed === 0) return clock.simTime;
  const elapsed = Math.max(0, wallNow + offset - clock.updatedAt);
  return clock.simTime + Math.round(elapsed * clock.speed);
}

/** Floors to a resolution bucket so subscribers only re-render on change. */
export function bucket(time: number, resolution: number) {
  return Math.floor(time / resolution) * resolution;
}

export type DayPhase = "Night" | "Morning" | "Afternoon" | "Evening";

export function dayPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 12) return "Morning";
  if (hour >= 12 && hour < 17) return "Afternoon";
  if (hour >= 17 && hour < 22) return "Evening";
  return "Night";
}

const pad = (value: number) => String(value).padStart(2, "0");

/*
 * Sim time is a story wall clock, so it is shown in UTC (matching the
 * plugin's `ClockSnapshot.formatted`) regardless of the viewer's timezone.
 * "Day N" needs a world start time that the backend doesn't expose yet.
 */
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const longDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export function formatSimTime(time: number) {
  const date = new Date(time);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function formatSimDate(time: number) {
  return dateFormatter.format(time);
}

export function formatSimDateLong(time: number) {
  return longDateFormatter.format(time);
}

export function simPhase(time: number) {
  return dayPhase(new Date(time).getUTCHours());
}

export function simDayStart(time: number) {
  return bucket(time, DAY);
}

/** `34m`, `1h 20m`, `2d 3h`. Sim minutes, rounded down. */
export function formatSimDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / MINUTE));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h` : `${days}d`;
}

/** Fraction of a task elapsed at `now`, clamped to [0, 1]. */
export function progress(startedAt: number, endAt: number, now: number) {
  if (endAt <= startedAt) return 1;
  return Math.min(1, Math.max(0, (now - startedAt) / (endAt - startedAt)));
}

export function formatSpeed(speed: number) {
  if (speed === 0) return "Paused";
  return `${Number.isInteger(speed) ? speed : speed.toFixed(1)}×`;
}
