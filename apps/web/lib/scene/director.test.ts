import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@kazusa/client";
import {
  DWELL_MAX_MS,
  DWELL_MIN_MS,
  HISTORY_MESSAGES,
  MAX_ECHOES,
  createScene,
  direct,
  drawableIds,
  dwellMs,
  isBeingSaid,
  isCutOff,
  litFigure,
  nextShowAt,
  type SceneEvent,
  type SceneSeed,
} from "./director";
import { NARROW_SLOTS, WIDE_SLOTS, figureColumns } from "./layout";
import type { SceneLine, SceneState } from "./state";

const PLAYER = "user:you";
/** Everyone in these tests has portraits but "p" (and the player). */
const PORTRAITS: ReadonlySet<string> = new Set([
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
  "g",
  "z",
]);
let sequence = 0;
function msg(
  senderId: string,
  text: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  sequence += 1;
  return {
    id: `m${sequence}`,
    requestId: `r${sequence}`,
    sequence,
    senderId,
    senderName: senderId === PLAYER ? "Player Name" : senderId.toUpperCase(),
    text,
    timestamp: sequence * 1000,
    ...extra,
  };
}
const speaking = (senderId: string, isTyping = true, at = 0): SceneEvent => ({
  type: "typing",
  typing: { senderId, isTyping, mode: "speaking" },
  at,
});
/** A speaking event carrying its line, said across `from..until`. */
const saying = (
  senderId: string,
  line: string,
  from: number,
  until: number,
  at = from,
): SceneEvent => ({
  type: "typing",
  typing: {
    senderId,
    senderName: senderId.toUpperCase(),
    isTyping: true,
    mode: "speaking",
    speech: { text: line, from, until },
  },
  at,
});
const said = (message: ChatMessage, at = 0): SceneEvent => ({
  type: "message",
  message,
  at,
});
const acted = (senderId: string, at = 0): SceneEvent =>
  said(msg(senderId, "waves.", { type: "action" }), at);
const members = (...ids: string[]): SceneEvent => ({
  type: "members",
  members: [PLAYER, ...ids],
});
const drawable = (...ids: string[]): SceneEvent => ({
  type: "drawable",
  ids: new Set(ids),
});

function scene(seed: Partial<SceneSeed> = {}): SceneState {
  return createScene({
    chatId: "huddle",
    playerId: PLAYER,
    members: [PLAYER],
    slots: WIDE_SLOTS,
    drawable: PORTRAITS,
    ...seed,
  });
}
function run(state: SceneState, events: readonly SceneEvent[]): SceneState {
  return events.reduce(direct, state);
}
/** Id → [column, presence] for a compact table. */
function cast(state: SceneState) {
  return Object.fromEntries(
    state.figures.map((f) => [f.id, [f.column, f.presence]]),
  );
}
/** Who holds a place, left to right, as "id@column". */
function lineup(state: SceneState): string[] {
  return state.figures
    .filter((f) => f.presence !== "leaving")
    .sort((a, b) => a.column - b.column)
    .map((f) => `${f.id}@${f.column}`);
}
/** A line as "id:text", one being said as "id:~text", shown whole "~!". */
const text = (line: SceneLine) =>
  `${line.speakerId}:${isBeingSaid(line) ? (line.whole ? "~!" : "~") : ""}${line.text}`;
/** What shows: the echoes oldest first, then the panel's line. */
function shown(state: SceneState): string[] {
  return [...state.echoes, ...(state.line ? [state.line] : [])].map(text);
}
/** Everything there is to read: what shows, then what waits. */
const all = (state: SceneState): string[] => [
  ...shown(state),
  ...state.ahead.map(text),
];

describe("opening a scene", () => {
  it("starts from members now, the last few lines and who is speaking, with nobody walking in", () => {
    const history = Array.from({ length: 9 }, (_, i) =>
      msg(i % 2 ? "a" : "b", `line ${i}`),
    );
    const state = scene({
      members: [PLAYER, "a", "b", "c"],
      messages: [...history].reverse(),
      speaking: [
        {
          senderId: "c",
          senderName: "C",
          mode: "speaking",
          speech: { text: "Mid-line.", from: 0, until: 900 },
        },
        { senderId: PLAYER, mode: "speaking" },
      ],
      placeId: "cafe",
    });
    expect(state.members).toEqual(["a", "b", "c"]);
    expect(state.placeId).toBe("cafe");
    // The newest in the panel, the two before it as echoes.
    expect(shown(state)).toEqual(["b:line 6", "a:line 7", "b:line 8"]);
    expect(
      [state.line, ...state.echoes].every(
        (line) => line?.shownAt === undefined && line?.leftAt === undefined,
      ),
    ).toBe(true);
    // c is saying a line: shown, revealed from its window, as soon as the
    // scene is told the time.
    expect(nextShowAt(state)).toBe(0);
    expect(shown(direct(state, { type: "advance", at: 0 })).at(-1)).toBe(
      "c:~Mid-line.",
    );
    // The speaker in the middle, then the latest speakers to the right and
    // left of them.
    expect(cast(state)).toEqual({
      c: [2, "here"],
      b: [3, "here"],
      a: [1, "here"],
    });
    expect(state.sequence).toBe(history.at(-1)?.sequence);
    expect(HISTORY_MESSAGES).toBeGreaterThanOrEqual(3);
  });

  it("never draws the player and leaves members past five undrawn", () => {
    const state = scene({
      members: [PLAYER, "a", "b", "c", "d", "e", "f", "g"],
    });
    expect(lineup(state)).toEqual(["e@0", "c@1", "a@2", "b@3", "d@4"]);
    expect(state.members).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });

  it("opens the one-slot scene on whoever spoke or acted last", () => {
    const history = [
      msg("a", "first"),
      msg("b", "smiles.", { type: "action" }),
    ];
    const seed = {
      members: [PLAYER, "a", "b", "c"],
      messages: history,
      slots: NARROW_SLOTS,
    } as const;
    expect(cast(scene(seed))).toEqual({ b: [0, "here"] });
    expect(
      cast(scene({ ...seed, speaking: [{ senderId: "c", mode: "speaking" }] })),
    ).toEqual({ c: [0, "here"] });
  });

  it("tells who can be drawn from the roster: whoever has portraits", () => {
    expect(
      drawableIds([
        { id: "a", portraitUrl: "/kazusa/portrait?id=a&name=neutral&v=1" },
        { id: "p" },
      ]),
    ).toEqual(new Set(["a"]));
  });
});

