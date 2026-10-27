import type {
  CharacterStatus,
  ClockState,
  JournalEvent,
} from "@kazusa/client";
import { createKeyedStore, createValueStore } from "./store";

/** Clock anchor plus `serverNow - Date.now()` measured when it arrived. */
export interface ClockAnchor {
  readonly clock: ClockState;
  readonly offset: number;
}

/** Per-character live status, seeded from the characters snapshot (or mock). */
export const statusStore = createKeyedStore<CharacterStatus>();

export const clockStore = createValueStore<ClockAnchor | null>(null);

/** Live journal events received after history was loaded, ascending by seq. */
export const journalTailStore = createValueStore<readonly JournalEvent[]>([]);
