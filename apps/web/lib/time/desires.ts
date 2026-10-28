import type {
  DesireDefinition,
  DesireEffect,
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
    if (trendOf(config, record, desire, at)?.direction === "up") continue;
    const when = dropAt(config, record, desire, at);
    if (when === undefined || (soonest && soonest.at <= when)) continue;
    const index = stateIndex(config, levelAt(config, record, desire, at));
    soonest = {
      desire: desire.name,
      state: config.states[index - 1]?.name ?? "",
      at: when,
    };
  }
  return soonest;
}

/**
 * Re-anchors at `at` and moves each named desire toward its target state by
 * `until`, like the plugin's `startEffects`. A target equal to the current
 * state means no change. Used by the mock world only.
 */
export function startEffects(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  task: { readonly id: string; readonly at: number; readonly until: number },
  targets: Readonly<Record<string, string>>,
): DesireRecord {
  const anchorAt = Math.max(task.at, record?.anchorAt ?? task.at);
  const levels = levelsAt(config, record, anchorAt);
  const hours = Math.max(task.until - anchorAt, 1) / HOUR;
  const byDesire: Record<string, DesireEffect> = {};
  for (const [name, state] of Object.entries(targets)) {
    const target = levelOfState(config, state);
    const start = levels[name];
    if (target === undefined || start === undefined) continue;
    if (stateOf(config, start) === state) continue;
    byDesire[name] = { target, rate: Math.abs(target - start) / hours };
  }
  const base = { anchorAt, levels, drain: record?.drain ?? {} };
  return Object.keys(byDesire).length
    ? { ...base, effects: { taskId: task.id, until: task.until, byDesire } }
    : base;
}

/** `stimulation` → `Stimulation`, `inner_peace` → `Inner peace`. */
export function desireLabel(name: string) {
  const spaced = name.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
