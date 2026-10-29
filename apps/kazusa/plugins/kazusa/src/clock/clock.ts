import type {
  ClockChangeListener,
  ClockPersistedRecord,
  ClockSnapshot,
  ClockStore,
} from "./types.ts";

/**
 * The clock's mutable state. Clocks constructed over one cell read and change
 * one simulation time, and notify each other's listeners.
 */
export interface ClockCell {
  simTime: number;
  anchorTime: number;
  speed: number;
  initPromise?: Promise<void>;
  readonly listeners: Set<ClockChangeListener>;
}

export interface ClockOptions {
  readonly store: ClockStore;
  readonly initialTime?: string | number;
  readonly defaultSpeed?: number;
  /** Shared state; when it is already initialized, the other options are unused. */
  readonly cell?: ClockCell;
}

export class Clock {
  private readonly store: ClockStore;
  private readonly cell: ClockCell;

  constructor(options: ClockOptions) {
    if (options.defaultSpeed !== undefined && options.defaultSpeed < 0) {
      throw new Error(
        `Simulation speed cannot be negative: ${options.defaultSpeed}`,
      );
    }

    this.store = options.store;
    this.cell = options.cell ?? {
      simTime: 0,
      anchorTime: 0,
      speed: 0,
      listeners: new Set(),
    };
    if (this.cell.initPromise) return;
    this.cell.simTime =
      typeof options.initialTime === "number"
        ? options.initialTime
        : options.initialTime
          ? new Date(options.initialTime).getTime()
          : Date.now();
    this.cell.speed = options.defaultSpeed ?? 1;
    this.cell.anchorTime = Date.now();
  }

  async init(): Promise<void> {
    const cell = this.cell;
    if (!cell.initPromise) {
      cell.initPromise = (async (): Promise<void> => {
        try {
          const loaded = await this.store.lookup("primary");
          if (loaded) {
            cell.simTime = loaded.simTime;
            cell.speed = loaded.speed;
            cell.anchorTime = Date.now();
            return;
          }
          await this.persist();
        } catch (error) {
          cell.initPromise = undefined;
          throw error;
        }
      })();
    }
    return cell.initPromise;
  }

  time(): number {
    const { simTime, anchorTime, speed } = this.cell;
    if (speed === 0) return simTime;
    return simTime + Math.round((Date.now() - anchorTime) * speed);
  }

  now(): ClockSnapshot {
    const simTime = this.time();
    return {
      simTime,
      speed: this.cell.speed,
      formatted: new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
        timeZone: "UTC",
      }).format(new Date(simTime)),
    };
  }

  onClockChange(listener: ClockChangeListener): () => void {
    this.cell.listeners.add(listener);
    return (): void => {
      this.cell.listeners.delete(listener);
    };
  }

  async setSpeed(speed: number): Promise<ClockSnapshot> {
    if (!Number.isFinite(speed) || speed < 0) {
      throw new Error(
        `Simulation speed must be a non-negative finite number: ${speed}`,
      );
    }
    const previous = this.now();
    this.cell.simTime = this.time();
    this.cell.anchorTime = Date.now();
    this.cell.speed = speed;
    await this.persist();
    return await this.notifyListeners(previous);
  }

  async advance(minutes: number): Promise<ClockSnapshot> {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error(`Advance duration must be positive: ${minutes}`);
    }

    const previous = this.now();
    this.cell.simTime = this.time() + Math.round(minutes * 60_000);
    this.cell.anchorTime = Date.now();
    await this.persist();
    return await this.notifyListeners(previous);
  }

  async persist(): Promise<void> {
    const record: ClockPersistedRecord = {
      simTime: this.time(),
      speed: this.cell.speed,
    };
    await this.store.register("primary", record);
  }

  async close(): Promise<void> {
    await this.persist();
  }

  private async notifyListeners(
    previousSnapshot: ClockSnapshot,
  ): Promise<ClockSnapshot> {
    const snapshot = this.now();
    for (const listener of [...this.cell.listeners]) {
      try {
        await listener(snapshot, previousSnapshot);
      } catch {
        // A dependent subsystem must not undo a clock change.
      }
    }
    return snapshot;
  }
}

/** One wall-clock wait, cut short by either signal. */
function pause(
  ms: number,
  signal: AbortSignal,
  release?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      release?.removeEventListener("abort", done);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      release?.removeEventListener("abort", done);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Simulation sleep aborted"),
      );
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", onAbort, { once: true });
    release?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Wait until `simMs` of simulation time has elapsed. Wall time follows the
 * current speed and is re-checked every `pollMs`, so speed changes and clock
 * advances apply mid-wait, and a paused clock holds the wait where it is.
 * Returns false only when `release` lets go of a frozen wait (the Gateway is
 * stopping); the caller then finishes at once.
 */
export async function sleepSim(
  clock: Pick<Clock, "now">,
  simMs: number,
  signal: AbortSignal,
  options: { readonly release?: AbortSignal; readonly pollMs?: number } = {},
): Promise<boolean> {
  const { release, pollMs = 250 } = options;
  const target = clock.now().simTime + simMs;
  for (;;) {
    signal.throwIfAborted();
    const { simTime, speed } = clock.now();
    if (simTime >= target) return true;
    if (speed <= 0) {
      if (release?.aborted) return false;
      await pause(pollMs, signal, release);
      continue;
    }
    await pause(
      Math.min(pollMs, Math.ceil((target - simTime) / speed)),
      signal,
    );
  }
}

/**
 * Wait while the clock is paused: the world, and whoever acts in it, holds
 * still until it runs again. `release` lets go at once (the Gateway is
 * stopping), so the action happens at the paused moment.
 */
export async function untilRunning(
  clock: Pick<Clock, "now">,
  release?: AbortSignal,
  pollMs = 250,
): Promise<void> {
  const never = new AbortController().signal;
  while (clock.now().speed <= 0 && !release?.aborted) {
    await pause(pollMs, never, release);
  }
}
