import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materialize, WORLDS } from "./fixtures/worlds.ts";
import { MemoryIndex } from "./index.ts";
import {
  createSleep,
  parseSleepOutput,
  validateSleep,
  type SleepEvent,
  type SleepOutput,
  type SleepState,
} from "./sleep.ts";

const NOW = Date.parse(WORLDS.saltmere.now);
const AGENT = "mara-vell";
let root: string;
let index: MemoryIndex;
const workspace = (): string => path.join(root, "agents", AGENT);
const read = (relative: string): string =>
  readFileSync(path.join(workspace(), relative), "utf8");

const NIGHT: SleepOutput = {
  day: {
    summary: "Tobin apologized.",
    gist: "He came by with the rent and could not look at me.",
    touched: ["tobin-vell"],
  },
  pages: [
    {
      id: "tobin-vell",
      view: "He is trying, in his way.",
      openThreads: ["See if he keeps it up."],
      theyThinkOfMe: {
        guess: "Still afraid of my temper.",
        certainty: "suspect",
      },
      notes: [
        {
          source: "seen it",
          certainty: "sure",
          text: "Paid the February rent.",
        },
      ],
      links: ["oswin-hale"],
    },
    {
      id: "oil_theft",
      kind: "concept",
      name: "The oil thefts",
      notes: [
        {
          source: "told by tobin-vell",
          certainty: "think so",
          text: "It stops at the Watch House.",
        },
      ],
      links: [],
    },
  ],
  self: {
    lately: "Tired, less angry.",
    plans: [{ on: "2026-03-11", text: "[SOFT_GOAL] Walk the north round." }],
  },
  dream: "The bell rang inside a lamp.",
};

function setup(
  overrides: { complete?: () => Promise<string>; through?: number } = {},
) {
  const store = new Map<string, SleepState>();
  const events: SleepEvent[] = [];
  const passes = new Map();
  const complete = vi.fn(
    overrides.complete ?? (async () => JSON.stringify(NIGHT)),
  );
  const sleep = createSleep(
    {
      index,
      enabled: true,
      categories: ["sleeping"],
      minMinutes: 180,
      notesPerPage: 3,
      now: () => NOW,
      workspaceOf: () => workspace(),
      store: {
        lookup: async (key) => store.get(key),
        register: async (key, value) => {
          store.set(key, value);
        },
      },
      complete,
      instructions: async () => "sort out the day",
      experiences: async () => ({
        text: "[Tobin Vell `tobin-vell`] Here is the rent.",
        speakers: ["tobin-vell"],
        through: overrides.through ?? NOW,
      }),
      nameOf: (id) => index.world().pages.get(id)?.name,
      record: async (_agent, event) => {
        events.push(event);
      },
      warn: () => {},
    },
    passes,
  );
  return { sleep, store, events, complete, passes };
}

const task = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "night",
  type: "sleeping",
  description: "Going to bed",
  startedAt: "2026-03-10T22:00:00Z",
  endAt: "2026-03-11T06:00:00Z",
  duration: 480,
  ...over,
});
const commitTask = async (
  sleep: ReturnType<typeof setup>["sleep"],
  kind: "started" | "delayed",
  active: ReturnType<typeof task>,
): Promise<void> => {
  const prepared = await sleep.taskExtension.prepare({
    kind,
    agentId: AGENT,
    at: NOW,
    task: active as never,
    params: {},
  });
  await prepared.commit(active as never);
};

