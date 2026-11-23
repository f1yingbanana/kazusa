import { z } from "zod";
import type { StateStore } from "../state.ts";

/** `plugins.entries.kazusa.config.stage`. */
export const STAGE_CONFIG = z.strictObject({
  /**
   * Whether a character with no record is onstage. A large cast imported for
   * players to pick from sets this to `false`.
   */
  defaultOnstage: z.boolean().default(true),
  /** Onstage from the start even when `defaultOnstage` is `false`. */
  cast: z.array(z.string().min(1)).default([]),
});

export type StageConfig = z.infer<typeof STAGE_CONFIG>;

/**
 * Whether a character is in the world, and who plays them. Offstage, nothing
 * happens to them: no wakes, no attention, no place in the world; what reaches
 * them (texts) waits in their inbox until they come back. Onstage, their own
 * model plays them, or a person does (`playedBy`): then they are in the world
 * but think nothing of their own.
 */
export interface StageRecord {
  readonly onstage: boolean;
  /** Sim time (epoch ms) of the change. */
  readonly since: number;
  /** The person playing them (`user:<id>`), while one is. */
  readonly playedBy?: string;
  /** Sim time the person took them over. */
  readonly playedSince?: number;
}

export type StageStore = StateStore<StageRecord>;

export interface Stage {
  /** Whether they are in the world: played by their model or by a person. */
  isOnstage(id: string): Promise<boolean>;
  /** Whether their own model plays them: onstage, and no person does. */
  isSimulated(id: string): Promise<boolean>;
  /** Whether they were in the world at sim time `at`, as far as is known. */
  presentAt(id: string, at: number): Promise<boolean>;
  /** Keeps those onstage, in order. */
  onstage(ids: readonly string[]): Promise<string[]>;
  /** Keeps those their own model plays, in order. */
  simulated(ids: readonly string[]): Promise<string[]>;
  /**
   * Records the change; returns the record it replaced, if any. Coming on to be
   * played (`person`) records both at once, so no gate ever sees them onstage
   * and unplayed in between.
   */
  set(
    id: string,
    onstage: boolean,
    at: number,
    person?: string,
  ): Promise<StageRecord | undefined>;
  /**
   * Records who plays them: a person, or nobody (their model again). Returns
   * the record it replaced, if any. A played character is always onstage.
   */
  setPlayer(
    id: string,
    person: string | undefined,
    at: number,
  ): Promise<StageRecord | undefined>;
  /** The character this person plays, if any. */
  playing(person: string): Promise<string | undefined>;
  /**
   * The same, read synchronously for filtering a stream's events; right once
   * anything has asked `playing` (the start-up warms it).
   */
  playingNow(person: string): string | undefined;
  /** Whether a person plays them now. */
  isPlayed(id: string): Promise<boolean>;
  /** Nobody has come on, gone off or been played yet: a world's first start. */
  untouched(): Promise<boolean>;
  lookup(id: string): Promise<StageRecord | undefined>;
}

/**
 * Who plays whom, one character per person. Every registration reads the same
 * records; this index only saves scanning them on every request and message
 * event. Every write of `playedBy` (`setPlayer`, and `set` bringing someone on
 * played) keeps it, so it stays true once built.
 */
export interface PlayerIndex {
  byPerson?: Map<string, string>;
}

const PLAYER_INDEX = Symbol.for("kazusa.stage.players");

export function sharedPlayerIndex(): PlayerIndex {
  const scope = globalThis as typeof globalThis & {
    [PLAYER_INDEX]?: PlayerIndex;
  };
  return (scope[PLAYER_INDEX] ??= {});
}

export function createStage(
  store: StageStore,
  config: StageConfig,
  index: PlayerIndex = {},
): Stage {
  const startsOnstage = (id: string): boolean =>
    config.defaultOnstage || config.cast.includes(id);
  const isOnstage = async (id: string): Promise<boolean> =>
    (await store.lookup(id))?.onstage ?? startsOnstage(id);
  const isSimulated = async (id: string): Promise<boolean> => {
    const record = await store.lookup(id);
    return record ? record.onstage && !record.playedBy : startsOnstage(id);
  };
  const players = async (): Promise<Map<string, string>> => {
    if (index.byPerson) return index.byPerson;
    const byPerson = new Map<string, string>();
    for (const { key, value } of await store.entries())
      if (value.playedBy) byPerson.set(value.playedBy, key);
    return (index.byPerson ??= byPerson);
  };
  const keep = async (
    ids: readonly string[],
    test: (id: string) => Promise<boolean>,
  ): Promise<string[]> => {
    const flags = await Promise.all(ids.map(test));
    return ids.filter((_, at) => flags[at]);
  };
  /** One character per person, one person per character. */
  const claim = async (
    id: string,
    person: string,
    previous: StageRecord | undefined,
  ): Promise<void> => {
    if (previous?.playedBy && previous.playedBy !== person)
      throw new Error(`${id} is already being played.`);
    const playing = (await players()).get(person);
    if (playing !== undefined && playing !== id)
      throw new Error(`${person} is playing someone else.`);
  };
  return {
    isOnstage,
    isSimulated,
    playingNow: (person) => index.byPerson?.get(person),
    isPlayed: async (id) => Boolean((await store.lookup(id))?.playedBy),
    untouched: async () => (await store.entries()).length === 0,
    async presentAt(id, at) {
      const record = await store.lookup(id);
      if (!record) return startsOnstage(id);
      // Before coming on, they were off; before going off, it is unknown here
      // and anything still waiting from then is let through.
      return record.onstage ? at >= record.since : at < record.since;
    },
    onstage: (ids) => keep(ids, isOnstage),
    simulated: (ids) => keep(ids, isSimulated),
    async set(id, onstage, at, person) {
      const previous = await store.lookup(id);
      if (!onstage && previous?.playedBy)
        throw new Error(`${id} is being played; stop playing them first.`);
      if (person) {
        if (!onstage) throw new Error("Only someone onstage can be played.");
        await claim(id, person, previous);
      }
      const playedBy = person ?? previous?.playedBy;
      await store.register(id, {
        onstage,
        since: at,
        ...(playedBy
          ? {
              playedBy,
              playedSince: person ? at : (previous?.playedSince ?? at),
            }
          : {}),
      });
      if (person) (await players()).set(person, id);
      return previous;
    },
    async setPlayer(id, person, at) {
      const byPerson = await players();
      const previous = await store.lookup(id);
      if (person) await claim(id, person, previous);
      const onstage = previous?.onstage ?? startsOnstage(id);
      if (person && !onstage) throw new Error(`${id} is offstage.`);
      await store.register(id, {
        onstage,
        since: previous?.since ?? at,
        ...(person ? { playedBy: person, playedSince: at } : {}),
      });
      if (previous?.playedBy) byPerson.delete(previous.playedBy);
      if (person) byPerson.set(person, id);
      return previous;
    },
    playing: async (person) => (await players()).get(person),
    lookup: (id) => store.lookup(id),
  };
}
