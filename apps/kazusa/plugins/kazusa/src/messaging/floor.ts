/**
 * Turn-taking in face-to-face conversation: one floor per huddle. Saying a line
 * takes its speaking time; a line that finds someone else speaking waits for
 * the floor, unless its speaker cuts in. At each line's end the floor goes by
 * how badly people want in, not by who waited longest.
 */

import type { Medium } from "./composing.ts";

/** How badly a speaker wants in when someone else has the floor. */
export const FLOOR_CHOICES = ["CUT_IN", "NEXT", "WAIT"] as const;
export type FloorChoice = (typeof FLOOR_CHOICES)[number];

/** What a speaker can see of a conversation's floor when they want to talk. */
export interface FloorFacts {
  /** Who is saying something right now. */
  readonly speaking: readonly string[];
  /** Whose turn it is: they may have more to say. */
  readonly turn?: string;
  /** How many others are waiting to speak. */
  readonly waiting: number;
}

/** What someone is about to type or say into, as asked once per send. */
export interface SpeechFacts {
  /** The speaker's own address of the conversation. */
  readonly sessionKey: string;
  readonly medium: Medium;
  /** Present when someone else has the floor. */
  readonly floor?: FloorFacts;
}

/** How they say it: how badly they want in, and how fast they type or talk. */
export interface SpeechJudgment {
  readonly floor: FloorChoice;
  /** Their rate against an ordinary one: 1.25 is a quarter faster. */
  readonly pace: number;
}

/** One line wanting the floor. A plan is one `send_message` call. */
export interface FloorClaim {
  readonly agentId: string;
  readonly planId: string;
  readonly choice: Exclude<FloorChoice, "CUT_IN">;
}

interface Waiting extends FloorClaim {
  readonly order: number;
  readonly grant: () => void;
}

interface Room {
  /** Lines being said now, by plan; more than one only after a cut-in. */
  readonly speaking: Map<string, string>;
  /** The send whose turn it is; `open` until its last line is said. */
  turn?: { readonly agentId: string; readonly planId: string; open: boolean };
  waiting: Waiting[];
}

/** Every huddle's floor in the process; shared by all Messaging instances. */
export class Floors {
  private readonly rooms = new Map<string, Room>();
  private order = 0;

  private room(chatId: string): Room {
    let room = this.rooms.get(chatId);
    if (!room) {
      room = { speaking: new Map(), waiting: [] };
      this.rooms.set(chatId, room);
    }
    return room;
  }

  /** The floor as `agentId` sees it; `undefined` when it is theirs to take. */
  contested(
    chatId: string,
    agentId: string,
    planId: string,
  ): Omit<FloorFacts, "sessionKey"> | undefined {
    const room = this.rooms.get(chatId);
    if (!room) return undefined;
    const others = room.waiting.filter((claim) => claim.planId !== planId);
    const speaking = [...room.speaking]
      .filter(([plan]) => plan !== planId)
      .map(([, id]) => id);
    const turn = room.turn?.open ? room.turn : undefined;
    if (
      speaking.length === 0 &&
      others.length === 0 &&
      (!turn || turn.planId === planId)
    )
      return undefined;
    return {
      speaking: [...new Set(speaking)].filter((id) => id !== agentId),
      ...(turn && turn.agentId !== agentId ? { turn: turn.agentId } : {}),
      waiting: others.length,
    };
  }

  /** Start saying a line at once, over whoever is speaking. */
  cutIn(chatId: string, agentId: string, planId: string): void {
    const room = this.room(chatId);
    room.speaking.set(planId, agentId);
    room.turn = { agentId, planId, open: true };
  }

  /**
   * Wait for the floor, then hold it. Resolves at once when it is free, or when
   * `release` (a stopping Gateway) lets everyone go; rejects when `signal`
   * aborts, giving up the place in line.
   */
  async take(
    chatId: string,
    claim: FloorClaim,
    signal: AbortSignal,
    release?: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const room = this.room(chatId);
    if (release?.aborted) {
      room.speaking.set(claim.planId, claim.agentId);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const waiting: Waiting = {
        ...claim,
        order: ++this.order,
        grant: () => {
          cleanup();
          resolve();
        },
      };
      const onAbort = (): void => {
        cleanup();
        room.waiting = room.waiting.filter((item) => item !== waiting);
        this.next(chatId);
        reject(signal.reason instanceof Error ? signal.reason : new Error());
      };
      const onRelease = (): void => {
        room.waiting = room.waiting.filter((item) => item !== waiting);
        room.speaking.set(claim.planId, claim.agentId);
        waiting.grant();
      };
      const cleanup = (): void => {
        signal.removeEventListener("abort", onAbort);
        release?.removeEventListener("abort", onRelease);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      release?.addEventListener("abort", onRelease, { once: true });
      room.waiting.push(waiting);
      this.next(chatId);
    });
  }

  /** A line was said (or cut off): the floor moves on. */
  done(chatId: string, planId: string): void {
    const room = this.rooms.get(chatId);
    if (!room) return;
    room.speaking.delete(planId);
    this.next(chatId);
  }

  /** A send is over: its turn ends, and anything it still waited for goes. */
  endTurn(chatId: string, planId: string): void {
    const room = this.rooms.get(chatId);
    if (!room) return;
    if (room.turn?.planId === planId) room.turn.open = false;
    room.speaking.delete(planId);
    this.next(chatId);
  }

  /**
   * When nobody is speaking, the floor goes to whoever wants in at the next
   * pause (first ready, first), then to the speaker whose turn it is, then to
   * those waiting for a lull once that turn is over.
   */
  private next(chatId: string): void {
    const room = this.rooms.get(chatId);
    if (!room) return;
    if (room.speaking.size === 0) {
      const byOrder = (a: Waiting, b: Waiting) => a.order - b.order;
      const turn = room.turn?.open ? room.turn : undefined;
      const winner =
        room.waiting
          .filter(
            (claim) => claim.choice === "NEXT" && claim.planId !== turn?.planId,
          )
          .sort(byOrder)[0] ??
        room.waiting.find((claim) => claim.planId === turn?.planId) ??
        (turn
          ? undefined
          : room.waiting
              .filter((claim) => claim.choice === "WAIT")
              .sort(byOrder)[0]);
      if (winner) {
        room.waiting = room.waiting.filter((claim) => claim !== winner);
        room.speaking.set(winner.planId, winner.agentId);
        room.turn = {
          agentId: winner.agentId,
          planId: winner.planId,
          open: true,
        };
        winner.grant();
        return;
      }
    }
    if (
      room.speaking.size === 0 &&
      room.waiting.length === 0 &&
      !room.turn?.open
    )
      this.rooms.delete(chatId);
  }
}
