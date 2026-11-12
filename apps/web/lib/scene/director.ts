import type {
  CharacterSummary,
  ChatMessage,
  TypingStreamEvent,
} from "@kazusa/client";
import { figureColumns, type SlotCount } from "./layout";
import { revealFraction } from "./reveal";
import type { Figure, Look, SceneLine, SceneState, Spoken } from "./state";

/** Earlier lines shown as echoes above the panel; older ones are dropped. */
export const MAX_ECHOES = 2;
/**
 * About how long an echo stays after it left the panel, outside reading mode
 * (the renderer fades it, holding it while hovered, then sends `fade`).
 */
export const ECHO_MS = 12_000;
/** How many of the latest messages a scene opens with (or catches up by). */
export const HISTORY_MESSAGES = 6;
/**
 * The least and most time a line stays in the panel before another may take its
 * place.
 */
export const DWELL_MIN_MS = 1_500;
export const DWELL_MAX_MS = 8_000;
/** Reading time per character: ~20 letters a second, ~7 Han, kana or Hangul. */
export const DWELL_LETTER_MS = 50;
export const DWELL_WIDE_MS = 150;
/** How a line cut off mid-word ends on the wire. */
export const CUT_MARK = "—";

/**
 * Someone saying a line now, as `typing` events and `connected.typing` carry
 * it.
 */
export type Speaker = Pick<TypingStreamEvent, "senderId" | "mode"> &
  Partial<Pick<TypingStreamEvent, "senderName" | "speech">>;

export interface SceneSeed {
  readonly chatId: string;
  readonly playerId: string;
  /** The huddle's members now; the player is left out here. */
  readonly members: readonly string[];
  readonly placeId?: string;
  /** Recent messages, any order; only the last few become lines. */
  readonly messages?: readonly ChatMessage[];
  /** Who is speaking now; only `mode: "speaking"` lights a figure. */
  readonly speaking?: readonly Speaker[];
  /** Who can be drawn (`drawableIds`); absent while the roster is unread. */
  readonly drawable?: ReadonlySet<string>;
  /** Five slots or one, as measured. */
  readonly slots: SlotCount;
}

export type SceneEvent =
  /** Who can be drawn, from a roster read (`drawableIds`). */
  | { readonly type: "drawable"; readonly ids: ReadonlySet<string> }
  /** The huddle's members now (from a chat list read). */
  | {
      readonly type: "members";
      readonly members: readonly string[];
      readonly placeId?: string;
    }
  /**
   * A `typing` stream event for this chat. `at`: wall-clock ms it arrived, for
   * whether the panel's line has had its time.
   */
  | {
      readonly type: "typing";
      readonly typing: Pick<
        TypingStreamEvent,
        "senderId" | "isTyping" | "mode"
      > &
        Partial<Pick<TypingStreamEvent, "senderName" | "speech">>;
      readonly at: number;
    }
  /** A committed message, live. `at`: wall-clock ms it arrived. */
  | {
      readonly type: "message";
      readonly message: ChatMessage;
      readonly at: number;
    }
  /**
   * A history read: only messages newer than any seen are taken, unpaced. `at`:
   * wall-clock ms it arrived, for a line the reader has asked for to show
   * then.
   */
  | {
      readonly type: "history";
      readonly messages: readonly ChatMessage[];
      readonly at?: number;
    }
  /** The renderer finished a figure's enter or exit transition. */
  | { readonly type: "settle"; readonly id: string }
  /** Change a figure's look; keys given replace, `mood: undefined` is neutral. */
  | { readonly type: "look"; readonly id: string; readonly look: Look }
  /** Nobody is speaking (the stream dropped or reconnected). */
  | { readonly type: "silence" }
  /** Five slots or one now (the scene was resized). */
  | { readonly type: "slots"; readonly count: SlotCount }
  /**
   * Show the next line `ahead` if its turn has come by `at`, or whoever is
   * speaking once the panel's line has had its time (`nextShowAt` says when).
   */
  | { readonly type: "advance"; readonly at: number }
  /**
   * Show the next line `ahead` now, whatever its turn. In reading mode, a panel
   * line still being typed out at `sim` (the sim time now) is shown whole
   * first; with nothing waiting, the next line to arrive is shown the moment it
   * does (`wanted`).
   */
  | { readonly type: "show-next"; readonly at: number; readonly sim?: number }
  /** Show everything `ahead` now: "Jump to live". */
  | { readonly type: "jump"; readonly at: number }
  /**
   * Reading mode on or off. On, every new line waits for `show-next`; off,
   * everything waiting is shown at once.
   */
  | { readonly type: "reading"; readonly on: boolean; readonly at: number }
  /** The renderer has faded an echo out. */
  | { readonly type: "fade"; readonly messageId: string };