describe("five slots", () => {
  it("stands one to five figures balanced about the middle, newcomers alternately at the right and left end", () => {
    const steps: [string[], string[]][] = [
      [["a"], ["a@2"]],
      [
        ["a", "b"],
        ["a@1", "b@3"],
      ],
      [
        ["a", "b", "c"],
        ["c@1", "a@2", "b@3"],
      ],
      [
        ["a", "b", "c", "d"],
        ["c@0", "a@1", "b@3", "d@4"],
      ],
      [
        ["a", "b", "c", "d", "e"],
        ["e@0", "c@1", "a@2", "b@3", "d@4"],
      ],
    ];
    let state = scene();
    for (const [ids, expected] of steps) {
      state = direct(state, members(...ids));
      expect(lineup(state)).toEqual(expected);
      expect(lineup(state).map((at) => Number(at.split("@")[1]))).toEqual(
        figureColumns(ids.length, WIDE_SLOTS),
      );
    }
    // Everyone walked in; nobody walked in twice.
    expect(state.figures.every((f) => f.presence === "entering")).toBe(true);
    expect(state.figures).toHaveLength(5);
  });

  it("closes up when someone leaves, keeping the order, while the leaver walks off where they stood", () => {
    let state = scene({ members: [PLAYER, "a", "b", "c", "d", "e"] });
    expect(lineup(state)).toEqual(["e@0", "c@1", "a@2", "b@3", "d@4"]);
    state = direct(state, members("b", "c", "d", "e"));
    expect(lineup(state)).toEqual(["e@0", "c@1", "b@3", "d@4"]);
    expect(cast(state).a).toEqual([2, "leaving"]);
    state = direct(state, members("b", "c", "d"));
    expect(lineup(state)).toEqual(["c@1", "b@2", "d@3"]);
    expect(cast(state).e).toEqual([0, "leaving"]);
    state = run(state, [
      { type: "settle", id: "a" },
      { type: "settle", id: "e" },
    ]);
    expect(Object.keys(cast(state)).sort()).toEqual(["b", "c", "d"]);
    // The figures who stayed are the same, moved: the renderer slides them.
    expect(state.figures.map((f) => f.presence)).toEqual([
      "here",
      "here",
      "here",
    ]);
  });

  it("brings back someone who returns before their exit ends, between the same neighbours", () => {
    let state = scene({ members: [PLAYER, "a", "b", "c"] });
    expect(lineup(state)).toEqual(["c@1", "a@2", "b@3"]);
    state = direct(state, members("b", "c"));
    expect(lineup(state)).toEqual(["c@1", "b@3"]);
    state = direct(state, members("a", "b", "c"));
    expect(lineup(state)).toEqual(["c@1", "a@2", "b@3"]);
    expect(cast(state).a).toEqual([2, "entering"]);
    expect(state.figures).toHaveLength(3);
  });

  it("moves and resizes nobody when people speak or act", () => {
    let state = scene({ members: [PLAYER, "a", "b", "c", "d"] });
    const before = lineup(state);
    state = run(state, [
      speaking("b"),
      said(msg("b", "hi")),
      acted("d"),
      speaking("a"),
      speaking("c"),
      said(msg("c", "and me")),
      speaking("a", false),
    ]);
    expect(lineup(state)).toEqual(before);
    expect(state.figures.every((f) => f.presence === "here")).toBe(true);
  });

  it("gives an undrawn speaker or actor the place of whoever spoke or acted longest ago, in place", () => {
    let state = scene({
      members: [PLAYER, "a", "b", "c", "d", "e", "f", "g"],
    });
    // Everyone drawn but e takes a turn.
    state = run(state, [
      said(msg("a", "1")),
      said(msg("b", "2")),
      acted("c"),
      said(msg("d", "4")),
    ]);
    state = direct(state, speaking("f"));
    expect(lineup(state)).toEqual(["f@0", "c@1", "a@2", "b@3", "d@4"]);
    expect(cast(state).e).toEqual([0, "leaving"]);
    expect(cast(state).f).toEqual([0, "entering"]);
    // An action counts the same: a spoke longest ago now.
    state = direct(state, acted("g"));
    expect(lineup(state)).toEqual(["f@0", "c@1", "g@2", "b@3", "d@4"]);
    expect(cast(state).a).toEqual([2, "leaving"]);
  });

  it("makes room for a speaker with someone quiet before someone speaking", () => {
    let state = scene({
      members: [PLAYER, "a", "b", "c", "d", "e", "f"],
    });
    state = run(state, [speaking("e"), speaking("a")]);
    // e spoke before a, but both are speaking: d, quiet and outermost, goes.
    state = direct(state, speaking("f"));
    expect(cast(state).d?.[1]).toBe("leaving");
    expect(cast(state).f).toEqual([4, "entering"]);
    expect(state.speakers).toEqual(["e", "a", "f"]);
  });

  it("takes a speaker who is not a member yet as one", () => {
    const state = direct(scene({ members: [PLAYER, "a"] }), speaking("z"));
    expect(state.members).toEqual(["a", "z"]);
    expect(lineup(state)).toEqual(["a@1", "z@3"]);
    expect(cast(state).z).toEqual([3, "entering"]);
  });
});

