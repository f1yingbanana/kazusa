import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { currentConfig } from "../current-config.ts";
import { cachedStore } from "../state.ts";
import { isSystemAgent } from "../system-agent.ts";
import {
  STAGE_CONFIG,
  createStage,
  sharedPlayerIndex,
  type Stage,
} from "./stage.ts";

/** Opens the `"stage"` store. Every registration reads the same records. */
export function registerStage(api: OpenClawPluginApi): Stage {
  return createStage(
    cachedStore(
      "stage",
      api.runtime.state.openKeyedStore({
        namespace: "stage",
        retention: "retained",
      }),
    ),
    STAGE_CONFIG.parse(api.pluginConfig?.stage ?? {}),
    sharedPlayerIndex(),
    (id) => isSystemAgent(currentConfig(api), id),
  );
}

/** What each module does when a character goes off or comes back on. */
export interface StageEffects {
  readonly stage: Stage;
  readonly clock: Pick<Clock, "init" | "time">;
  /** Stops anything they are saying. */
  readonly interrupt: (id: string) => void | Promise<void>;
  /** Takes them out of their place and its conversations. */
  readonly exit: (id: string, at: number) => Promise<void>;
  /** Forgets the sightings they were holding: they won't have seen those. */
  readonly forgetSightings: (id: string) => Promise<void>;
  /** Puts them back where they were, seen coming in by all but `together`. */
  readonly enter: (
    id: string,
    at: number,
    together: readonly string[],
  ) => Promise<void>;
  /** Brings their wake in line with the stage: none while offstage. */
  readonly reschedule: (id: string) => Promise<void>;
  /** Their body waited too: desires pick up from where they were at `from`. */
  readonly resumeDesires: (
    id: string,
    from: number,
    to: number,
  ) => Promise<void>;
  /** Hands over whatever reached them while they were away. */
  readonly drain: (id: string) => Promise<void>;
}

/**
 * Sends a character off or brings them back. A turn already running finishes:
 * the gates hold back everything it would set off. Coming back, their activity
 * is overdue and checks in at once, with every text that waited.
 */
export function stageControl(effects: StageEffects): (
  id: string,
  onstage: boolean,
  together?: readonly string[],
  /** Coming on to be played by this person: their model never runs. */
  person?: string,
) => Promise<void> {
  const { stage, clock } = effects;
  return async (id, onstage, together = [], person) => {
    if ((await stage.isOnstage(id)) === onstage) return;
    await clock.init();
    const at = clock.time();
    const previous = await stage.set(id, onstage, at, person);
    if (!onstage) {
      await effects.interrupt(id);
      await effects.reschedule(id);
      await effects.exit(id, at);
      await effects.forgetSightings(id);
      return;
    }
    if (previous && !previous.onstage)
      await effects.resumeDesires(id, previous.since, at);
    await effects.enter(id, at, together);
    await effects.reschedule(id);
    await effects.drain(id);
  };
}

/** What taking a character over and handing them back does in each module. */
export interface PlayEffects {
  readonly stage: Stage;
  readonly clock: Pick<Clock, "init" | "time">;
  /** Brings an offstage character on, already played by `person`. */
  readonly bringOn: (id: string, person: string) => Promise<void>;
  /**
   * Stops the turn they are in and anything they are saying; a turn that starts
   * while they are played stops as it starts.
   */
  readonly stop: (id: string) => void | Promise<void>;
  /** Ends what they were doing: their activity, its effects, a trip. */
  readonly endActivity: (id: string, at: number) => Promise<void>;
  /** Brings their wake in line: none while a person plays them. */
  readonly reschedule: (id: string) => Promise<void>;
  /** Their body waited while played: desires pick up from `from`. */
  readonly resumeDesires: (
    id: string,
    from: number,
    to: number,
  ) => Promise<void>;
  /** Clears everything queued for them: the person sees it in their client. */
  readonly drain: (id: string) => Promise<void>;
  /**
   * Their model again: a turn that looks back on what was said and done as them
   * since `since`, or a plain check-in when nothing was.
   */
  readonly handBack: (id: string, since: number) => Promise<void>;
  /** Told after every switch, for clients. */
  readonly changed?: (person: string, id: string | undefined) => void;
  /** Where an effect that failed is said; the switch stands regardless. */
  readonly warn?: (message: string) => void;
}

/**
 * Who a person plays: a character, or nobody (watching). One character per
 * person, never two people in one character. Switching hands the character they
 * leave back to their model before taking the next one over. Calls are taken
 * one at a time, so two switches never interleave.
 */
export function playControl(
  effects: PlayEffects,
): (person: string, id: string | undefined) => Promise<void> {
  const { stage, clock } = effects;
  let queue: Promise<unknown> = Promise.resolve();
  /**
   * One effect of a switch already recorded. Who plays whom is the record: an
   * effect that fails (a database still starting) is said, not undone, and the
   * rest still run, so the character is never half switched.
   */
  const step = async (
    what: string,
    id: string,
    run: () => unknown,
  ): Promise<void> => {
    try {
      await run();
    } catch (error: unknown) {
      effects.warn?.(`Playing ${id}: ${what} failed: ${String(error)}`);
    }
  };

  const release = async (id: string): Promise<void> => {
    const at = clock.time();
    const previous = await stage.setPlayer(id, undefined, at);
    const since = previous?.playedSince ?? at;
    await step("resuming desires", id, () =>
      effects.resumeDesires(id, since, at),
    );
    await step("their wake", id, () => effects.reschedule(id));
    await step("handing back", id, () => effects.handBack(id, since));
  };

  const take = async (person: string, id: string): Promise<void> => {
    const at = clock.time();
    if (await stage.isOnstage(id)) await stage.setPlayer(id, person, at);
    else await effects.bringOn(id, person);
    await step("stopping their turn", id, () => effects.stop(id));
    await step("ending their activity", id, () => effects.endActivity(id, at));
    await step("their wake", id, () => effects.reschedule(id));
    await step("their inbox", id, () => effects.drain(id));
  };

  const play = async (person: string, id: string | undefined) => {
    await clock.init();
    const current = await stage.playing(person);
    if (current === id) return;
    if (id !== undefined) {
      const record = await stage.lookup(id);
      if (record?.playedBy && record.playedBy !== person)
        throw new Error(`${id} is already being played.`);
    }
    if (current !== undefined) await release(current);
    if (id !== undefined) await take(person, id);
    effects.changed?.(person, id);
  };

  return (person, id) => {
    const next = queue.then(() => play(person, id));
    queue = next.catch(() => undefined);
    return next;
  };
}
