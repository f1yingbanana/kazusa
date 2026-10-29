import type { StateStore } from "../state.ts";
import type { DesiresConfig } from "./config.ts";

const HOUR_MS = 3_600_000;

/** A task's pull on one desire: move toward `target`, then hold there. */
export interface DesireEffect {
  readonly target: number;
  /** Points per simulated hour, always non-negative. */
  readonly rate: number;
}

/** One character's desires, exact at `anchorAt`. */
export interface DesireRecord {
  /** Sim time (epoch ms) at which `levels` were computed exactly. */
  readonly anchorAt: number;
  /** Levels 0..100 at `anchorAt`, keyed by catalog desire name. */
  readonly levels: Readonly<Record<string, number>>;
  /** The current task's effects; each applies from anchorAt until `until`. */
  readonly effects?: {
    readonly taskId: string;
    readonly until: number;
    readonly byDesire: Readonly<Record<string, DesireEffect>>;
  };
  /** Sparse per-character drain overrides (points/hour), keyed by name. */
  readonly drain: Readonly<Record<string, number>>;
}

export type DesireStore = StateStore<DesireRecord>;

const clamp = (level: number): number => Math.min(100, Math.max(0, level));

/** The state a level falls in. */
export function stateOf(config: DesiresConfig, level: number): string {
  return config.states.reduce(
    (found, state) => (level >= state.min ? state.name : found),
    config.states[0]?.name ?? "",
  );
}

/** The level a task targeting this state settles at. */
export function levelOf(
  config: DesiresConfig,
  state: string,
): number | undefined {
  return config.states.find(({ name }) => name === state)?.level;
}

/** A character's drain rates, overrides first. */
export function drainRates(
  config: DesiresConfig,
  record: DesireRecord | undefined,
): Record<string, number> {
  return Object.fromEntries(
    config.catalog.map(({ name, drain }) => [
      name,
      record?.drain[name] ?? drain,
    ]),
  );
}

/** Exact levels of every catalog desire at `at` (not before the anchor). */
export function levelsAt(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  at: number,
): Record<string, number> {
  const initial = levelOf(config, config.initial) ?? 0;
  const levels: Record<string, number> = {};
  for (const { name, drain } of config.catalog) {
    const start = record?.levels[name] ?? initial;
    if (!record) {
      levels[name] = start;
      continue;
    }
    const now = Math.max(at, record.anchorAt);
    const effects = record.effects;
    const effect = effects?.byDesire[name];
    // An effect covers [anchorAt, until]; drain covers whatever remains.
    const effectEnd =
      effects && effect
        ? Math.min(now, Math.max(record.anchorAt, effects.until))
        : record.anchorAt;
    let level = start;
    if (effect) {
      const step = (effect.rate * (effectEnd - record.anchorAt)) / HOUR_MS;
      level =
        effect.target >= start
          ? Math.min(effect.target, start + step)
          : Math.max(effect.target, start - step);
    }
    const rate = record.drain[name] ?? drain;
    levels[name] = clamp(level - (rate * (now - effectEnd)) / HOUR_MS);
  }
  return levels;
}

/** Re-anchor at `at`, keeping effects and dropping names not in the catalog. */
export function anchorAt(
  config: DesiresConfig,
  record: DesireRecord | undefined,
  at: number,
): DesireRecord {
  const names = new Set(config.catalog.map(({ name }) => name));
  const drain = Object.fromEntries(
    Object.entries(record?.drain ?? {}).filter(([name]) => names.has(name)),
  );
  const effects = record?.effects && {
    ...record.effects,
    byDesire: Object.fromEntries(
      Object.entries(record.effects.byDesire).filter(([name]) =>
        names.has(name),
      ),
    ),
  };
  return {
    anchorAt: Math.max(at, record?.anchorAt ?? at),
    levels: levelsAt(config, record, at),
    ...(effects ? { effects } : {}),
    drain,
  };
}

