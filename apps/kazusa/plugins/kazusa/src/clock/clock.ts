import type {
  ClockChangeListener,
  ClockPersistedRecord,
  ClockSnapshot,
  ClockStore,
} from "./types.ts";

export interface ClockOptions {
  readonly store: ClockStore;
  readonly initialTime?: string | number;
  readonly defaultSpeed?: number;
}

export class Clock {
  private readonly store: ClockStore;
  private simTime: number;
  private anchorTime: number;
  private speed: number;
  private initPromise?: Promise<void>;
  private readonly listeners = new Set<ClockChangeListener>();

  constructor(options: ClockOptions) {
    if (options.defaultSpeed !== undefined && options.defaultSpeed < 0) {
      throw new Error(
        `Simulation speed cannot be negative: ${options.defaultSpeed}`,
      );
    }

    this.store = options.store;
    this.simTime =
      typeof options.initialTime === "number"
        ? options.initialTime
        : options.initialTime
          ? new Date(options.initialTime).getTime()
          : Date.now();
    this.speed = options.defaultSpeed ?? 1;
    this.anchorTime = Date.now();
  }

  async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async (): Promise<void> => {
        try {
          const loaded = await this.store.lookup("primary");
          if (loaded) {
            this.simTime = loaded.simTime;
            this.speed = loaded.speed;
            this.anchorTime = Date.now();
            return;
          }
          await this.persist();
        } catch (error) {
          this.initPromise = undefined;
          throw error;
        }
      })();
    }
    return this.initPromise;
  }

  time(): number {
    if (this.speed === 0) return this.simTime;
    return (
      this.simTime + Math.round((Date.now() - this.anchorTime) * this.speed)
    );
  }

  now(): ClockSnapshot {
    const simTime = this.time();
    return {
      simTime,
      speed: this.speed,
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
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }

  async setSpeed(speed: number): Promise<ClockSnapshot> {
    if (!Number.isFinite(speed) || speed < 0) {
      throw new Error(
        `Simulation speed must be a non-negative finite number: ${speed}`,
      );
    }
    const previous = this.now();
    this.simTime = this.time();
    this.anchorTime = Date.now();
    this.speed = speed;
    await this.persist();
    return await this.notifyListeners(previous);
  }

  async advance(minutes: number): Promise<ClockSnapshot> {
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error(`Advance duration must be positive: ${minutes}`);
    }

    const previous = this.now();
    this.simTime = this.time() + Math.round(minutes * 60_000);
    this.anchorTime = Date.now();
    await this.persist();
    return await this.notifyListeners(previous);
  }

  async persist(): Promise<void> {
    const record: ClockPersistedRecord = {
      simTime: this.time(),
      speed: this.speed,
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
    for (const listener of this.listeners) {
      try {
        await listener(snapshot, previousSnapshot);
      } catch {
        // A dependent subsystem must not undo a clock change.
      }
    }
    return snapshot;
  }
}