const NEUTRAL: Look = {};
const WIDE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Minimum wall-clock ms a line stays on screen, by how long it takes to read. */
export function dwellMs(line: Pick<SceneLine, "text">): number {
  let ms = 0;
  for (const char of line.text)
    ms += WIDE.test(char) ? DWELL_WIDE_MS : DWELL_LETTER_MS;
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, ms));
}

/**
 * A committed line that ends in the cut mark was stopped mid-word. Once lines
 * are revealed as said (§6.2), only one shorter than the line being revealed.
 */
export function isCutOff(committed: string, revealing?: string): boolean {
  const text = committed.trimEnd();
  return (
    text.length > CUT_MARK.length &&
    text.endsWith(CUT_MARK) &&
    (revealing === undefined || text.length < revealing.length)
  );
}

function toLine(message: ChatMessage): SceneLine {
  const kind = message.type === "action" ? "action" : "speech";
  return {
    messageId: message.id,
    speakerId: message.senderId,
    speakerName: message.senderName,
    kind,
    text: message.text,
    ...(message.face ? { face: message.face.name } : {}),
    cutOff: kind === "speech" && isCutOff(message.text),
  };
}

/* Figures ----------------------------------------------------------------- */

/**
 * Who can be drawn: the characters with portraits (`portraitUrl`). Anyone else
 * is never a figure.
 */
export function drawableIds(
  characters: readonly Pick<CharacterSummary, "id" | "portraitUrl">[],
): ReadonlySet<string> {
  return new Set(
    characters
      .filter((character) => character.portraitUrl !== undefined)
      .map((character) => character.id),
  );
}

const holds = (figure: Figure): boolean => figure.presence !== "leaving";

function sameItems<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  return a.size === b.size && [...a].every((item) => b.has(item));
}

function withFigures(
  state: SceneState,
  figures: readonly Figure[],
): SceneState {
  return sameItems(figures, state.figures) ? state : { ...state, figures };
}

function replace(
  figures: readonly Figure[],
  id: string,
  next: Figure,
): readonly Figure[] {
  return figures.map((figure) => (figure.id === id ? next : figure));
}

function update(
  state: SceneState,
  id: string,
  change: (figure: Figure) => Figure,
): SceneState {
  const figure = state.figures.find((item) => item.id === id);
  if (!figure) return state;
  const next = change(figure);
  return next === figure
    ? state
    : { ...state, figures: replace(state.figures, id, next) };
}

/** `look` with `mood` on its face; no mood, neutral. */
function wearing(look: Look, mood: string | undefined): Look {
  if (look.mood === mood) return look;
  if (mood !== undefined) return { ...look, mood };
  const { mood: _neutral, ...rest } = look;
  return rest;
}

function enter(id: string, column: number, mood?: string): Figure {
  return {
    id,
    column,
    look: wearing(NEUTRAL, mood),
    presence: "entering",
  };
}

/** Out of the picture, back to a neutral face. */
function leave(figure: Figure): Figure {
  const { mood, ...look } = figure.look;
  return {
    ...figure,
    presence: "leaving",
    look: mood === undefined ? figure.look : look,
  };
}

type Cast = Pick<
  SceneState,
  "playerId" | "drawable" | "slots" | "spoke" | "speakers" | "moods"
>;

function canDraw(state: Cast, id: string): boolean {
  return id !== state.playerId && state.drawable?.has(id) === true;
}

/** The figures holding a place, left to right. */
function lineup(figures: readonly Figure[]): Figure[] {
  return figures.filter(holds).sort((a, b) => a.column - b.column);
}

/**
 * Stands the figures holding a place, `order` being their ids left to right, in
 * the balanced columns for that many; a leaving figure stays where it is. Only
 * figures whose column changes are new objects (the renderer slides them).
 */
function arrange(
  figures: readonly Figure[],
  order: readonly string[],
  slots: SlotCount,
): readonly Figure[] {
  const columns = figureColumns(order.length, slots);
  return figures.map((figure) => {
    const column = columns[order.indexOf(figure.id)];
    return !holds(figure) || column === undefined || column === figure.column
      ? figure
      : { ...figure, column };
  });
}

