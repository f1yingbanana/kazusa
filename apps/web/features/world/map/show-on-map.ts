import { useSyncExternalStore } from "react";

/*
  Asking the map to show a place again: the link's `world.in` says which place,
  and a press of "On the map" counts here, so pressing it for the place already
  in the link still flies there.
*/
let asked = 0;
const listeners = new Set<() => void>();

export function askToShowOnMap(): void {
  asked += 1;
  for (const listener of listeners) listener();
}

export function useShowOnMapAsks(): number {
  return useSyncExternalStore(
    (change) => {
      listeners.add(change);
      return () => listeners.delete(change);
    },
    () => asked,
    () => 0,
  );
}