/**
 * Time that passed while the character was offstage never reached their body:
 * levels resume from where they were at `from`, anchored at `to`, and the
 * current task's effects keep the rest of their span.
 */
export function resumeAfter(
  config: DesiresConfig,
  record: DesireRecord,
  from: number,
  to: number,
): DesireRecord {
  const pausedAt = Math.max(from, record.anchorAt);
  const gap = to - pausedAt;
  if (gap <= 0) return record;
  const held = anchorAt(config, record, pausedAt);
  return {
    ...held,
    anchorAt: to,
    ...(held.effects
      ? { effects: { ...held.effects, until: held.effects.until + gap } }
      : {}),
  };
}

/**
 * Replace the effects of a record anchored now: each named desire moves toward
 * its state's level, arriving at the lease's `until`. Naming a desire's current
 * state means no change, so restating how you feel never props a desire up.
 */
export function startEffects(
  config: DesiresConfig,
  record: DesireRecord,
  task: { readonly id: string; readonly until: number },
  effects: Readonly<Partial<Record<string, string>>>,
): DesireRecord {
  const hours = Math.max(task.until - record.anchorAt, 1) / HOUR_MS;
  const byDesire: Record<string, DesireEffect> = {};
  for (const [name, state] of Object.entries(effects)) {
    const target = state === undefined ? undefined : levelOf(config, state);
    const start = record.levels[name];
    if (target === undefined || start === undefined) continue;
    if (stateOf(config, start) === state) continue;
    byDesire[name] = { target, rate: Math.abs(target - start) / hours };
  }
  const rest = {
    anchorAt: record.anchorAt,
    levels: record.levels,
    drain: record.drain,
  };
  return Object.keys(byDesire).length
    ? { ...rest, effects: { taskId: task.id, until: task.until, byDesire } }
    : rest;
}

/** The one-line state summary the brain reads. */
export function feelingsLine(
  config: DesiresConfig,
  levels: Readonly<Record<string, number>>,
): string {
  return config.catalog
    .map(({ name }) => `${name}: ${stateOf(config, levels[name] ?? 0)}`)
    .join(" · ");
}

const ARROW = "→";

/**
 * Every `current→afterwards` value. Asking for the transition makes the model
 * compare against how it feels now. An unchanged one (`fine→fine`) is accepted
 * and means no change: rejecting it only cost the model a retry, live.
 */
export function transitions(config: DesiresConfig): string[] {
  const states = config.states.map(({ name }) => name);
  return states.flatMap((from) => states.map((to) => `${from}${ARROW}${to}`));
}

/** The afterwards state of a `current→afterwards` value. */
export function targetOf(transition: string): string {
  return transition.slice(transition.indexOf(ARROW) + ARROW.length);
}

/** Whether a `current→afterwards` value names no change. */
export function isUnchanged(transition: string): boolean {
  return (
    transition.slice(0, transition.indexOf(ARROW)) === targetOf(transition)
  );
}

/** The task tools' `afterwards` parameter, generated from the catalog. */
export function afterwardsParameter(
  config: DesiresConfig,
): Record<string, unknown> {
  // No per-desire properties: models fill every listed property like a form,
  // so the desires are named once in prose and only values are constrained.
  const desires = config.catalog
    .map(({ name, description }) => `${name}: ${description}`)
    .join("\n");
  return {
    type: "object",
    description: `Only the desires this activity changes, each as current${ARROW}afterwards state, e.g. a night's sleep: { "energy": "low${ARROW}full" }. Desires:\n${desires}`,
    propertyNames: { enum: config.catalog.map(({ name }) => name) },
    additionalProperties: { type: "string", enum: transitions(config) },
  };
}

/** `delay_task`'s copy, pointing at `start_task` instead of repeating it. */
export function delayAfterwardsParameter(
  config: DesiresConfig,
): Record<string, unknown> {
  return {
    type: "object",
    description:
      "As in start_task: only the desires the extended activity changes, as current→afterwards state.",
    additionalProperties: { type: "string", enum: transitions(config) },
  };
}