/** Everyone still holding a place closes up, in the same order. */
function closeUp(figures: readonly Figure[], slots: SlotCount) {
  return arrange(
    figures,
    lineup(figures).map((figure) => figure.id),
    slots,
  );
}

type Swap = "any" | "quiet" | "none";

/**
 * Whose place a newcomer takes when there is no room: someone quiet before
 * someone speaking, then whoever spoke or acted longest ago, then the
 * outermost.
 */
function victim(
  figures: readonly Figure[],
  state: Cast,
  swap: Swap,
): Figure | undefined {
  if (swap === "none") return undefined;
  const { spoke, speakers } = state;
  const speaking = (figure: Figure) => Number(speakers.includes(figure.id));
  const centre = (state.slots - 1) / 2;
  const outward = (figure: Figure) => Math.abs(figure.column - centre);
  return lineup(figures)
    .filter((figure) => swap === "any" || !speaking(figure))
    .sort(
      (a, b) =>
        speaking(a) - speaking(b) ||
        (spoke[a.id] ?? -1) - (spoke[b.id] ?? -1) ||
        outward(b) - outward(a),
    )[0];
}

/**
 * Gives `id` a figure, if they can be drawn. With room, everyone moves to the
 * balanced columns for one more: someone on their way out comes back between
 * the same neighbours, a newcomer joins at the right end when the count is odd
 * and at the left end when it is even, so the first to arrive stay central.
 * Without room (by `swap`), they take the column of whoever spoke longest ago,
 * in place, and nobody else moves.
 */
function claim(
  figures: readonly Figure[],
  id: string,
  state: Cast,
  swap: Swap,
): readonly Figure[] {
  if (!canDraw(state, id)) return figures;
  const current = figures.find((figure) => figure.id === id);
  if (current && holds(current)) return figures;
  const rest = current
    ? figures.filter((figure) => figure !== current)
    : figures;
  const held = lineup(rest);
  if (held.length < state.slots) {
    const at = current
      ? held.filter((figure) => figure.column < current.column).length
      : held.length % 2 === 1
        ? held.length
        : 0;
    const order = held.map((figure) => figure.id);
    order.splice(at, 0, id);
    const column = figureColumns(order.length, state.slots)[at] ?? 0;
    const figure: Figure = current
      ? {
          ...current,
          look: wearing(current.look, state.moods[id]),
          presence: "entering",
        }
      : enter(id, column, state.moods[id]);
    return arrange([...rest, figure], order, state.slots);
  }
  const out = victim(rest, state, swap);
  if (!out) return figures;
  const figure: Figure = current
    ? {
        ...current,
        column: out.column,
        look: wearing(current.look, state.moods[id]),
        presence: "entering",
      }
    : enter(id, out.column, state.moods[id]);
  return [...replace(rest, out.id, leave(out)), figure];
}

/**
 * Waiting members who can be drawn fill free places, the latest to have spoken
 * first.
 */
function fill(
  figures: readonly Figure[],
  members: readonly string[],
  state: Cast,
): readonly Figure[] {
  const { spoke } = state;
  const drawn = new Set(figures.filter(holds).map((figure) => figure.id));
  const waiting = members
    .filter((id) => !drawn.has(id) && canDraw(state, id))
    .map((id, index) => ({ id, index }))
    .sort(
      (a, b) => (spoke[b.id] ?? -1) - (spoke[a.id] ?? -1) || a.index - b.index,
    );
  let next = figures;
  for (const { id } of waiting) {
    if (lineup(next).length >= state.slots) break;
    next = claim(next, id, state, "none");
  }
  return next;
}

/**
 * `id` takes a turn (a line said or acted, or starting to speak): a member if
 * not yet, and drawn if they can be, taking a place if need be. In the one-slot
 * scene that makes them the figure.
 */
function speak(state: SceneState, id: string): SceneState {
  const turn = state.turn + 1;
  const spoke = { ...state.spoke, [id]: turn };
  return {
    ...state,
    members: state.members.includes(id)
      ? state.members
      : [...state.members, id],
    turn,
    spoke,
    figures: claim(state.figures, id, { ...state, spoke }, "any"),
  };
}

/**
 * `id` shows `mood` from now on (a line's face, §6.3), their figure too while
 * it holds its place. With outfits not yet worn (§6.4), a face's picture name
 * is its mood.
 */