describe("one slot", () => {
  it("shows whoever spoke or acted last, a change being a cross-fade in place", () => {
    let state = scene({
      members: [PLAYER, "a", "b", "c", "p"],
      slots: NARROW_SLOTS,
    });
    expect(cast(state)).toEqual({ a: [0, "here"] });
    state = direct(state, speaking("b"));
    expect(cast(state)).toEqual({
      a: [0, "leaving"],
      b: [0, "entering"],
    });
    // Two at once: the one who started most recently.
    state = run(state, [{ type: "settle", id: "a" }, speaking("c")]);
    expect(lineup(state)).toEqual(["c@0"]);
    // b's line lands while c still speaks: the newest line is b's.
    state = run(state, [{ type: "settle", id: "b" }, said(msg("b", "Hm."))]);
    expect(lineup(state)).toEqual(["b@0"]);
    expect(cast(state).c?.[1]).toBe("leaving");
    // An action is a line like any other.
    state = direct(state, acted("a"));
    expect(lineup(state)).toEqual(["a@0"]);
    // The player and someone without portraits never take it.
    state = run(state, [said(msg(PLAYER, "Hi.")), speaking("p")]);
    state = direct(state, said(msg("p", "Me too.")));
    expect(lineup(state)).toEqual(["a@0"]);
    expect(all(state).at(-1)).toBe("p:Me too.");
  });

  it("follows the newest line of a history read too, unless its author can't be drawn", () => {
    let state = scene({
      members: [PLAYER, "a", "b", "p"],
      slots: NARROW_SLOTS,
    });
    expect(lineup(state)).toEqual(["a@0"]);
    // The history came after the figure was placed (a slow read).
    state = direct(state, {
      type: "history",
      messages: [msg("b", "Earlier."), msg("p", "Then me.")],
    });
    expect(lineup(state)).toEqual(["b@0"]);
    expect(cast(state).a?.[1]).toBe("leaving");
    // In a full five-slot scene, the same as a live line.
    let full = scene({
      members: [PLAYER, "a", "b", "c", "d", "e", "f"],
    });
    full = direct(full, { type: "history", messages: [msg("f", "Hi.")] });
    expect(lineup(full)).toEqual(["f@0", "c@1", "a@2", "b@3", "d@4"]);
  });

  it("is never left empty by someone leaving while others can be drawn", () => {
    let state = scene({
      members: [PLAYER, "a", "b"],
      messages: [msg("b", "one"), msg("a", "two")],
      slots: NARROW_SLOTS,
    });
    expect(lineup(state)).toEqual(["a@0"]);
    state = direct(state, members("b"));
    expect(lineup(state)).toEqual(["b@0"]);
    expect(cast(state).a).toEqual([0, "leaving"]);
  });
});

describe("who can be drawn", () => {
  it("never draws someone without portraits nor keeps a place for them, whatever they say or do", () => {
    let state = scene({ members: [PLAYER, "p", "a", "b"] });
    expect(lineup(state)).toEqual(["a@1", "b@3"]);
    // Speaking first, acting, saying a line: still not drawn, nobody moves.
    state = run(state, [
      speaking("p"),
      acted("p"),
      speaking("p"),
      said(msg("p", "Over here.")),
    ]);
    expect(lineup(state)).toEqual(["a@1", "b@3"]);
    expect(cast(state).p).toBeUndefined();
    expect(all(state)).toEqual(["p:waves.", "p:Over here."]);
    // A full scene: p's lines don't take anyone's place either.
    let full = scene({ members: [PLAYER, "a", "b", "c", "d", "e", "p"] });
    const before = full.figures;
    full = run(full, [speaking("p"), said(msg("p", "Excuse me."))]);
    expect(full.figures).toBe(before);
  });

  it("draws nobody until it is known who can be drawn, then walks them in", () => {
    let state = scene({
      members: [PLAYER, "a", "b", "p"],
      drawable: undefined,
      messages: [msg("b", "Earlier.")],
    });
    expect(state.figures).toEqual([]);
    state = run(state, [speaking("a"), said(msg("p", "Hello."))]);
    expect(state.figures).toEqual([]);
    expect(all(state)).toEqual(["b:Earlier.", "p:Hello."]);
    state = direct(state, drawable("a", "b"));
    // The latest to have spoken first: a, speaking, in the middle; b beside.
    expect(cast(state)).toEqual({
      a: [1, "entering"],
      b: [3, "entering"],
    });
    expect(direct(state, drawable("b", "a"))).toBe(state);
    // Someone whose portraits are gone walks off; the rest close up.
    state = direct(state, drawable("b"));
    expect(lineup(state)).toEqual(["b@2"]);
    expect(cast(state).a?.[1]).toBe("leaving");
  });
});

