import type {
  DesireDefinition,
  DesireRecord,
  DesiresConfig,
} from "@kazusa/client";
import { HOUR } from "./sim";

/*
 * Client copy of the plugin's closed form (`src/desires/desires.ts`). Levels
 * are a pure function of the record and sim time, so rows recompute from
 * `useSimNow()` instead of polling. Keep the two in step; the colocated tests
 * repeat the plugin's cases.
 */

const clamp = (level: number) => Math.min(100, Math.max(0, level));

export function stateIndex(config: DesiresConfig, level: number): number {
  let found = 0;
  config.states.forEach((state, index) => {
    if (level >= state.min) found = index;
  });
  return found;
}

export function stateOf(config: DesiresConfig, level: number): string {
  return config.states[stateIndex(config, level)]?.name ?? "";
}

function levelOfState(config: DesiresConfig, state: string) {
  return config.states.find(({ name }) => name === state)?.level;
}

/** Exact level of one desire at `at` (never before the anchor). */
export function levelAt(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  desire: DesireDefinition,
  at: number,
): number {
  const start =
    record?.levels[desire.name] ?? levelOfState(config, config.initial) ?? 0;
  if (!record) return start;
  const now = Math.max(at, record.anchorAt);
  const effect = record.effects?.byDesire[desire.name];
  const effectEnd =
    record.effects && effect
      ? Math.min(now, Math.max(record.anchorAt, record.effects.until))
      : record.anchorAt;
  let level = start;
  if (effect) {
    const step = (effect.rate * (effectEnd - record.anchorAt)) / HOUR;
    level =
      effect.target >= start
        ? Math.min(effect.target, start + step)
        : Math.max(effect.target, start - step);
  }
  const drain = record.drain[desire.name] ?? desire.drain;
  return clamp(level - (drain * (now - effectEnd)) / HOUR);
}

export function levelsAt(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  at: number,
): Record<string, number> {
  return Object.fromEntries(
    config.catalog.map((desire) => [
      desire.name,
      levelAt(config, record, desire, at),
    ]),
  );
}

/** Where the current task is still moving a desire, and when it gets there. */
export interface DesireTrend {
  readonly direction: "up" | "down";
  readonly targetState: string;
  readonly target: number;
  readonly reachesAt: number;
}

export function trendOf(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  desire: DesireDefinition,
  at: number,
): DesireTrend | undefined {
  const effects = record?.effects;
  const effect = effects?.byDesire[desire.name];
  if (!record || !effects || !effect || effect.rate <= 0) return undefined;
  if (at >= effects.until) return undefined;
  const level = levelAt(config, record, desire, at);
  if (Math.abs(level - effect.target) < 0.01) return undefined;
  return {
    direction: effect.target > level ? "up" : "down",
    targetState: stateOf(config, effect.target),
    target: effect.target,
    reachesAt: Math.min(
      effects.until,
      at + (Math.abs(effect.target - level) / effect.rate) * HOUR,
    ),
  };
}

/** The next time this desire falls into a lower state, if it ever does. */
function dropAt(
  config: DesiresConfig,
  record: DesireRecord,
  desire: DesireDefinition,
  at: number,
): number | undefined {
  const now = Math.max(at, record.anchorAt);
  const level = levelAt(config, record, desire, now);
  const index = stateIndex(config, level);
  if (index === 0) return undefined;
  const floor = config.states[index].min;
  const effect = record.effects?.byDesire[desire.name];
  const until = record.effects
    ? Math.max(record.anchorAt, record.effects.until)
    : record.anchorAt;

  let cursor = now;
  let current = level;
  if (effect && now < until) {
    if (effect.target < floor && effect.rate > 0 && effect.target < current) {
      const hit = now + ((current - floor) / effect.rate) * HOUR;
      if (hit <= until) return hit;
    }
    cursor = until;
    current = levelAt(config, record, desire, until);
    if (current < floor) return until;
  }
  const drain = record.drain[desire.name] ?? desire.drain;
  if (drain <= 0) return undefined;
  return cursor + ((current - floor) / drain) * HOUR;
}

/**
 * When this desire next falls a state, and into which; `undefined` while the
 * task raises it or it never will.
 */
export function dropOf(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  desire: DesireDefinition,
  at: number,
): DesireDrop | undefined {
  if (!record) return undefined;
  if (trendOf(config, record, desire, at)?.direction === "up") return undefined;
  const when = dropAt(config, record, desire, at);
  if (when === undefined) return undefined;
  const index = stateIndex(config, levelAt(config, record, desire, at));
  return {
    desire: desire.name,
    state: config.states[index - 1]?.name ?? "",
    at: when,
  };
}

/**
 * Worth a row at a glance: below the state everyone starts in (pressure the
 * brain feels), or being moved by the current task (why they're doing it),
 * unless `paused` (offstage), when nothing moves.
 */
export function isNotable(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  desire: DesireDefinition,
  at: number,
  paused = false,
): boolean {
  const initial = Math.max(
    0,
    config.states.findIndex(({ name }) => name === config.initial),
  );
  const index = stateIndex(config, levelAt(config, record, desire, at));
  return (
    index < initial ||
    (!paused && trendOf(config, record, desire, at) !== undefined)
  );
}

export interface DesireDrop {
  readonly desire: string;
  /** The lower state it falls into. */
  readonly state: string;
  readonly at: number;
}

/**
 * The soonest state drop among desires the current task isn't raising: the
 * pressure that will shape what the character does next.
 */
export function nextDrop(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  at: number,
): DesireDrop | undefined {
  if (!record) return undefined;
  let soonest: DesireDrop | undefined;
  for (const desire of config.catalog) {
    const drop = dropOf(config, record, desire, at);
    if (drop && (!soonest || drop.at < soonest.at)) soonest = drop;
  }
  return soonest;
}

/** `stimulation` → `Stimulation`, `inner_peace` → `Inner peace`. */
export function desireLabel(name: string) {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
