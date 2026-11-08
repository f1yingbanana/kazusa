import { create } from "zustand";
import type {
  CharacterStatus,
  DesireRecord,
  JournalEvent,
  LocationRecord,
} from "@kazusa/client";
import { mergeTail } from "./journal";

/** Live projections only. SWR owns resource fetching and response caching. */
export interface LiveState {
  readonly statuses: ReadonlyMap<string, CharacterStatus>;
  readonly desires: ReadonlyMap<string, DesireRecord>;
  readonly locations: ReadonlyMap<string, LocationRecord>;
  readonly journalTail: readonly JournalEvent[];
}

/** Preserve changes made while an HTTP snapshot was in flight. */
function snapshotRecords<T>(
  entries: Iterable<readonly [string, T]>,
  current: ReadonlyMap<string, T>,
  baseline?: ReadonlyMap<string, T>,
): ReadonlyMap<string, T> {
  // HTTP snapshots contain fresh JSON objects even when their values are unchanged.
  // Retain equal records so polling does not rerender every per-id subscriber.
  const next = new Map(
    Array.from(entries, ([id, record]) => {
      const previous = current.get(id);
      return [
        id,
        previous !== undefined &&
        JSON.stringify(previous) === JSON.stringify(record)
          ? previous
          : record,
      ] as const;
    }),
  );
  if (baseline) {
    for (const [id, record] of current) {
      if (record !== baseline.get(id)) next.set(id, record);
    }
    for (const id of baseline.keys()) {
      if (!current.has(id)) next.delete(id);
    }
  }
  return next.size === current.size &&
    [...next].every(([id, record]) => current.get(id) === record)
    ? current
    : next;
}

export const useLiveStore = create<LiveState>()(() => ({
  statuses: new Map(),
  desires: new Map(),
  locations: new Map(),
  journalTail: [],
}));

export function setStatuses(
  entries: Iterable<readonly [string, CharacterStatus]>,
  baseline?: ReadonlyMap<string, CharacterStatus>,
): void {
  useLiveStore.setState((state) => {
    const statuses = snapshotRecords(entries, state.statuses, baseline);
    return statuses === state.statuses ? state : { statuses };
  });
}

export function updateStatuses(
  entries: Iterable<readonly [string, CharacterStatus]>,
): void {
  useLiveStore.setState((state) => {
    const statuses = new Map(state.statuses);
    let changed = false;
    for (const [id, status] of entries) {
      if (statuses.get(id) === status) continue;
      statuses.set(id, status);
      changed = true;
    }
    return changed ? { statuses } : state;
  });
}

export function setDesires(
  entries: Iterable<readonly [string, DesireRecord]>,
  baseline?: ReadonlyMap<string, DesireRecord>,
): void {
  useLiveStore.setState((state) => {
    const desires = snapshotRecords(
      Array.from(entries, ([id, record]) => {
        const current = state.desires.get(id);
        return [
          id,
          current && current.anchorAt > record.anchorAt ? current : record,
        ] as const;
      }),
      state.desires,
      baseline,
    );
    return desires === state.desires ? state : { desires };
  });
}

export function updateDesire(id: string, record: DesireRecord): void {
  useLiveStore.setState((state) => {
    const current = state.desires.get(id);
    if (current === record || (current && current.anchorAt > record.anchorAt))
      return state;
    return { desires: new Map(state.desires).set(id, record) };
  });
}

export function setLocations(
  entries: Iterable<readonly [string, LocationRecord]>,
  baseline?: ReadonlyMap<string, LocationRecord>,
): void {
  useLiveStore.setState((state) => {
    const locations = snapshotRecords(entries, state.locations, baseline);
    return locations === state.locations ? state : { locations };
  });
}

export function updateLocation(id: string, record: LocationRecord): void {
  useLiveStore.setState((state) =>
    state.locations.get(id) === record
      ? state
      : { locations: new Map(state.locations).set(id, record) },
  );
}

export function mergeJournal(events: readonly JournalEvent[]): void {
  useLiveStore.setState((state) => {
    const journalTail = mergeTail(state.journalTail, events);
    return journalTail === state.journalTail ? state : { journalTail };
  });
}

export function clearJournal(): void {
  useLiveStore.setState((state) =>
    state.journalTail.length ? { journalTail: [] } : state,
  );
}
