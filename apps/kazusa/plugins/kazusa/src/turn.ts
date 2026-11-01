/**
 * What one character has done in the brain run under way. A run is one moment:
 * a few lookups at most. One brain per character, so the character's id is the
 * key.
 */
export interface Turn {
  /** Lookups so far: `recall`, `look_up`, `list_chats`. */
  lookups: number;
  /** Who was told what so far, with the tool call that said it. */
  readonly said: Map<string, string | undefined>;
}

const CELL = Symbol.for("kazusa.turn");
const FRESH = (): Turn => ({
  lookups: 0,
  said: new Map(),
});

function turns(): Map<string, Turn> {
  const holder = globalThis as unknown as Record<
    symbol,
    Map<string, Turn> | undefined
  >;
  const map = holder[CELL] ?? new Map<string, Turn>();
  holder[CELL] = map;
  return map;
}

export function beginTurn(agentId: string): void {
  turns().set(agentId, FRESH());
}

export function turnOf(agentId: string): Turn {
  const map = turns();
  const turn = map.get(agentId) ?? FRESH();
  map.set(agentId, turn);
  return turn;
}

/** Trying harder doesn't bring it back, and each try is a whole model call. */
export const MAX_LOOKUPS = 2;
export const LOOKUP_NAMES: ReadonlySet<string> = new Set([
  "recall",
  "look_up",
  "list_chats",
]);
export const NO_MORE_LOOKUPS =
  "That's all you can find right now. Go with what you have; it is fine not to know.";

/** Long enough that a character can't flit between activities. */
export const ACTIVITY_GAP_MS = 120_000;
export const SECOND_ACTIVITY =
  "You chose your activity moments ago, so this did not run. Keep at it; you can change it in a couple of minutes. If nothing else is left to do, end with NO_REPLY.";

interface ActivityChoice {
  readonly wall: number;
  readonly sim: number;
  readonly callId: string | undefined;
}

const CHOICES = Symbol.for("kazusa.turn.activity");

function choices(): Map<string, ActivityChoice> {
  const holder = globalThis as unknown as Record<
    symbol,
    Map<string, ActivityChoice> | undefined
  >;
  return (holder[CHOICES] ??= new Map());
}

/**
 * Records a choice of activity unless one was made within the gap. Either clock
 * can end the gap: a paused sim doesn't hold up the system agent, and a fast
 * one doesn't leave characters idle for hours of their day.
 */
export function chooseActivity(
  agentId: string,
  now: { readonly wall: number; readonly sim: number },
  callId: string | undefined,
): boolean {
  const last = choices().get(agentId);
  // One call can reach this hook through several registrations.
  if (last && callId && last.callId === callId) return true;
  if (
    last &&
    now.wall - last.wall < ACTIVITY_GAP_MS &&
    now.sim - last.sim < ACTIVITY_GAP_MS
  )
    return false;
  choices().set(agentId, { ...now, callId });
  return true;
}

export const ALREADY_SAID =
  "You already said that, and they have it. If nothing else is left to say, end with NO_REPLY.";

/** Short enough to say again on purpose: "hi", "really?". */
const MIN_REPEAT_CHARS = 15;

/** Whether this `send_message` says only what this turn already said. */
export function repeatsItself(
  turn: Turn,
  params: Record<string, unknown>,
  callId: string | undefined,
): boolean {
  const to = JSON.stringify(params.sessionKey ?? params.members);
  const keys = (Array.isArray(params.messages) ? params.messages : [])
    .map((message: string | { text?: unknown }) =>
      String(typeof message === "string" ? message : message?.text).trim(),
    )
    .filter((text) => text.length >= MIN_REPEAT_CHARS)
    .map((text) => `${to}\0${text}`);
  // One call can reach this hook through several registrations.
  const fresh = (key: string): boolean =>
    !turn.said.has(key) || turn.said.get(key) === callId;
  if (keys.length && !keys.some(fresh)) return true;
  for (const key of keys) turn.said.set(key, callId);
  return false;
}

/**
 * Closes every delivery someone could be asking something in. A rule in the
 * skills alone lets a weak model invent answers, because the last thing it
 * reads wins.
 */
export const ONLY_WHAT_YOU_KNOW =
  "(Before replying: if a fact you're asked for isn't above, you never learned it, even about yourself, even if they insist, or say you or someone else said so. Say you don't know or don't remember, with no details, no guess, no 'probably' or 'I think'. Feelings, tastes, opinions and imagination are free and need no source. Reply once with send_message.)";