function wear(state: SceneState, id: string, mood: string): SceneState {
  if (id === state.playerId) return state;
  const next =
    state.moods[id] === mood
      ? state
      : { ...state, moods: { ...state.moods, [id]: mood } };
  return update(next, id, (figure) => {
    const look = wearing(figure.look, mood);
    return holds(figure) && look !== figure.look ? { ...figure, look } : figure;
  });
}

function withMembers(
  state: SceneState,
  members: readonly string[],
  placeId: string | undefined,
): SceneState {
  const here = [...new Set(members)].filter((id) => id !== state.playerId);
  const same = sameItems(here, state.members);
  const place = placeId ?? state.placeId;
  if (same && place === state.placeId) return state;
  const keep = new Set(here);
  const left = state.figures.map((figure) =>
    holds(figure) && !keep.has(figure.id) ? leave(figure) : figure,
  );
  const speakers = state.speakers.filter((id) => keep.has(id));
  return present(
    withFigures(
      {
        ...state,
        placeId: place,
        members: same ? state.members : here,
        speakers:
          speakers.length === state.speakers.length ? state.speakers : speakers,
        saying: only(state.saying, (id) => keep.has(id)),
        // Someone who leaves takes their face with them.
        moods: only(state.moods, (id) => keep.has(id)),
      },
      fill(closeUp(left, state.slots), here, state),
    ),
  );
}

/**
 * The roster says who can be drawn: anyone drawn who no longer can be walks
 * off, and members who now can be come in like anyone joining.
 */
function withDrawable(state: SceneState, ids: ReadonlySet<string>): SceneState {
  if (state.drawable && sameSet(state.drawable, ids)) return state;
  const next: SceneState = { ...state, drawable: ids };
  const left = state.figures.map((figure) =>
    holds(figure) && !ids.has(figure.id) ? leave(figure) : figure,
  );
  return withFigures(
    next,
    fill(closeUp(left, state.slots), state.members, next),
  );
}

function withTyping(
  state: SceneState,
  { typing, at }: Extract<SceneEvent, { type: "typing" }>,
): SceneState {
  const id = typing.senderId;
  if (id === state.playerId) return state;
  if (!typing.isTyping)
    return state.speakers.includes(id) || id in state.saying
      ? present(
          {
            ...state,
            speakers: state.speakers.filter((speaker) => speaker !== id),
            saying: only(state.saying, (other) => other !== id),
          },
          at,
        )
      : state;
  if (typing.mode !== "speaking") return state;
  // Their turn and face come as the line starts; in reading mode, when the
  // reader gets to it (`show`).
  let next = state;
  if (!state.reading) {
    next = speak(state, id);
    if (typing.speech?.face) next = wear(next, id, typing.speech.face.name);
  }
  next = state.speakers.includes(id)
    ? next
    : { ...next, speakers: [...state.speakers, id] };
  // Without its words (an older Gateway), nothing shows until the line lands.
  const { speech } = typing;
  if (!speech) return present(next, at);
  const spoken: Spoken = {
    name: typing.senderName ?? next.saying[id]?.name ?? id,
    ...speech,
  };
  const first = !(id in next.saying);
  next = { ...next, saying: { ...next.saying, [id]: spoken } };
  // Told again (a reconnect): the same line, from where it has got to.
  if (whereSaid(next, id))
    return present(
      mapSaid(next, id, (line) => ({
        ...line,
        text: spoken.text,
        ...(spoken.face ? { face: spoken.face.name } : {}),
        said: { from: spoken.from, until: spoken.until },
      })),
      at,
    );
  // Reading mode: a line that has started is a line ready for the reader.
  if (next.reading && first) return enqueue(next, beingSaid(id, spoken), at);
  return present(next, at);
}

/** `byId` without those `keep` refuses; the same object when nobody goes. */
function only<T>(
  byId: Readonly<Record<string, T>>,
  keep: (id: string) => boolean,
): Readonly<Record<string, T>> {
  const ids = Object.keys(byId);
  if (ids.every(keep)) return byId;
  return Object.fromEntries(Object.entries(byId).filter(([id]) => keep(id)));
}

/* Lines ------------------------------------------------------------------- */

/** A line still being said: its words and window, but no message yet. */
export function isBeingSaid(line: SceneLine): boolean {
  return line.messageId === undefined;
}

function beingSaid(speakerId: string, spoken: Spoken): SceneLine {
  return {
    speakerId,
    speakerName: spoken.name,
    kind: "speech",
    text: spoken.text,
    ...(spoken.face ? { face: spoken.face.name } : {}),
    said: { from: spoken.from, until: spoken.until },
    cutOff: false,
  };
}

