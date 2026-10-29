import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { STAGE_CONFIG, createStage, type Stage } from "./stage.ts";

/** Opens the `"stage"` store. Every registration reads the same records. */
export function registerStage(api: OpenClawPluginApi): Stage {
  return createStage(
    api.runtime.state.openKeyedStore({
      namespace: "stage",
      retention: "retained",
    }),
    STAGE_CONFIG.parse(api.pluginConfig?.stage ?? {}),
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
  /** Puts them back where they were, seen coming in. */
  readonly enter: (id: string, at: number) => Promise<void>;
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
export function stageControl(
  effects: StageEffects,
): (id: string, onstage: boolean) => Promise<void> {
  const { stage, clock } = effects;
  return async (id, onstage) => {
    if ((await stage.isOnstage(id)) === onstage) return;
    await clock.init();
    const at = clock.time();
    const previous = await stage.set(id, onstage, at);
    if (!onstage) {
      await effects.interrupt(id);
      await effects.reschedule(id);
      await effects.exit(id, at);
      return;
    }
    if (previous && !previous.onstage)
      await effects.resumeDesires(id, previous.since, at);
    await effects.enter(id, at);
    await effects.reschedule(id);
    await effects.drain(id);
  };
}