describe("resizing", () => {
  it("keeps the latest to have spoken when five become one, and walks the rest in when one becomes five", () => {
    let state = scene({ members: [PLAYER, "a", "b", "c"] });
    state = run(state, [said(msg("b", "hi")), speaking("c")]);
    const c = state.figures.find((f) => f.id === "c");
    state = direct(state, { type: "slots", count: NARROW_SLOTS });
    expect(cast(state)).toEqual({ c: [0, "here"] });
    state = direct(state, { type: "slots", count: WIDE_SLOTS });
    expect(lineup(state)).toEqual(["a@1", "c@2", "b@3"]);
    expect(cast(state)).toMatchObject({
      c: [2, c?.presence],
      a: [1, "entering"],
      b: [3, "entering"],
    });
    expect(direct(state, { type: "slots", count: WIDE_SLOTS })).toBe(state);
  });
});

describe("speakers", () => {
  it("lights the drawn speaker of the panel's line, for as long as it is the panel's, and nobody else", () => {
    let state = scene({ members: [PLAYER, "a", "b", "p"] });
    // An empty panel: nobody is dimmed.
    expect(litFigure(state)).toBeUndefined();
    // Speaking alone lights nobody: their line is not in the panel yet.
    state = direct(state, speaking("a"));
    expect(litFigure(state)).toBeUndefined();
    state = direct(state, said(msg("a", "first"), 0));
    expect(litFigure(state)).toBe("a");
    // Still lit as the line finishes and while b speaks over it.
    state = run(state, [speaking("a", false), speaking("b")]);
    expect(litFigure(state)).toBe("a");
    // An action is a line like any other.
    state = direct(state, said(msg("b", "nods.", { type: "action" }), 100_000));
    expect(litFigure(state)).toBe("b");
    // The player's line, or someone undrawn's: nobody dimmed.
    state = direct(state, said(msg(PLAYER, "Hi."), 200_000));
    expect(litFigure(state)).toBeUndefined();
    state = direct(state, said(msg("p", "Me too."), 300_000));
    expect(litFigure(state)).toBeUndefined();
    // Someone leaving with their line in the panel is lit no longer.
    state = run(state, [said(msg("a", "bye"), 400_000), members("b", "p")]);
    expect(litFigure(state)).toBeUndefined();
  });

  it("lights a line being said from its start, keeps the light as it lands, and passes it to a cut-in", () => {
    let state = scene({ members: [PLAYER, "a", "b"] });
    state = direct(state, saying("a", "I was going to say", 0, 2_000, 0));
    expect(litFigure(state)).toBe("a");
    state = direct(state, saying("b", "No.", 500, 900, 500));
    expect(litFigure(state)).toBe("b");
    // a's cut line lands above: the light stays with the panel's line.
    state = direct(state, said(msg("a", "I was—"), 600));
    expect(litFigure(state)).toBe("b");
    // b's line lands in place: no flicker.
    state = direct(state, said(msg("b", "No."), 900));
    expect(litFigure(state)).toBe("b");
  });

  it("lights the line shown, not the one waiting, in reading mode", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      said(msg("a", "Shown."), 0),
      { type: "reading", on: true, at: 0 },
      said(msg("b", "Waiting."), 100_000),
    ]);
    expect(litFigure(state)).toBe("a");
    state = direct(state, { type: "show-next", at: 100_001 });
    expect(litFigure(state)).toBe("b");
  });

  it("ignores the player's own typing and messages for figures", () => {
    const state = scene({ members: [PLAYER, "a"] });
    expect(direct(state, speaking(PLAYER))).toBe(state);
    const next = direct(state, said(msg(PLAYER, "hello")));
    expect(next.figures).toBe(state.figures);
    expect([next.line?.speakerName, next.line?.text]).toEqual([
      "Player Name",
      "hello",
    ]);
  });

  it("drops the face of a member who leaves while speaking", () => {
    let state = scene({ members: [PLAYER, "a", "b"] });
    state = run(state, [
      speaking("a"),
      { type: "look", id: "a", look: { outfit: "gym", mood: "annoyed" } },
    ]);
    expect(state.figures[0]?.look).toEqual({ outfit: "gym", mood: "annoyed" });
    state = direct(state, members("b"));
    expect(cast(state).a).toEqual([1, "leaving"]);
    expect(state.figures[0]?.look).toEqual({ outfit: "gym" });
    expect(state.speakers).toEqual([]);
  });

  it("forgets everyone speaking on silence", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      speaking("a"),
      speaking("b"),
    ]);
    state = direct(state, { type: "silence" });
    expect(state.speakers).toEqual([]);
    expect(direct(state, { type: "silence" })).toBe(state);
  });
});