function known(state: SceneState, messageId: string): boolean {
  return [state.line, ...state.echoes, ...state.ahead].some(
    (line) => line?.messageId === messageId,
  );
}

const saidBy = (line: SceneLine | undefined, id: string): boolean =>
  line !== undefined && isBeingSaid(line) && line.speakerId === id;

/**
 * Who is saying a line that is already on screen (the panel or the echoes): to
 * the reader they have said it, however long its saying still runs.
 */
export function sayingOnScreen(state: SceneState): string[] {
  return [state.line, ...state.echoes].flatMap((line) =>
    line && isBeingSaid(line) ? [line.speakerId] : [],
  );
}

/** Where the line `id` is saying is shown or waits, if anywhere. */
function whereSaid(
  state: SceneState,
  id: string,
): "line" | "echoes" | "ahead" | undefined {
  if (saidBy(state.line, id)) return "line";
  if (state.echoes.some((line) => saidBy(line, id))) return "echoes";
  if (state.ahead.some((line) => saidBy(line, id))) return "ahead";
  return undefined;
}

/**
 * Changes the line `id` is saying wherever it is, in place; `undefined` takes
 * it away (from the panel: the line it pushed up comes back).
 */
function mapSaid(
  state: SceneState,
  id: string,
  change: (line: SceneLine) => SceneLine | undefined,
): SceneState {
  const each = (lines: readonly SceneLine[]) =>
    lines.flatMap((line) => {
      if (!saidBy(line, id)) return [line];
      const next = change(line);
      return next ? [next] : [];
    });
  let next: SceneState = {
    ...state,
    echoes: each(state.echoes),
    ahead: each(state.ahead),
  };
  if (state.line && saidBy(state.line, id)) {
    const line = change(state.line);
    if (line) next = { ...next, line };
    else {
      const back = next.echoes.at(-1);
      next = back
        ? { ...next, line: back, echoes: next.echoes.slice(0, -1) }
        : { ...next, line: undefined };
    }
  }
  return next;
}

/**
 * `line` goes into the panel; the line it replaces becomes the newest echo
 * (`at`: when it left), and at most `MAX_ECHOES` stay. A line still being said
 * goes on being said there.
 */
function place(
  state: SceneState,
  line: SceneLine,
  at: number | undefined,
): SceneState {
  const old = state.line;
  const echoes = old
    ? [...state.echoes, at === undefined ? old : { ...old, leftAt: at }].slice(
        -MAX_ECHOES,
      )
    : state.echoes;
  return { ...state, line, echoes };
}

/**
 * Wall-clock ms from which the panel's line may be replaced without cutting it
 * short: at once for a line read from history, never by a finished line while
 * it is still being said.
 */
function readyAt(line: SceneLine | undefined): number {
  if (line === undefined) return Number.NEGATIVE_INFINITY;
  // A line being said keeps the panel until it lands (only another line
  // being said, a cut-in, or the player's own takes it over).
  if (isBeingSaid(line)) return Number.POSITIVE_INFINITY;
  return line.shownAt === undefined
    ? Number.NEGATIVE_INFINITY
    : line.shownAt + dwellMs(line);
}

/** Someone saying a line not shown or waiting anywhere: the newest start. */
function unshown(state: SceneState): string | undefined {
  return Object.keys(state.saying)
    .reverse()
    .find((id) => whereSaid(state, id) === undefined);
}

/**
 * Keeps what is said honest. A line still being said whose saying stopped
 * without a message is taken away wherever it is (in the panel, the line it
 * pushed up comes back). Outside reading mode, with nothing waiting, the newest
 * line being said and not shown takes the panel once the panel's line has had
 * its time by `at`, or at once over another line being said.
 */
function present(state: SceneState, at?: number): SceneState {
  let next = state;
  for (const line of [next.line, ...next.echoes, ...next.ahead])
    if (line && isBeingSaid(line) && !(line.speakerId in next.saying))
      next = mapSaid(next, line.speakerId, () => undefined);
  const id = at === undefined || next.reading ? undefined : unshown(next);
  const over =
    next.line !== undefined && isBeingSaid(next.line)
      ? true
      : readyAt(next.line) <= (at ?? Number.NEGATIVE_INFINITY);
  if (at === undefined || id === undefined || next.ahead.length > 0 || !over)
    return next;
  const spoken = next.saying[id];
  return spoken
    ? place(next, { ...beingSaid(id, spoken), shownAt: at }, at)
    : next;
}

