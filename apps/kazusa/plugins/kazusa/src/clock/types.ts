import { z } from "zod";

/** Snapshot of the simulation clock at a specific moment. */
export interface ClockSnapshot {
  /** Epoch timestamp in milliseconds. */
  readonly simTime: number;
  /** Simulation speed multiplier (0 indicates stopped/paused). */
  readonly speed: number;
  /** Human-readable UTC timestamp. */
  readonly formatted: string;
}

/** Persisted clock record stored in OpenClaw's keyed plugin state. */
export interface ClockPersistedRecord {
  /** Epoch timestamp in milliseconds. */
  readonly simTime: number;
  /** Simulation speed multiplier. */
  readonly speed: number;
}

/** Minimal persistence boundary used by the clock and its tests. */
export interface ClockStore {
  lookup(key: string): Promise<ClockPersistedRecord | undefined>;
  register(key: string, value: ClockPersistedRecord): Promise<void>;
}

/** Callback invoked when the simulation clock changes. */
export type ClockChangeListener = (
  snapshot: ClockSnapshot,
  previousSnapshot: ClockSnapshot,
) => void | Promise<void>;

/**
 * `plugins.entries.kazusa.config.clock`: where a new world's time begins, and
 * whether the system agent answers while it is paused.
 */
export const CLOCK_CONFIG = z.strictObject({
  startAt: z.iso.datetime().optional(),
  speed: z.number().nonnegative().optional(),
  /**
   * The system agent answers people and acts while the clock is paused, and
   * sends at once. Off, she waits for the clock like everyone else.
   */
  systemAgentWhilePaused: z.boolean().default(true),
});
