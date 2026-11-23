import type { Operator } from "./identity.ts";
import type { Actor, Player } from "./player.ts";

/**
 * For tests: a person at the keyboard playing `playing` (named by its id,
 * capitalized), or watching.
 */
export function fakePlayer(
  playing?: string,
  operator: Operator = { id: "user:sensei", name: "Sensei" },
): Player {
  const actor: Actor | undefined = playing
    ? { id: playing, name: playing[0].toUpperCase() + playing.slice(1) }
    : undefined;
  return {
    operator,
    playing: async () => actor,
    playingNow: () => actor?.id,
    actorIn: async (members) =>
      members.includes(operator.id) ? operator : actor,
    owns: (audience) =>
      audience.includes(operator.id) ||
      (actor !== undefined && audience.includes(actor.id)),
  };
}
