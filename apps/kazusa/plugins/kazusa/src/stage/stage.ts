import { z } from "zod";
import type { StateStore } from "../state.ts";

/** `plugins.entries.kazusa.config.stage`. */
export const STAGE_CONFIG = z.strictObject({
  /**
   * Whether a character with no record is onstage. A large cast imported for
   * players to pick from sets this to `false`.
   */
  defaultOnstage: z.boolean().default(true),
});

export type StageConfig = z.infer<typeof STAGE_CONFIG>;

/**
 * Whether a character is simulated. Offstage, nothing happens to them: no
 * wakes, no attention, no place in the world. What reaches them (texts) waits
 * in their inbox until they come back.
 */
export interface StageRecord {
  readonly onstage: boolean;
  /** Sim time (epoch ms) of the change. */
  readonly since: number;
}

export type StageStore = StateStore<StageRecord>;

export interface Stage {
  isOnstage(id: string): Promise<boolean>;
  /** Whether they were simulated at sim time `at`, as far as is known. */
  presentAt(id: string, at: number): Promise<boolean>;
  /** Keeps those onstage, in order. */
  onstage(ids: readonly string[]): Promise<string[]>;
  /** Records the change; returns the record it replaced, if any. */
  set(
    id: string,
    onstage: boolean,
    at: number,
  ): Promise<StageRecord | undefined>;
  lookup(id: string): Promise<StageRecord | undefined>;
}

/** Players are always present: they have no brain to switch off. */
const isUser = (id: string): boolean => id.startsWith("user:");

export function createStage(store: StageStore, config: StageConfig): Stage {
  const isOnstage = async (id: string): Promise<boolean> =>
    isUser(id) || ((await store.lookup(id))?.onstage ?? config.defaultOnstage);
  return {
    isOnstage,
    async presentAt(id, at) {
      if (isUser(id)) return true;
      const record = await store.lookup(id);
      if (!record) return config.defaultOnstage;
      // Before coming on, they were off; before going off, it is unknown here
      // and anything still waiting from then is let through.
      return record.onstage ? at >= record.since : at < record.since;
    },
    async onstage(ids) {
      const flags = await Promise.all(ids.map(isOnstage));
      return ids.filter((_, index) => flags[index]);
    },
    async set(id, onstage, at) {
      if (isUser(id)) throw new Error("Players are always onstage.");
      const previous = await store.lookup(id);
      await store.register(id, { onstage, since: at });
      return previous;
    },
    lookup: (id) => store.lookup(id),
  };
}