describe("the panel and the echoes", () => {
  it("shows the newest line in the panel, pushing the one it replaces up as an echo, two at most", () => {
    const steps: [ChatMessage, string[]][] = [
      [msg("a", "one"), ["a:one"]],
      [msg("b", "two"), ["a:one", "b:two"]],
      [msg("a", "three"), ["a:one", "b:two", "a:three"]],
      // An action is a line like any other, its speaker's speech too.
      [msg("a", "waves", { type: "action" }), ["b:two", "a:three", "a:waves"]],
      [msg("c", "nods", { type: "action" }), ["a:three", "a:waves", "c:nods"]],
      [msg("a", "four"), ["a:waves", "c:nods", "a:four"]],
    ];
    let state = scene({ members: [PLAYER, "a", "b", "c"] });
    for (const [message, expected] of steps) {
      // Far apart: nothing waits.
      const at = message.sequence * 100_000;
      state = direct(state, said(message, at));
      expect(shown(state)).toEqual(expected);
      expect(state.line?.shownAt).toBe(at);
      // The newest echo, if any, left the panel just now.
      expect(state.echoes.at(-1)?.leftAt ?? at).toBe(at);
    }
    expect(state.echoes).toHaveLength(MAX_ECHOES);
    expect(state.line?.kind).toBe("speech");
    expect(state.echoes.map((l) => l.kind)).toEqual(["action", "action"]);
  });

  it("marks a line cut off mid-word, and ignores repeats and stickers", () => {
    let state = scene({ members: [PLAYER, "a"] });
    const cut = msg("a", "I was going to—");
    state = run(state, [said(cut), said(cut)]);
    expect(all(state)).toEqual(["a:I was going to—"]);
    expect(state.line?.cutOff).toBe(true);
    const sticker = msg("a", "a cat", {
      type: "sticker",
      sticker: { name: "cat", url: "/x" },
    });
    const next = direct(state, said(sticker));
    expect(next.line).toBe(state.line);
    expect(next.echoes).toBe(state.echoes);
    expect(next.sequence).toBe(sticker.sequence);
  });

  it("holds a line until the panel's line has had its time, showing them one by one as they come due", () => {
    let state = scene({ members: [PLAYER, "a", "b"] });
    state = direct(state, said(msg("a", "short"), 1_000));
    state = run(state, [
      said(msg("b", "also short"), 1_100),
      said(msg("b", "smile", { type: "action" }), 1_200),
    ]);
    expect(shown(state)).toEqual(["a:short"]);
    expect(state.ahead.map(text)).toEqual(["b:also short", "b:smile"]);
    const due = nextShowAt(state);
    expect(due).toBe(1_000 + DWELL_MIN_MS);
    expect(direct(state, { type: "advance", at: (due ?? 0) - 1 })).toBe(state);
    state = direct(state, { type: "advance", at: due ?? 0 });
    // One at a time: the next waits for this one in turn.
    expect(shown(state)).toEqual(["a:short", "b:also short"]);
    expect(state.line?.shownAt).toBe(due);
    expect(state.echoes[0]?.leftAt).toBe(due);
    expect(nextShowAt(state)).toBe((due ?? 0) + DWELL_MIN_MS);
    // Later lines wait behind, in order; Jump to live shows them all.
    state = direct(state, said(msg("a", "then this"), 2_600));
    const jumped = direct(state, { type: "jump", at: 3_000 });
    expect(jumped.ahead).toEqual([]);
    expect(shown(jumped)).toEqual(["b:also short", "b:smile", "a:then this"]);
    expect(nextShowAt(jumped)).toBeUndefined();
    expect(direct(jumped, { type: "jump", at: 3_000 })).toBe(jumped);
    const next = direct(state, { type: "show-next", at: 3_000 });
    expect(shown(next).at(-1)).toBe("b:smile");
    expect(next.ahead.map(text)).toEqual(["a:then this"]);
    // Outside reading mode, asking with nothing waiting does nothing.
    expect(direct(jumped, { type: "show-next", at: 3_000 })).toBe(jumped);
  });

  it("shows the player's own line at once, with everything waiting before it", () => {
    let state = run(scene({ members: [PLAYER, "a"] }), [
      said(msg("a", "one"), 1_000),
      said(msg("a", "two"), 1_001),
      said(msg("a", "three"), 1_002),
    ]);
    expect(state.ahead).toHaveLength(2);
    state = direct(state, said(msg(PLAYER, "Wait."), 1_003));
    expect(state.ahead).toEqual([]);
    expect(shown(state)).toEqual(["a:two", "a:three", `${PLAYER}:Wait.`]);
    expect(state.line?.shownAt).toBe(1_003);
  });

  it("shows a line as it is said, with its words and window, and the message in its place when it lands", () => {
    let state = scene({
      members: [PLAYER, "a", "b"],
      messages: [msg("b", "Earlier.")],
    });
    state = direct(state, saying("a", "Here I am.", 1_000, 1_800, 100));
    expect(shown(state)).toEqual(["b:Earlier.", "a:~Here I am."]);
    expect(state.line?.said).toEqual({ from: 1_000, until: 1_800 });
    expect(state.line?.speakerName).toBe("A");
    state = direct(state, said(msg("a", "Here I am."), 900));
    // In its place, not pushed up again; when it appeared is kept.
    expect(shown(state)).toEqual(["b:Earlier.", "a:Here I am."]);
    expect(state.line?.shownAt).toBe(100);
    expect(state.saying).toEqual({});
    expect(state.ahead).toEqual([]);
  });

  it("names a line being said by its speaking event, else by id", () => {
    const named = direct(
      scene({ members: [PLAYER, "a"] }),
      saying("a", "Hi.", 0, 500),
    );
    expect(named.line?.speakerName).toBe("A");
    const bare = direct(scene({ members: [PLAYER, "a"] }), {
      type: "typing",
      typing: {
        senderId: "a",
        isTyping: true,
        mode: "speaking",
        speech: { text: "Hi.", from: 0, until: 500 },
      },
      at: 0,
    });
    expect(bare.line?.speakerName).toBe("a");
  });

  it("without its words (an older Gateway), shows nothing until the line lands, then the line whole", () => {
    let state = scene({
      members: [PLAYER, "a"],
      messages: [msg("a", "Before.")],
    });
    state = direct(state, speaking("a", true, 100));
    expect(shown(state)).toEqual(["a:Before."]);
    expect(nextShowAt(state)).toBeUndefined();
    state = direct(state, said(msg("a", "Now."), 900));
    expect(shown(state)).toEqual(["a:Before.", "a:Now."]);
  });

  it("waits for the panel's line to have its time before showing a line being said", () => {
    let state = scene({ members: [PLAYER, "a", "b"] });
    state = run(state, [
      said(msg("a", "short"), 1_000),
      saying("b", "Me next.", 1_200, 2_000, 1_200),
    ]);
    expect(shown(state)).toEqual(["a:short"]);
    expect(nextShowAt(state)).toBe(2_500);
    state = direct(state, { type: "advance", at: 2_500 });
    expect(shown(state)).toEqual(["a:short", "b:~Me next."]);
    expect(nextShowAt(state)).toBeUndefined();
  });

  it("gives the panel to the newest of two lines said at once; the other goes on in the echoes and commits there, cut", () => {
    let state = scene({ members: [PLAYER, "a", "b"] });
    state = run(state, [
      saying("a", "I was going to say that we should", 0, 3_000, 0),
      saying("b", "Sorry, but no.", 400, 1_500, 400),
    ]);
    // b cut in: b has the panel, a's line goes on above it.
    expect(shown(state)).toEqual([
      "a:~I was going to say that we should",
      "b:~Sorry, but no.",
    ]);
    // a is cut: what was heard of it, in the echoes where it is.
    state = direct(state, said(msg("a", "I was going to—"), 600));
    expect(shown(state)).toEqual(["a:I was going to—", "b:~Sorry, but no."]);
    expect(state.echoes[0]?.cutOff).toBe(true);
    state = direct(state, said(msg("b", "Sorry, but no."), 1_600));
    expect(shown(state)).toEqual(["a:I was going to—", "b:Sorry, but no."]);
  });

  it.each<[string, SceneEvent]>([
    ["the saying stops", speaking("b", false, 10_100)],
    ["the speaker leaves", members("a")],
    ["the stream drops", { type: "silence" }],
  ])(
    "takes a line being said away cleanly when %s, bringing back the line it pushed up",
    (_, end) => {
      const base = run(scene({ members: [PLAYER, "a", "b"] }), [
        said(msg("a", "Said."), 0),
        saying("b", "Never landed.", 10_000, 11_000, 10_000),
      ]);
      expect(shown(base)).toEqual(["a:Said.", "b:~Never landed."]);
      const state = direct(base, end);
      // No phantom line, no echo of it: the plate is a's again.
      expect(shown(state)).toEqual(["a:Said."]);
      expect(state.line?.leftAt).toBe(10_000);
      expect(state.saying).toEqual({});
      // And a message for it later shows as any line would.
    },
  );

  it("takes a line being said in the echoes away too, when it never lands", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      said(msg("a", "Said."), 0),
      saying("a", "Then this", 10_000, 12_000, 10_000),
      saying("b", "Over you", 10_500, 11_500, 10_500),
    ]);
    expect(shown(state)).toEqual(["a:Said.", "a:~Then this", "b:~Over you"]);
    state = direct(state, speaking("a", false, 10_600));
    expect(shown(state)).toEqual(["a:Said.", "b:~Over you"]);
  });

  it("holds a finished line behind a line being said until that lands and is read", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      saying("a", "Hold on a second", 0, 2_000, 0),
      said(msg("b", "nods.", { type: "action" }), 500),
    ]);
    expect(shown(state)).toEqual(["a:~Hold on a second"]);
    expect(state.ahead.map(text)).toEqual(["b:nods."]);
    // Nothing to time while it is being said.
    expect(nextShowAt(state)).toBeUndefined();
    state = direct(state, said(msg("a", "Hold on a second"), 2_000));
    expect(nextShowAt(state)).toBe(0 + dwellMs({ text: "Hold on a second" }));
  });

  it("shows the player's line at once over a line being said, which goes on above it and lands there", () => {
    let state = run(scene({ members: [PLAYER, "a"] }), [
      saying("a", "Let me finish", 0, 2_000, 0),
      said(msg(PLAYER, "Stop."), 500),
    ]);
    expect(shown(state)).toEqual(["a:~Let me finish", `${PLAYER}:Stop.`]);
    state = direct(state, said(msg("a", "Let me—"), 700));
    expect(shown(state)).toEqual(["a:Let me—", `${PLAYER}:Stop.`]);
  });

  it("resumes a line being said after a reconnect from its window, not from the start", () => {
    let state = run(scene({ members: [PLAYER, "a"] }), [
      saying("a", "A long line, said slowly.", 1_000, 5_000, 1_000),
    ]);
    const before = state.line;
    // The stream drops (silence) and the replay tells it again.
    state = run(state, [
      { type: "silence" },
      saying("a", "A long line, said slowly.", 1_000, 5_000, 3_000),
    ]);
    expect(shown(state)).toEqual(["a:~A long line, said slowly."]);
    expect(state.line?.said).toEqual(before?.said);
    // Told again while still shown: the same line, nothing moves.
    const again = direct(
      state,
      saying("a", "A long line, said slowly.", 1_000, 5_000, 3_100),
    );
    expect(shown(again)).toEqual(shown(state));
  });

  it("drops an echo once the renderer has faded it", () => {
    const one = msg("a", "one");
    let state = run(scene({ members: [PLAYER, "a"] }), [
      said(one, 0),
      said(msg("a", "two"), 100_000),
    ]);
    expect(shown(state)).toEqual(["a:one", "a:two"]);
    state = direct(state, { type: "fade", messageId: one.id });
    expect(shown(state)).toEqual(["a:two"]);
    expect(direct(state, { type: "fade", messageId: one.id })).toBe(state);
  });

  it("takes in only newer history, unpaced, and queues it behind lines still waiting", () => {
    const old = msg("a", "old");
    let state = scene({ members: [PLAYER, "a"], messages: [old] });
    expect(direct(state, { type: "history", messages: [old] })).toBe(state);
    const missed = [
      msg("a", "missed one"),
      msg("a", "missed two", { type: "action" }),
    ];
    state = direct(state, { type: "history", messages: [old, ...missed] });
    expect(shown(state)).toEqual(["a:old", "a:missed one", "a:missed two"]);
    expect(state.line?.shownAt).toBeUndefined();
    // A live line already in does not come in twice from a later read.
    const live = msg("a", "live");
    state = direct(state, said(live, 5_000));
    expect(direct(state, { type: "history", messages: [live] })).toBe(state);
    // Behind a line waiting, history waits too.
    state = direct(state, said(msg("a", "waiting"), 5_001));
    const later = msg("a", "read later");
    state = direct(state, { type: "history", messages: [later] });
    expect(state.ahead.map(text)).toEqual(["a:waiting", "a:read later"]);
  });
});

