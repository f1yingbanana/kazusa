import type {
  CharacterStatus,
  ClockState,
  DesireRecord,
  DesiresConfig,
  JournalEvent,
  LocationRecord,
} from "@kazusa/client";
import type { PlaceIndex } from "../location/places";
import { createKeyedStore, createValueStore } from "./store";

/** Clock anchor plus `serverNow - Date.now()` measured when it arrived. */
export interface ClockAnchor {
  readonly clock: ClockState;
  readonly offset: number;
}

/** Per-character live status, seeded from the characters snapshot (or mock). */
export const statusStore = createKeyedStore<CharacterStatus>();

export const clockStore = createValueStore<ClockAnchor | null>(null);

/** The world's desire catalog; null until the desires domain has loaded. */
export const desireConfigStore = createValueStore<DesiresConfig | null>(null);

/** Per-character closed-form desire records (levels are computed from sim time). */
export const desireStore = createKeyedStore<DesireRecord>();

/** The world's place tree; null until the places domain has loaded. */
export const placesStore = createValueStore<PlaceIndex | null>(null);

/** Per-participant closed-form position records (positions follow sim time). */
export const locationStore = createKeyedStore<LocationRecord>();

/** Live journal events received after history was loaded, ascending by seq. */
export const journalTailStore = createValueStore<readonly JournalEvent[]>([]);