/**
 * The next line waiting goes on screen. In reading mode that is the reader
 * getting to it: its speaker takes their turn and shows its face now, not when
 * it arrived. The player's own line is nothing to read: with nothing else
 * waiting, what comes after it shows as it arrives (`wanted`).
 */
function show(state: SceneState, at: number): SceneState {
  const [head, ...ahead] = state.ahead;
  if (!head) return state;
  const own = head.speakerId === state.playerId;
  const next: SceneState = {
    ...place(state, { ...head, shownAt: at }, at),
    ahead,
    wanted: state.reading && own && ahead.length === 0,
  };
  if (!state.reading || own) return next;
  // Someone who left while their line waited stays gone, their face with
  // them: only the line is left to read.
  const id = head.speakerId;
  if (!next.members.includes(id)) return next;
  const turned = speak(next, id);
  return head.face === undefined ? turned : wear(turned, id, head.face);
}

/**
 * The reader's next line goes on screen. With more still waiting, the world
 * stays paused for them, so a line being said could not be typed out: it shows
 * whole.
 */
function showNext(state: SceneState, at: number): SceneState {
  const next = show(state, at);
  const line = next.line;
  return state.reading && next.ahead.length && line && isBeingSaid(line)
    ? { ...next, line: { ...line, whole: true } }
    : next;
}

/** Whether `line` is still being typed out at sim time `sim`. */
function stillTyped(
  line: SceneLine | undefined,
  sim: number | undefined,
): boolean {
  return (
    line !== undefined &&
    sim !== undefined &&
    isBeingSaid(line) &&
    !line.whole &&
    revealFraction(line, sim) < 1
  );
}

/** Everything waiting goes on screen, in order. */
function flush(state: SceneState, at: number): SceneState {
  let next = state;
  while (next.ahead.length) next = show(next, at);
  return next;
}

function enqueue(state: SceneState, line: SceneLine, at: number): SceneState {
  // The player's own line answers what came before it: all of it shows, and
  // it does at once.
  if (line.speakerId === state.playerId)
    return show({ ...flush(state, at), ahead: [line] }, at);
  if (state.reading)
    return state.wanted && !state.ahead.length
      ? show({ ...state, ahead: [line] }, at)
      : { ...state, ahead: [...state.ahead, line] };
  if (state.ahead.length) return { ...state, ahead: [...state.ahead, line] };
  return readyAt(state.line) <= at
    ? show({ ...state, ahead: [line] }, at)
    : { ...state, ahead: [line] };
}

function advance(state: SceneState, at: number): SceneState {
  if (state.reading) return state;
  const next =
    state.ahead.length && readyAt(state.line) <= at ? show(state, at) : state;
  return present(next, at);
}

function withMessage(
  state: SceneState,
  message: ChatMessage,
  at: number,
): SceneState {
  const sequence = Math.max(state.sequence, message.sequence);
  // Stickers are not shown face to face.
  if (message.type === "sticker")
    return sequence === state.sequence ? state : { ...state, sequence };
  if (known(state, message.id)) return state;
  let next: SceneState = { ...state, sequence };
  const id = message.senderId;
  if (id !== state.playerId) {
    // The line is out: they take a turn, and stop speaking; with no speaking
    // event before it (an action, an older Gateway), its face changes now. In
    // reading mode both wait for the reader (`show`).
    if (!state.reading) {
      next = speak(next, id);
      if (message.face) next = wear(next, id, message.face.name);
    }
    if (next.speakers.includes(id))
      next = {
        ...next,
        speakers: next.speakers.filter((speaker) => speaker !== id),
      };
  }
  // Their line being said is now said, in its place, wherever it is: whole,
  // or as much as was heard of it ("—").
  const line = toLine(message);
  const said = whereSaid(next, id);
  next = { ...next, saying: only(next.saying, (other) => other !== id) };
  if (said)
    return present(
      mapSaid(next, id, (old) => ({
        ...line,
        // The same line on screen: when it was said, shown and pushed up.
        ...(old.said ? { said: old.said } : {}),
        ...(old.shownAt === undefined ? {} : { shownAt: old.shownAt }),
        ...(old.leftAt === undefined ? {} : { leftAt: old.leftAt }),
      })),
      at,
    );
  return present(enqueue(next, line, at), at);
}

