/**
 * Reading mode's clock: new lines wait for the reader, and the world runs only
 * while nothing waits. Pure: each step says what to set the clock's speed to;
 * the clock and its echoes belong to the caller.
 */

export interface ReadingClock {
  readonly on: boolean;
  /** The speed when reading mode was turned on: what leaving puts back. */
  readonly found: number | undefined;
  /** The speed the clock should show; any other is someone else's doing. */
  readonly expected: number | undefined;
  /** Replies being sent: the world waits for them before it runs again. */
  readonly sending: number;
}

export type ReadingClockEvent =
  /** Turned on; `speed`: the clock's now; `waiting`: lines waiting. */
  | {
      readonly type: "enter";
      readonly speed: number | undefined;
      readonly waiting: number;
    }
  /** Turned off, any way but the clock taken back. */
  | { readonly type: "leave" }
  /** Lines waiting for the reader now. */
  | { readonly type: "waiting"; readonly waiting: number }
  /** A reply is being sent (the caller has shown what waited). */
  | { readonly type: "send" }
  /** It was sent, or failed; `waiting`: lines waiting now. */
  | { readonly type: "sent"; readonly waiting: number }
  /** The clock's speed, as it changed. */
  | { readonly type: "speed"; readonly speed: number | undefined };

export interface ReadingStep {
  readonly state: ReadingClock;
  /** Set the clock to this speed. */
  readonly set?: number;
  /** Someone else changed the speed: reading mode let go of the clock. */
  readonly takenBack?: true;
}

export const READING_OFF: ReadingClock = {
  on: false,
  found: undefined,
  expected: undefined,
  sending: 0,
};

/** The speed the world runs at while nothing waits: as found, 1 if paused. */
const running = (found: number | undefined): number =>
  found !== undefined && found > 0 ? found : 1;

/** Paused while a line waits, running while none does (not mid-send). */
function follow(state: ReadingClock, waiting: number): ReadingStep {
  if (state.sending > 0) return { state };
  const speed = waiting > 0 ? 0 : running(state.found);
  return speed === state.expected
    ? { state }
    : { state: { ...state, expected: speed }, set: speed };
}

/**
 * One step:
 *
 * - Turned on, it remembers the speed and follows what waits: a paused world with
 *   nothing waiting starts at 1x (it needs to run to bring a line);
 * - A line waiting pauses the world; none waiting runs it at the speed found (1
 *   if that was 0); a reply holds it until sent;
 * - Turned off, it puts back the speed it found, exactly, 0 included;
 * - A speed it did not set is the clock taken back: off, nothing put back.
 */
export function stepReadingClock(
  state: ReadingClock,
  event: ReadingClockEvent,
): ReadingStep {
  if (event.type === "enter")
    return state.on
      ? { state }
      : follow(
          { on: true, found: event.speed, expected: event.speed, sending: 0 },
          event.waiting,
        );
  if (!state.on) return { state };
  switch (event.type) {
    case "leave":
      return state.found === undefined || state.found === state.expected
        ? { state: READING_OFF }
        : { state: READING_OFF, set: state.found };
    case "waiting":
      return follow(state, event.waiting);
    case "send":
      return { state: { ...state, sending: state.sending + 1 } };
    case "sent":
      return follow(
        { ...state, sending: Math.max(0, state.sending - 1) },
        event.waiting,
      );
    case "speed":
      return event.speed === undefined || event.speed === state.expected
        ? { state }
        : { state: READING_OFF, takenBack: true };
  }
}
