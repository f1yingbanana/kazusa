import type { StatsResponse, StatsStreamEvent } from "@kazusa/client";
import { withStatsEvent } from "./http";

type Write = (
  data:
    StatsResponse | ((current?: StatsResponse) => StatsResponse | undefined),
) => Promise<StatsResponse | undefined>;

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
}): {
  /** Reads everything again: definitions changed, or events were missed. */
  readonly refresh: () => void;
  readonly event: (event: StatsStreamEvent) => void;
  readonly stop: () => void;
} {
  let reads = 0;
  /** The read under way by its number, or 0. */
  let reading = 0;
  /** The last read failed: the next event asks again. */
  let owed = false;
  let since: StatsStreamEvent[] = [];
  let stopped = false;

  const refresh = (): void => {
    const mine = ++reads;
    reading = mine;
    owed = false;
    since = [];
    deps.read().then(
      (snapshot) => {
        // A later read began after this one and knows more.
        if (stopped || mine !== reading) return;
        reading = 0;
        void deps.write(
          since.reduce(
            (whole, event) => withStatsEvent(whole, event) ?? whole,
            snapshot,
          ),
        );
      },
      () => {
        if (mine !== reading) return;
        reading = 0;
        owed = true;
      },
    );
  };

  return {
    refresh,
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
    },
  };
}
