import type {
  StreamEvent,
  StreamEventOf,
  StreamEventType,
} from "@kazusa/client";
import {
  mergeJournal,
  updateDesire,
  updateLocation,
  updateStatuses,
} from "./state";
import { setClock, useClockStore } from "./clock-state";

/** Applies one SSE event type to client state. */
type LiveHandler<T extends StreamEventType> = (event: StreamEventOf<T>) => void;

const LIVE_HANDLERS: { [T in StreamEventType]?: LiveHandler<T> } = {
  status: (event) => updateStatuses([[event.characterId, event.status]]),
  journal: (event) => mergeJournal([event.event]),
  clock: (event) =>
    setClock({
      clock: event.clock,
      offset: useClockStore.getState().clock?.offset ?? 0,
    }),
  desires: (event) => updateDesire(event.characterId, event.record),
  location: (event) => updateLocation(event.characterId, event.record),
};

export function dispatchLive(event: StreamEvent): void {
  const handler = LIVE_HANDLERS[event.type] as
    ((event: StreamEvent) => void) | undefined;
  handler?.(event);
}
