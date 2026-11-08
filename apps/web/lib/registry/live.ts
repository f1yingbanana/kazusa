import type { StreamEvent, StreamEventType } from "@kazusa/client";
import {
  mergeJournal,
  updateDesire,
  updateLocation,
  updateStatuses,
} from "../live/state";
import { setClock, useClockStore } from "../live/clock-state";
import type { LiveHandler } from "./types";

export const LIVE_HANDLERS: { [T in StreamEventType]?: LiveHandler<T> } = {
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