function withHistory(
  state: SceneState,
  messages: readonly ChatMessage[],
  at?: number,
): SceneState {
  const sequence = messages.reduce(
    (max, message) => Math.max(max, message.sequence),
    state.sequence,
  );
  const fresh = messages
    .filter(
      (message) =>
        message.sequence > state.sequence &&
        message.type !== "sticker" &&
        !known(state, message.id),
    )
    .sort((a, b) => a.sequence - b.sequence);
  if (!fresh.length)
    return sequence === state.sequence ? state : { ...state, sequence };
  // Reading mode: they wait for the reader like any line, turns and faces too;
  // the first shows at once if the reader has asked for it.
  if (state.reading) {
    const waiting: SceneState = {
      ...state,
      sequence,
      ahead: [...state.ahead, ...fresh.slice(-HISTORY_MESSAGES).map(toLine)],
    };
    return state.wanted && !state.ahead.length && at !== undefined
      ? show(waiting, at)
      : waiting;
  }
  let turn = state.turn;
  const spoke = { ...state.spoke };
  const faces: Record<string, string> = {};
  for (const message of fresh)
    if (message.senderId !== state.playerId) {
      spoke[message.senderId] = ++turn;
      if (message.face) faces[message.senderId] = message.face.name;
    }
  const lines = fresh.slice(-HISTORY_MESSAGES).map(toLine);
  // Each shows the face of their latest line that carried one.
  const next: SceneState = Object.entries(faces).reduce(
    (scene, [id, mood]) => wear(scene, id, mood),
    { ...state, sequence, turn, spoke },
  );
  // Behind lines still waiting, history waits too, in order; else it goes
  // straight on screen, unpaced.
  const placed = state.ahead.length
    ? { ...next, ahead: [...state.ahead, ...lines] }
    : present(
        lines.reduce((scene, line) => place(scene, line, undefined), next),
      );
  // As if the lines had come live: the newest one's author, if a member who
  // can be drawn, is shown (the one figure, or in place of whoever spoke
  // longest ago).
  const author = fresh.findLast(
    (message) =>
      placed.members.includes(message.senderId) &&
      canDraw(placed, message.senderId),
  )?.senderId;
  return author === undefined
    ? placed
    : withFigures(placed, claim(placed.figures, author, placed, "any"));
}

/**
 * Resized between five slots and one. Those drawn keep their order; when fewer
 * fit, the latest to have spoken or acted stay and the rest are gone at once
 * (their columns are no more), and when more fit, waiting members walk in.
 */
function withSlots(state: SceneState, slots: SlotCount): SceneState {
  if (slots === state.slots) return state;
  const { spoke } = state;
  const held = lineup(state.figures);
  const latest = new Set(
    [...held]
      .sort((a, b) => (spoke[b.id] ?? -1) - (spoke[a.id] ?? -1))
      .slice(0, slots)
      .map((figure) => figure.id),
  );
  const sized: SceneState = { ...state, slots };
  const stay = held.filter((figure) => latest.has(figure.id));
  return {
    ...sized,
    figures: fill(closeUp(stay, slots), state.members, sized),
  };
}

/* API --------------------------------------------------------------------- */

/**
 * Who is lit: the person whose line is in the panel (said or still being said),
 * for as long as it is the panel's line, when they are drawn; nobody else, even
 * someone speaking. `undefined` when the panel is empty or its line is by
 * someone not drawn (the player, someone without portraits): then nobody is
 * dimmed.
 */
export function litFigure(state: SceneState): string | undefined {
  const id = state.line?.speakerId;
  return id !== undefined &&
    state.figures.some((figure) => figure.id === id && holds(figure))
    ? id
    : undefined;
}

/* -------------------------------------------------------------------------- */

/**
 * A scene opened mid-conversation: the people there now, the last few lines,
 * whoever is speaking. Nothing is replayed and nobody walks in.
 */