describe("reading mode", () => {
  const reading = (on: boolean, at = 0): SceneEvent => ({
    type: "reading",
    on,
    at,
  });
  const next = (at = 0): SceneEvent => ({ type: "show-next", at });

  it("holds every new line for the reader, who shows them one at a time", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      said(msg("a", "Shown."), 0),
      reading(true),
    ]);
    expect(state.reading).toBe(true);
    expect(direct(state, reading(true))).toBe(state);
    // Long after the panel's line has had its time: still held.
    state = run(state, [
      said(msg("b", "One."), 100_000),
      said(msg("a", "Two."), 100_001),
    ]);
    expect(shown(state)).toEqual(["a:Shown."]);
    expect(state.ahead.map(text)).toEqual(["b:One.", "a:Two."]);
    expect(nextShowAt(state)).toBeUndefined();
    expect(direct(state, { type: "advance", at: 200_000 })).toBe(state);
    state = direct(state, next(200_000));
    expect(shown(state)).toEqual(["a:Shown.", "b:One."]);
    expect(state.ahead.map(text)).toEqual(["a:Two."]);
    expect(state.wanted).toBe(false);
  });

  it("takes a line that has started as ready; shown whole on an advance, its commit snaps it, cut or not", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      said(msg("a", "Shown."), 0),
      reading(true),
      saying("b", "Long enough to be cut off later", 1_000, 4_000, 1_000),
    ]);
    // Ready the moment it starts: it waits for the reader.
    expect(shown(state)).toEqual(["a:Shown."]);
    expect(state.ahead.map(text)).toEqual([
      "b:~Long enough to be cut off later",
    ]);
    state = direct(state, next(1_200));
    // The reader has it whole at once.
    expect(shown(state)).toEqual([
      "a:Shown.",
      "b:~!Long enough to be cut off later",
    ]);
    // Someone cut in before it was said through: it shortens to what was
    // heard, in its place.
    const cut = direct(state, said(msg("b", "Long enough to—"), 2_000));
    expect(shown(cut)).toEqual(["a:Shown.", "b:Long enough to—"]);
    expect(cut.line?.whole).toBeUndefined();
    // Never landed at all: it goes, like any line that never lands.
    const dropped = direct(state, speaking("b", false, 2_000));
    expect(shown(dropped)).toEqual(["a:Shown."]);
    // Still waiting when it never landed: nothing waits any more.
    const waiting = run(scene({ members: [PLAYER, "a", "b"] }), [
      reading(true),
      saying("b", "Gone before read", 0, 1_000, 0),
      speaking("b", false, 500),
    ]);
    expect(waiting.ahead).toEqual([]);
  });

  it("asked for with nothing waiting, shows a line being said live the moment it starts", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      said(msg("a", "Shown."), 0),
      reading(true),
      next(500),
    ]);
    expect(state.wanted).toBe(true);
    // Asking again changes nothing: one pending request.
    expect(direct(state, next(600))).toBe(state);
    state = direct(state, saying("b", "Landing now.", 1_000, 2_000, 1_000));
    expect(shown(state)).toEqual(["a:Shown.", "b:~Landing now."]);
    expect(state.wanted).toBe(false);
    state = direct(state, said(msg("b", "Landing now."), 2_000));
    expect(shown(state)).toEqual(["a:Shown.", "b:Landing now."]);
    // The next line waits again.
    state = direct(state, said(msg("a", "Held."), 3_100));
    expect(state.ahead.map(text)).toEqual(["a:Held."]);
  });

  it("asked for with nobody speaking, shows the next line to arrive at once, whoever says it", () => {
    let state = run(scene({ members: [PLAYER, "a", "b"] }), [
      said(msg("a", "Shown."), 0),
      reading(true),
      next(10),
    ]);
    expect(state.wanted).toBe(true);
    expect(shown(state)).toEqual(["a:Shown."]);
    state = direct(state, said(msg("b", "nods.", { type: "action" }), 500));
    expect(shown(state)).toEqual(["a:Shown.", "b:nods."]);
    expect(state.wanted).toBe(false);
  });

  it("shows everything waiting, at once, when it is turned off", () => {
    let state = run(scene({ members: [PLAYER, "a"] }), [
      reading(true),
      said(msg("a", "one"), 0),
      said(msg("a", "two"), 1),
      said(msg("a", "three"), 2),
      said(msg("a", "four"), 3),
    ]);
    expect(state.ahead).toHaveLength(4);
    state = direct(state, reading(false, 50));
    expect(state.reading).toBe(false);
    expect(state.wanted).toBe(false);
    expect(state.ahead).toEqual([]);
    expect(shown(state)).toEqual(["a:two", "a:three", "a:four"]);
    expect(state.line?.shownAt).toBe(50);
    expect(direct(state, reading(false))).toBe(state);
  });

  it("shows the player's own line at once, with everything waiting before it", () => {
    let state = run(scene({ members: [PLAYER, "a"] }), [
      reading(true),
      said(msg("a", "one"), 0),
      said(msg("a", "two"), 1),
    ]);
    state = direct(state, said(msg(PLAYER, "Answer."), 2));
    expect(state.ahead).toEqual([]);
    expect(shown(state)).toEqual(["a:one", "a:two", `${PLAYER}:Answer.`]);
    expect(state.reading).toBe(true);
  });

  it("holds a history read for the reader too", () => {
    let state = direct(scene({ members: [PLAYER, "a"] }), reading(true));
    state = direct(state, {
      type: "history",
      messages: [msg("a", "missed")],
    });
    expect(state.line).toBeUndefined();
    expect(state.ahead.map(text)).toEqual(["a:missed"]);
  });
});

