import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { currentConfig } from "./current-config.ts";
import { characterName, operatorOf, type Operator } from "./identity.ts";
import type { Stage } from "./stage/stage.ts";

/** Someone acting: the character played, by id and the name others know. */
export interface Actor {
  readonly id: string;
  readonly name: string;
}

export interface Player {
  readonly operator: Operator;
  /** The character the operator plays now, or `undefined` while watching. */
  playing(): Promise<Actor | undefined>;
  /**
   * The same id, read synchronously for filtering a stream's events; right once
   * anything has asked `playing` (the start-up warms it).
   */
  playingNow(): string | undefined;
  /** Who acts in this chat: the operator in theirs, else whoever they play. */
  actorIn(members: readonly string[]): Promise<Actor | undefined>;
  /** Whether what reached `audience` is the person's: theirs, or the played's. */
  owns(audience: readonly string[]): boolean;
}

/** Thrown where acting needs a character and the operator plays none. */
export class WatchingError extends Error {
  constructor() {
    super("You're watching. Play as someone to do that.");
    this.name = "WatchingError";
  }
}

export function createPlayer(
  api: OpenClawPluginApi,
  stage: Pick<Stage, "playing" | "playingNow">,
  config: () => OpenClawConfig = () => currentConfig(api),
): Player {
  const operator = operatorOf(api);
  const playing = async (): Promise<Actor | undefined> => {
    const id = await stage.playing(operator.id);
    if (id === undefined) return undefined;
    return {
      id,
      name: await characterName(api, config(), id).catch(() => id),
    };
  };
  return {
    operator,
    playing,
    playingNow: () => stage.playingNow(operator.id),
    async actorIn(members) {
      if (members.includes(operator.id)) return operator;
      return await playing();
    },
    owns(audience) {
      const played = stage.playingNow(operator.id);
      return (
        audience.includes(operator.id) ||
        (played !== undefined && audience.includes(played))
      );
    },
  };
}
