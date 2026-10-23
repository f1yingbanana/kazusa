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
