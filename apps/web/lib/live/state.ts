import type {
  CharacterStatus,
  ClockState,
  DesireRecord,
  DesiresConfig,
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

/** The world's desire catalog; null until the desires domain has loaded. */
export const desireConfigStore = createValueStore<DesiresConfig | null>(null);

/** Per-character closed-form desire records (levels are computed from sim time). */
export const desireStore = createKeyedStore<DesireRecord>();

/** Live journal events received after history was loaded, ascending by seq. */
export const journalTailStore = createValueStore<readonly JournalEvent[]>([]);
