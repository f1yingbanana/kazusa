import type {
  BackdropFile,
  BackdropSet,
  Portrait,
  PortraitsResponse,
  TimeOfDay,
} from "@kazusa/client";
import type { Look } from "./state";

const DAY_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;
/** The mood a figure shows when it shows none in particular. */
export const NEUTRAL_MOOD = "neutral";

function minutesOf(from: string): number {
  const [hours = 0, minutes = 0] = from.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * The world's times of day from now backwards, wrapping round the day: the
 * current one first. Sim time is UTC.
 */
export function timesBack(
  times: readonly TimeOfDay[],
  simTimeMs: number,
): TimeOfDay[] {
  const sorted = [...times].sort(
    (a, b) => minutesOf(a.from) - minutesOf(b.from),
  );
  const minute =
    ((Math.floor(simTimeMs / MINUTE_MS) % DAY_MINUTES) + DAY_MINUTES) %
    DAY_MINUTES;
  // Before the first time of the day, the last one is still running.
  let current = sorted.length - 1;
  for (let index = 0; index < sorted.length; index++)
    if (minutesOf(sorted[index].from) <= minute) current = index;
  return sorted.map(
    (_, step) => sorted[(current - step + sorted.length) % sorted.length],
  );
}

/**
 * The picture of a backdrop set for a sim time: the file for the current time
 * of day, else the nearest earlier time the set has, wrapping round the day.
 * With a `state`, that state's pictures first, then the stateless ones. A set
 * with one picture shows it at every hour.
 */
export function pickBackdrop(
  set: BackdropSet,
  times: readonly TimeOfDay[],
  simTimeMs: number,
  state?: string,
): BackdropFile | undefined {
  if (set.files.length <= 1) return set.files[0];
  const order = timesBack(times, simTimeMs);
  const stateless = set.files.filter((file) => file.state === undefined);
  const groups =
    state === undefined
      ? [stateless]
      : [set.files.filter((file) => file.state === state), stateless];
  for (const files of groups) {
    for (const time of order) {
      const file = files.find((candidate) => candidate.time === time.name);
      if (file) return file;
    }
  }
  // Named for times the world doesn't have, or only for other states: still
  // better than nothing.
  return stateless[0] ?? set.files[0];
}

/**
 * The portrait for a look (§6.3 "Resolving it"): `<outfit>-<mood>`; an outfit
 * without that mood keeps the outfit and shows its neutral face, else its
 * first. Without an outfit (or one the set lacks): `<mood>`, else the set's
 * default.
 */
export function pickPortrait(
  set: PortraitsResponse,
  look: Look,
): Portrait | undefined {
  const mood = look.mood ?? NEUTRAL_MOOD;
  if (look.outfit !== undefined) {
    const outfit = set.portraits.filter(
      (portrait) => portrait.outfit === look.outfit,
    );
    const found =
      outfit.find((portrait) => portrait.mood === mood) ??
      outfit.find((portrait) => portrait.mood === NEUTRAL_MOOD) ??
      outfit[0];
    if (found) return found;
  }
  return (
    set.portraits.find(
      (portrait) => portrait.outfit === undefined && portrait.mood === mood,
    ) ??
    set.portraits.find((portrait) => portrait.name === set.default) ??
    set.portraits[0]
  );
}