describe("figures settle and change look", () => {
  it("finishes entrances and exits only when the renderer says so", () => {
    let state = direct(scene(), members("a"));
    expect(state.figures[0]?.presence).toBe("entering");
    state = direct(state, { type: "settle", id: "a" });
    expect(state.figures[0]?.presence).toBe("here");
    expect(direct(state, { type: "settle", id: "a" })).toBe(state);
    state = run(state, [members(), { type: "settle", id: "a" }]);
    expect(state.figures).toEqual([]);
  });

  it("sets a mood by event, merging with the outfit", () => {
    let state = scene({ members: [PLAYER, "a"] });
    state = direct(state, { type: "look", id: "a", look: { mood: "happy" } });
    expect(state.figures[0]?.look).toEqual({ mood: "happy" });
    expect(
      direct(state, { type: "look", id: "a", look: { mood: "happy" } }),
    ).toBe(state);
    state = direct(state, { type: "look", id: "a", look: { mood: undefined } });
    expect(state.figures[0]?.look.mood).toBeUndefined();
  });
});

describe("references", () => {
  it("keeps figures when only lines change, and other figures when one changes", () => {
    let state = scene({ members: [PLAYER, "a", "b"] });
    const before = state.figures;
    state = direct(state, said(msg(PLAYER, "hi")));
    expect(state.figures).toBe(before);
    const line = state.line;
    const b = state.figures[1];
    state = direct(state, speaking("a"));
    // The player's line has not had its time: a is lit, not yet shown.
    expect(state.line).toBe(line);
    expect(state.figures[1]).toBe(b);
    expect(direct(state, members("a", "b"))).toBe(state);
  });
});

describe("pure helpers", () => {
  it.each([
    ["", DWELL_MIN_MS],
    ["x".repeat(60), 3_000],
    ["漢".repeat(20), 3_000],
    ["x".repeat(1_000), DWELL_MAX_MS],
  ])("dwellMs(%j) is %i", (text, ms) => {
    expect(dwellMs({ text })).toBe(ms);
  });

  it.each([
    ["I was—", undefined, true],
    ["I was— ", undefined, true],
    ["—", undefined, false],
    ["Done.", undefined, false],
    ["I was—", "I was going to say", true],
    ["I was going to say—", "I was", false],
  ])("isCutOff(%j, %j) is %s", (committed, revealing, cut) => {
    expect(isCutOff(committed, revealing)).toBe(cut);
  });
});