beforeEach(() => {
  root = materialize(WORLDS.saltmere);
  index = new MemoryIndex({
    worldDir: path.join(root, "world"),
    workspaceDir: (id) => path.join(root, "agents", id),
    anchors: WORLDS.saltmere.anchors,
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("a night", () => {
  it("rewrites views, adds notes, writes the day and the plans", async () => {
    const { sleep, events, complete } = setup();
    await sleep.consolidate(AGENT);
    const tobin = read("wiki/entities/characters/tobin-vell.md");
    expect(tobin).toContain("He is trying, in his way.");
    expect(tobin).not.toContain("still check he has eaten");
    expect(tobin).toContain("Still afraid of my temper. (suspect)");
    expect(tobin).toContain("- See if he keeps it up.");
    expect(tobin).not.toContain("rent for February");
    expect(tobin).toContain("[[oswin-hale]]");
    const page = index.personal(AGENT).get("tobin-vell")!;
    expect(page.notes[0].text).toBe("Paid the February rent.");
    expect(page.theyThinkOfMe).toBe("Still afraid of my temper. (suspect)");
    expect(page.problems).toEqual([]);
    expect(read("wiki/concepts/oil_theft.md")).toContain(
      "It stops at the Watch House.",
    );
    expect(read("wiki/days/2026-03-10.md")).toContain("could not look at me");
    expect(read("wiki/days/2026-03-10.md")).toContain(
      "The bell rang inside a lamp.",
    );
    expect(read("MEMORY.md")).toContain("Tired, less angry.");
    expect(read("MEMORY.md")).toContain("[SOFT_GOAL] Walk the north round.");
    expect(events[0]).toMatchObject({
      pages: ["tobin-vell", "oil_theft"],
      newPages: ["oil_theft"],
      notes: 2,
      interrupted: false,
      dream: "The bell rang inside a lamp.",
    });
    expect(complete.mock.calls[0]).toBeDefined();
  });

  it("gives the model the day and their own pages, nobody else's", async () => {
    const { sleep, complete } = setup();
    await sleep.consolidate(AGENT);
    const { message } = (
      complete.mock.calls[0] as unknown as [{ message: string }]
    )[0];
    expect(message).toContain("Here is the rent.");
    expect(message).toContain("still check he has eaten");
    expect(message).not.toContain("Thinks I sold out");
  });

  it("a restore puts every file back, and removes what it made", async () => {
    const { sleep, store } = setup();
    const before = read("wiki/entities/characters/tobin-vell.md");
    await sleep.consolidate(AGENT);
    const { id } = store.get(AGENT)!.runs[0];
    expect(await sleep.restore(AGENT, id)).toBe(true);
    expect(read("wiki/entities/characters/tobin-vell.md")).toBe(before);
    expect(
      existsSync(path.join(workspace(), "wiki/concepts/oil_theft.md")),
    ).toBe(false);
    expect(existsSync(path.join(workspace(), "wiki/days/2026-03-10.md"))).toBe(
      false,
    );
    expect(await sleep.restore(AGENT, "nope")).toBe(false);
  });

  it("a human edit made during the pass survives", async () => {
    const file = path.join(
      workspace(),
      "wiki/entities/characters/oswin-hale.md",
    );
    const { sleep } = setup({
      complete: async () =>
        JSON.stringify({
          day: { summary: "s", gist: "g", touched: [] },
          pages: [
            {
              id: "oswin-hale",
              notes: [
                { source: "seen it", certainty: "sure", text: "Saw him." },
              ],
            },
          ],
        }),
    });
    await sleep.consolidate(AGENT);
    expect(readFileSync(file, "utf8")).toContain("A bully with a badge.");
    expect(readFileSync(file, "utf8")).toContain("Saw him.");
  });
});

describe("the watermark", () => {
  it("stops at the last record read, so a backlog waits for next sleep", async () => {
    const { sleep, store } = setup({ through: NOW - 5_000 });
    await sleep.consolidate(AGENT);
    expect(store.get(AGENT)?.watermark).toBe(NOW - 5_000);
  });
});

describe("when it runs", () => {
  it("starts on a long sleep, not a nap or another activity", async () => {
    const { sleep, complete } = setup();
    await commitTask(sleep, "started", task({ duration: 30 }));
    await commitTask(sleep, "started", task({ type: "working" }));
    await sleep.settled(AGENT);
    expect(complete).not.toHaveBeenCalled();
    await commitTask(sleep, "started", task());
    await sleep.settled(AGENT);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it("is off unless a world turns it on", async () => {
    const passes = new Map();
    const complete = vi.fn(async () => "{}");
    const { sleep: enabledShape } = setup();
    void enabledShape;
    const off = createSleep(
      {
        index,
        enabled: false,
        categories: ["sleeping"],
        minMinutes: 180,
        notesPerPage: 3,
        now: () => NOW,
        workspaceOf: () => workspace(),
        store: { lookup: async () => undefined, register: async () => {} },
        complete,
        instructions: async () => "",
        experiences: async () => ({ text: "x", speakers: [], through: NOW }),
        nameOf: () => undefined,
        record: async () => {},
        warn: () => {},
      },
      passes,
    );
    await commitTask(off, "started", task());
    expect(complete).not.toHaveBeenCalled();
  });

  it("a wake applies nothing and keeps the watermark", async () => {
    let finish: (value: string) => void = () => {};
    const { sleep, store, events } = setup({
      complete: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const before = read("wiki/entities/characters/tobin-vell.md");
    await commitTask(sleep, "started", task());
    await vi.waitFor(() => {
      expect(finish).not.toEqual(expect.any(Number));
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    sleep.wake(AGENT);
    finish(JSON.stringify(NIGHT));
    await sleep.settled(AGENT);
    expect(read("wiki/entities/characters/tobin-vell.md")).toBe(before);
    expect(store.get(AGENT)).toBeUndefined();
    expect(events[0]).toMatchObject({ interrupted: true, pages: [] });
  });

  it("replacing the sleep with another activity also ends the pass", async () => {
    let finish: (value: string) => void = () => {};
    const { sleep, store } = setup({
      complete: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    await commitTask(sleep, "started", task());
    await new Promise((resolve) => setTimeout(resolve, 5));
    await commitTask(sleep, "started", task({ id: "up", type: "working" }));
    finish(JSON.stringify(NIGHT));
    await sleep.settled(AGENT);
    expect(store.get(AGENT)).toBeUndefined();
  });

  it("nothing happened: no model call", async () => {
    const passes = new Map();
    const complete = vi.fn(async () => "{}");
    const quiet = createSleep(
      {
        index,
        enabled: true,
        categories: ["sleeping"],
        minMinutes: 180,
        notesPerPage: 3,
        now: () => NOW,
        workspaceOf: () => workspace(),
        store: { lookup: async () => undefined, register: async () => {} },
        complete,
        instructions: async () => "",
        experiences: async () => ({ text: " ", speakers: [], through: NOW }),
        nameOf: () => undefined,
        record: async () => {},
        warn: () => {},
      },
      passes,
    );
    await quiet.consolidate(AGENT);
    expect(complete).not.toHaveBeenCalled();
  });

  it("a malformed reply changes nothing", async () => {
    const warn = vi.fn();
    const { sleep, store } = setup({
      complete: async () => "I dreamt of nothing.",
    });
    void warn;
    const before = read("wiki/entities/characters/tobin-vell.md");
    await sleep.consolidate(AGENT);
    expect(read("wiki/entities/characters/tobin-vell.md")).toBe(before);
    expect(store.get(AGENT)).toBeUndefined();
  });
});

describe("validateSleep", () => {
  const evidence = {
    speakers: new Set(["tobin-vell", "user:sensei"]),
    present: new Set(["tobin-vell", "sensei"]),
    known: new Set(["tobin-vell"]),
    resolve: (reference: string) => reference,
  };
  const page = (over: object) => ({
    id: "tobin-vell",
    notes: [],
    links: [],
    ...over,
  });
  const day = { summary: "s", gist: "g", touched: [] };

  it("keeps grounded sources, including the player", () => {
    const { output, dropped } = validateSleep(
      {
        day,
        pages: [
          page({
            notes: [
              { source: "told by tobin-vell", certainty: "sure", text: "a" },
              { source: "told by user:sensei", certainty: "sure", text: "b" },
              { source: "my guess", certainty: "suspect", text: "c" },
            ],
          }),
        ],
      },
      evidence,
    );
    expect(dropped).toEqual([]);
    expect(output.pages[0].notes).toHaveLength(3);
  });

  it("takes the player's address as their page id", () => {
    const { output, dropped } = validateSleep(
      {
        day,
        pages: [
          page({
            id: "user:sensei",
            notes: [{ source: "seen it", certainty: "sure", text: "a" }],
          }),
        ],
      },
      evidence,
    );
    expect(dropped).toEqual([]);
    expect(output.pages[0].id).toBe("sensei");
  });

  it("drops a source who said nothing that day", () => {
    const { output, dropped } = validateSleep(
      {
        day,
        pages: [
          page({
            notes: [{ source: "told by ghost", certainty: "sure", text: "a" }],
          }),
        ],
      },
      evidence,
    );
    expect(output.pages[0].notes).toEqual([]);
    expect(dropped[0]).toMatch(/ghost said nothing/);
  });

  it("drops an unknown source form", () => {
    const { dropped } = validateSleep(
      {
        day,
        pages: [
          page({
            notes: [{ source: "the universe", certainty: "sure", text: "a" }],
          }),
        ],
      },
      evidence,
    );
    expect(dropped).toHaveLength(1);
  });

  it("drops a new page with no grounded note, and a bad id", () => {
    const { output, dropped } = validateSleep(
      { day, pages: [page({ id: "brand_new" }), page({ id: "../escape" })] },
      evidence,
    );
    expect(output.pages).toEqual([]);
    expect(dropped).toHaveLength(2);
  });

  it("drops a guess about someone not in the records, keeps the rest", () => {
    const { output } = validateSleep(
      {
        day,
        pages: [
          page({
            id: "hope-marrow",
            theyThinkOfMe: { guess: "x", certainty: "sure" },
            notes: [{ source: "seen it", certainty: "sure", text: "n" }],
          }),
        ],
      },
      evidence,
    );
    expect(output.pages[0].theyThinkOfMe).toBeUndefined();
    expect(output.pages[0].notes).toHaveLength(1);
  });
});

describe("parseSleepOutput", () => {
  it("loses only the bad part of a page, not the night", () => {
    const dropped: string[] = [];
    const output = parseSleepOutput(
      JSON.stringify({
        day: { gist: "g" },
        pages: [
          { id: "a", theyThinkOfMe: { certainty: "sure" }, view: "kept" },
          {
            id: "b",
            notes: [
              { text: "no source" },
              { source: "seen it", certainty: "sure", text: "ok" },
            ],
          },
          { nope: true },
        ],
      }),
      (what) => dropped.push(what),
    );
    expect(output.pages.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(output.pages[0]).toMatchObject({ view: "kept" });
    expect(output.pages[0].theyThinkOfMe).toBeUndefined();
    expect(output.pages[1].notes).toHaveLength(1);
    expect(dropped).toHaveLength(3);
  });

  it("reads through a code fence and rejects non-JSON", () => {
    expect(
      parseSleepOutput('```json\n{"day":{"summary":"s","gist":"g"}}\n```').day
        .gist,
    ).toBe("g");
    expect(() => parseSleepOutput("no")).toThrow();
  });
});