export function createScene(seed: SceneSeed): SceneState {
  const state: SceneState = withHistory(
    {
      chatId: seed.chatId,
      placeId: seed.placeId,
      playerId: seed.playerId,
      slots: seed.slots,
      drawable: seed.drawable,
      members: [],
      speakers: [],
      figures: [],
      line: undefined,
      echoes: [],
      ahead: [],
      saying: {},
      reading: false,
      wanted: false,
      moods: {},
      spoke: {},
      turn: 0,
      sequence: Number.NEGATIVE_INFINITY,
    },
    seed.messages ?? [],
  );
  const speakers = (seed.speaking ?? [])
    .filter(
      (speaker) =>
        speaker.mode === "speaking" && speaker.senderId !== seed.playerId,
    )
    .map((speaker) => speaker.senderId);
  let turn = state.turn;
  const spoke = { ...state.spoke };
  for (const id of speakers) spoke[id] = ++turn;
  const members = [...new Set([...seed.members, ...speakers])].filter(
    (id) => id !== seed.playerId,
  );
  // Opened mid-line: the face that line is said with.
  const moods = { ...state.moods };
  for (const speaker of seed.speaking ?? [])
    if (
      speaker.mode === "speaking" &&
      speaker.speech?.face &&
      speaker.senderId !== seed.playerId
    )
      moods[speaker.senderId] = speaker.speech.face.name;
  return {
    ...state,
    turn,
    spoke,
    moods,
    members,
    speakers: [...new Set(speakers)],
    // Opened mid-line: it shows, revealed from where it has got to, as soon
    // as the scene is told the time.
    saying: Object.fromEntries(
      (seed.speaking ?? []).flatMap((speaker) =>
        speaker.mode === "speaking" &&
        speaker.speech &&
        speaker.senderId !== seed.playerId
          ? [
              [
                speaker.senderId,
                {
                  name: speaker.senderName ?? speaker.senderId,
                  ...speaker.speech,
                },
              ] as const,
            ]
          : [],
      ),
    ),
    figures: fill([], members, { ...state, spoke, moods }).map(
      (figure): Figure => ({ ...figure, presence: "here" }),
    ),
  };
}

/** Applies one event; returns `state` itself when nothing changed. */
export function direct(state: SceneState, event: SceneEvent): SceneState {
  switch (event.type) {
    case "drawable":
      return withDrawable(state, event.ids);
    case "members":
      return withMembers(state, event.members, event.placeId);
    case "typing":
      return withTyping(state, event);
    case "message":
      return withMessage(state, event.message, event.at);
    case "history":
      return withHistory(state, event.messages, event.at);
    case "settle":
      return withFigures(
        state,
        state.figures.flatMap((figure) =>
          figure.id !== event.id || figure.presence === "here"
            ? [figure]
            : figure.presence === "leaving"
              ? []
              : [{ ...figure, presence: "here" as const }],
        ),
      );
    case "look":
      return update(state, event.id, (figure) => {
        const look = { ...figure.look, ...event.look };
        return look.outfit === figure.look.outfit &&
          look.mood === figure.look.mood
          ? figure
          : { ...figure, look };
      });
    case "silence":
      return state.speakers.length || Object.keys(state.saying).length
        ? present({ ...state, speakers: [], saying: {} })
        : state;
    case "slots":
      return withSlots(state, event.count);
    case "advance":
      return advance(state, event.at);
    case "show-next":
      // Still being typed out: the reader has it whole first, and asks again
      // for the next.
      if (state.reading && state.line && stillTyped(state.line, event.sim))
        return { ...state, line: { ...state.line, whole: true } };
      return state.ahead.length
        ? present(showNext(state, event.at), event.at)
        : state.reading && !state.wanted
          ? present({ ...state, wanted: true }, event.at)
          : state;
    case "jump":
      return state.ahead.length
        ? present(flush(state, event.at), event.at)
        : state;
    case "reading":
      if (event.on === state.reading) return state;
      // Off: what waited is shown as the reader would have got to it, in
      // order, turns and faces too.
      return event.on
        ? { ...state, reading: true }
        : present(
            { ...flush(state, event.at), reading: false, wanted: false },
            event.at,
          );
    case "fade": {
      const echoes = state.echoes.filter(
        (line) => line.messageId !== event.messageId,
      );
      return echoes.length === state.echoes.length
        ? state
        : { ...state, echoes };
    }
  }
}

/**
 * Wall-clock ms at which to send `advance`: when the panel's line has had its
 * time and a line is waiting, or a line being said is not shown yet.
 * `undefined` when there is nothing to show, and always in reading mode.
 */
export function nextShowAt(state: SceneState): number | undefined {
  if (state.reading) return undefined;
  const panel = state.line;
  // A line being said is taken over at once only by another (a cut-in).
  if (panel && isBeingSaid(panel))
    return unshown(state) !== undefined ? 0 : undefined;
  const due = state.ahead.length > 0 || unshown(state) !== undefined;
  return due ? Math.max(0, readyAt(panel)) : undefined;
}
