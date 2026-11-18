import type { StatsResponse, StatsStreamEvent } from "@kazusa/client";
import { withStatsEvent } from "./http";

type Write = (
  data:
    StatsResponse | ((current?: StatsResponse) => StatsResponse | undefined),
) => Promise<StatsResponse | undefined>;

/** How long after a failed read the next is tried: doubling, up to the last. */
export const RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;

/**
 * Keeps the states snapshot whole while the stream patches it. Patching a cache
 * makes SWR drop a read of it that is under way, and nothing starts that read
 * again: definitions changed just before a record event would stay old. So a
 * whole read is made here, outside SWR, and the record events that arrive
 * during it are put back on top of what it returns.
 */
export function statsSync(deps: {
  readonly read: () => Promise<StatsResponse>;
  /** Replaces the cached snapshot, or patches it, without a read of its own. */
  readonly write: Write;
  /**
   * Told when what is cached may be out of date with nothing left trying to
   * mend it (every retry failed), and when a read lands again.
   */
  readonly stale?: (stale: boolean) => void;
  /** Runs something later and returns how to call it off; a timer by default. */
  readonly later?: (run: () => void, ms: number) => () => void;
}): {
  /** Reads everything again: definitions changed, or events were missed. */
  readonly refresh: () => void;
  /**
   * The same, for whoever has to know it is done: over once the newest read has
   * landed in the cache, and throwing when it could not be made.
   */
  readonly whole: () => Promise<void>;
  readonly event: (event: StatsStreamEvent) => void;
  readonly stop: () => void;
} {
  let reads = 0;
  /** The read under way by its number, or 0. */
  let reading = 0;
  /** The last read failed: it is tried again, and the next event asks too. */
  let owed = false;
  /** Reads failed in a row, and how to call off the retry that is waiting. */
  let failed = 0;
  let cancel: (() => void) | undefined;
  let since: StatsStreamEvent[] = [];
  let stopped = false;
  /** Whoever waits on `whole`: told how the newest read went, or of a stop. */
  let waiting: { landed: () => void; lost: (reason: Error) => void }[] = [];
  const tell = (reason?: Error): void => {
    const told = waiting;
    waiting = [];
    for (const { landed, lost } of told)
      if (reason) lost(reason);
      else landed();
  };
  const later =
    deps.later ??
    ((run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });

  const refresh = (): void => {
    cancel?.();
    cancel = undefined;
    const mine = ++reads;
    reading = mine;
    owed = false;
    since = [];
    deps.read().then(
      async (snapshot) => {
        // A later read began after this one and knows more.
        if (stopped || mine !== reading) return;
        reading = 0;
        failed = 0;
        deps.stale?.(false);
        await deps.write(
          since.reduce(
            (whole, event) => withStatsEvent(whole, event) ?? whole,
            snapshot,
          ),
        );
        tell();
      },
      () => {
        if (stopped || mine !== reading) return;
        reading = 0;
        owed = true;
        // Nothing else may come down the stream to ask again. After the last
        // wait it is left to the next event or reconnection.
        const wait = RETRY_MS[failed++];
        if (wait !== undefined) cancel = later(refresh, wait);
        else deps.stale?.(true);
        tell(new Error("The states could not be read."));
      },
    );
  };

  return {
    refresh,
    whole() {
      // Told by whichever read is the newest when it ends: one that another
      // overtook is not waited for, and a stop is not a read that landed.
      const done = new Promise<void>((landed, lost) => {
        waiting.push({ landed, lost });
      });
      if (stopped) tell(new Error("The states are no longer being read."));
      else refresh();
      return done;
    },
    event(event) {
      if (!event.record || owed) {
        refresh();
        return;
      }
      if (reading) since.push(event);
      void deps
        .write((current) => withStatsEvent(current, event) ?? current)
        .then((current) => {
          // Nothing to patch yet, and this write dropped the read for it.
          if (stopped || current || reading) return;
          refresh();
          since.push(event);
        });
    },
    stop() {
      stopped = true;
      cancel?.();
      cancel = undefined;
      tell(new Error("The states are no longer being read."));
    },
  };
}

/**
 * The page's one sync, while its stream is up. Anything else that needs a whole
 * read asks it: a read of its own would be dropped by the stream's next patch.
 */
let live: ReturnType<typeof statsSync> | undefined;
let stale = false;
const watching = new Set<() => void>();
export const liveStats = {
  /**
   * Whether the states shown may be out of date with nothing still trying to
   * read them again; `watch` is told when that changes.
   */
  stale: (): boolean => stale,
  setStale: (next: boolean): void => {
    if (next === stale) return;
    stale = next;
    for (const told of watching) told();
  },
  watch: (told: () => void): (() => void) => {
    watching.add(told);
    return () => watching.delete(told);
  },
  /** Returns how to step down, when the stream does. */
  is(sync: ReturnType<typeof statsSync>): () => void {
    live = sync;
    return () => {
      if (live !== sync) return;
      live = undefined;
      liveStats.setStale(false);
    };
  },
  /** `undefined` with no stream: nothing patches under a read then. */
  whole: (): Promise<void> | undefined => live?.whole(),
};
