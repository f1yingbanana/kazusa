/**
 * Turn-taking in face-to-face conversation: one floor per huddle. Saying a line
 * takes its speaking time; a line that finds someone else speaking waits for
 * the floor, unless its speaker cuts in. At each line's end the floor goes by
 * how badly people want in, not by who waited longest.
 */

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

/** What a speaker is about to say aloud into, as asked once per send. */
export interface SpeechFacts {
  /** The speaker's own address of the conversation. */
  readonly sessionKey: string;
  /** Present when someone else has the floor. */
  readonly floor?: FloorFacts;
}

/** How they say it: how badly they want in, and how fast they talk. */
export interface SpeechJudgment {
  readonly floor: FloorChoice;
  /** Their speaking rate against an ordinary one: 1.25 is a quarter faster. */
  readonly pace: number;
}

/**
 * What one writing system's units take to say, per second at an ordinary pace:
 * spoken languages differ in how much a written character carries. Letters and
 * digits of every alphabet count alike.
 */
export interface SpeechRates {
  readonly letters: number;
  /** Chinese characters, and kanji in Japanese. */
  readonly han: number;
  /** Japanese kana: about one mora each. */
  readonly kana: number;
  /** Korean syllable blocks. */
  readonly hangul: number;
}

/**
 * ~150 English words a minute; Japanese ~8 morae, Mandarin ~5 syllables and
 * Korean ~7 syllables a second (Pellegrino et al. 2011; Korean approximate).
 */
export const SPEECH_RATES: SpeechRates = {
  letters: 12,
  han: 5,
  kana: 8,
  hangul: 7,
};

const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const SPOKEN = /[\p{L}\p{N}]/u;

/** Seconds one character takes at an ordinary pace; spaces and marks take none. */
function secondsOf(char: string, rates: SpeechRates): number {
  if (HAN.test(char)) return 1 / rates.han;
  if (KANA.test(char)) return 1 / rates.kana;
  if (HANGUL.test(char)) return 1 / rates.hangul;
  return SPOKEN.test(char) ? 1 / rates.letters : 0;
}

/** A letter of a script written with spaces between words. */
const spaced = (char: string): boolean =>
  SPOKEN.test(char) && !HAN.test(char) && !KANA.test(char);

/**
 * The pace a judged score stands for: scores index the rubric's ordered pace
 * anchors, and a fraction lies between two, evenly on a log scale (a ratio).
 * Unjudged: ordinary.
 */
export function paceAt(score: number, anchors: readonly number[]): number {
  if (!anchors.length || !Number.isFinite(score)) return 1;
  const position = Math.min(Math.max(score, 0), anchors.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const from = Math.log(anchors[lower]);
  const to = Math.log(anchors[upper]);
  return Math.exp(from + (to - from) * (position - lower));
}

/**
 * Speaking time of a spoken line, in sim ms, at the speaker's `pace`. No cap:
 * speech is said live.
 */
export function speakingMs(
  text: string,
  rates: SpeechRates = SPEECH_RATES,
  pace = 1,
): number {
  let seconds = 0;
  for (const char of text) seconds += secondsOf(char, rates);
  return Math.round((1_000 * Math.max(seconds, 0.3)) / pace);
}

/**
 * What a line said `fraction` of the way through sounded like: what its time
 * covers, then a dash. A word written with spaces is heard whole or not at all;
 * a Chinese or Japanese character on its own. Empty when cut before anything
 * was said; the whole line once its time is up.
 */
export function cutOff(
  text: string,
  fraction: number,
  rates: SpeechRates = SPEECH_RATES,
): string {
  if (fraction >= 1) return text;
  const chars = [...text];
  const total = chars.reduce((sum, char) => sum + secondsOf(char, rates), 0);
  const reached = total * Math.max(0, fraction);
  let spent = 0;
  let end = 0;
  for (; end < chars.length; end++) {
    const seconds = secondsOf(chars[end], rates);
    if (spent + seconds > reached + 1e-9) break;
    spent += seconds;
  }
  if (end < chars.length && spaced(chars[end]))
    while (end > 0 && spaced(chars[end - 1])) end--;
  const kept = chars
    .slice(0, end)
    .join("")
    .replace(/[\s\p{P}]+$/u, "");
  return [...kept].some((char) => secondsOf(char, rates) > 0) ? `${kept}—` : "";
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
