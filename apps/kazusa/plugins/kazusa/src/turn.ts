/**
 * What one character has done in the brain run under way. A run is one moment:
 * a few lookups at most. One brain per character, so the character's id is the
 * key.
 */
export interface Turn {
  /** Lookups so far: `recall`, `look_up`, `list_chats`. */
  lookups: number;
}

const CELL = Symbol.for("kazusa.turn");
const FRESH = (): Turn => ({ lookups: 0 });

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

/** Long enough that a character can't flit between activities. */
export const ACTIVITY_GAP_MS = 120_000;

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
  return (holder[CHOICES] ??= new Map<string, ActivityChoice>());
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
