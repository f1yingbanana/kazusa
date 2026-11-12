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
  overrides: {
    complete?: (params: { message: string }) => Promise<string>;
    through?: number;
    records?: string;
    pause?: (ms: number, signal: AbortSignal) => Promise<void>;
  } = {},
) {
  const store = new Map<string, SleepState>();
  const events: SleepEvent[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const pauses: number[] = [];
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
        text:
          overrides.records ?? "[Tobin Vell `tobin-vell`] Here is the rent.",
        speakers: ["tobin-vell"],
        through: overrides.through ?? NOW,
      }),
      nameOf: (id) => index.world().pages.get(id)?.name,
      record: async (_agent, event) => {
        events.push(event);
      },
      log: (message) => logs.push(message),
      warn: (message) => warnings.push(message),
      wallNow: () => 42,
      pause:
        overrides.pause ??
        (async (ms) => {
          pauses.push(ms);
        }),
    },
    passes,
  );
  return { sleep, store, events, complete, passes, logs, warnings, pauses };
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
        log: () => {},
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
    expect(store.get(AGENT)).toMatchObject({
      runs: [],
      outcomes: [{ result: "interrupted", attempts: 1 }],
    });
    expect(store.get(AGENT)?.watermark).toBeUndefined();
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
    expect(store.get(AGENT)?.runs).toEqual([]);
    expect(store.get(AGENT)?.outcomes?.[0].result).toBe("interrupted");
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
        log: () => {},
        warn: () => {},
      },
      passes,
    );
    await quiet.consolidate(AGENT);
    expect(complete).not.toHaveBeenCalled();
  });

  it("a reply that never reads changes nothing, and the day waits", async () => {
    const { sleep, store, complete, warnings } = setup({
      complete: async () => "I dreamt of nothing.",
    });
    const before = read("wiki/entities/characters/tobin-vell.md");
    await sleep.consolidate(AGENT);
    expect(read("wiki/entities/characters/tobin-vell.md")).toBe(before);
    expect(complete).toHaveBeenCalledTimes(3);
    const state = store.get(AGENT)!;
    expect(state.watermark).toBeUndefined();
    expect(state.runs).toEqual([]);
    expect(state.outcomes?.[0]).toMatchObject({
      result: "failed",
      attempts: 3,
      wallAt: 42,
      errors: [
        "Error: No JSON in the reply.",
        "Error: No JSON in the reply.",
        "Error: No JSON in the reply.",
      ],
    });
    expect(warnings.at(-1)).toMatch(/failed after 3 attempts/);
  });

  it("nothing new since the last sleep is kept as an empty night", async () => {
    const { sleep, store, complete } = setup({ records: " " });
    await sleep.consolidate(AGENT);
    expect(complete).not.toHaveBeenCalled();
    expect(store.get(AGENT)?.outcomes?.[0]).toMatchObject({
      result: "empty",
      attempts: 0,
    });
  });
});

describe("a failed attempt", () => {
  it("is tried again, and the night is applied once", async () => {
    const replies = ['{"day": {"summary": "s"}}', JSON.stringify(NIGHT)];
    const { sleep, store, complete, pauses, logs } = setup({
      complete: async () => replies.shift()!,
    });
    await sleep.consolidate(AGENT);
    expect(complete).toHaveBeenCalledTimes(2);
    const retry = (
      complete.mock.calls[1] as unknown as [{ message: string }]
    )[0].message;
    expect(retry).toContain("# Retry\nError: No usable day");
    expect(pauses).toEqual([10_000]);
    const page = index.personal(AGENT).get("tobin-vell")!;
    expect(
      page.notes.filter(({ text }) => text === "Paid the February rent."),
    ).toHaveLength(1);
    expect(store.get(AGENT)?.watermark).toBe(NOW);
    expect(store.get(AGENT)?.outcomes?.[0]).toMatchObject({
      result: "applied",
      attempts: 2,
      errors: [expect.stringContaining("No usable day")],
      repaired: false,
      pages: 2,
      newPages: 1,
      notes: 2,
      views: 1,
      self: true,
      dream: true,
    });
    expect(logs[0]).toMatch(/applied on attempt 2: day page, 2 pages/);
  });

  it("a timeout is tried again too", async () => {
    let calls = 0;
    const { sleep, store } = setup({
      complete: async () => {
        calls++;
        if (calls === 1)
          throw new DOMException(
            "The operation was aborted due to timeout",
            "TimeoutError",
          );
        return JSON.stringify(NIGHT);
      },
    });
    await sleep.consolidate(AGENT);
    expect(store.get(AGENT)?.outcomes?.[0]).toMatchObject({
      result: "applied",
      attempts: 2,
      errors: ["TimeoutError: The operation was aborted due to timeout"],
    });
  });

  it("a wake while waiting to try again ends the pass", async () => {
    const { sleep, store, complete, events } = setup({
      complete: async () => "no",
      pause: (_ms, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(new Error("woken"));
            },
            { once: true },
          );
        }),
    });
    const pass = sleep.consolidate(AGENT);
    await vi.waitFor(() => {
      expect(complete).toHaveBeenCalledTimes(1);
    });
    sleep.wake(AGENT);
    await pass;
    expect(complete).toHaveBeenCalledTimes(1);
    expect(store.get(AGENT)?.outcomes?.[0]).toMatchObject({
      result: "interrupted",
      attempts: 1,
    });
    expect(events[0]).toMatchObject({ interrupted: true });
  });

  it("a later sleep takes in the day a failed one left", async () => {
    let fail = true;
    const { sleep, store } = setup({
      complete: async () => (fail ? "no" : JSON.stringify(NIGHT)),
    });
    await sleep.consolidate(AGENT);
    fail = false;
    await sleep.consolidate(AGENT);
    expect(store.get(AGENT)?.outcomes?.map(({ result }) => result)).toEqual([
      "applied",
      "failed",
    ]);
    expect(store.get(AGENT)?.watermark).toBe(NOW);
  });
});

// The reply shapes that cost whole nights on 2026-11-12.
describe("what the model really sends", () => {
  it("a dream given as an object or a list is still a dream", async () => {
    for (const dream of [
      { scene: "The bell rang", feeling: "inside a lamp." },
      ["The bell rang", "inside a lamp."],
    ]) {
      const { sleep, store } = setup({
        complete: async () => JSON.stringify({ ...NIGHT, dream }),
      });
      await sleep.consolidate(AGENT);
      expect(read("wiki/days/2026-03-10.md")).toContain(
        "The bell rang inside a lamp.",
      );
      expect(store.get(AGENT)?.outcomes?.[0]).toMatchObject({
        result: "applied",
        attempts: 1,
        dream: true,
      });
      rmSync(path.join(workspace(), "wiki/days/2026-03-10.md"));
    }
  });

  it("a reply cut off in its pages keeps the day, the dream and whole pages", async () => {
    const whole = JSON.stringify(
      {
        day: NIGHT.day,
        dream: NIGHT.dream,
        self: NIGHT.self,
        pages: NIGHT.pages,
      },
      null,
      2,
    );
    const cut = whole.slice(0, whole.indexOf("It stops at"));
    const { sleep, store } = setup({ complete: async () => cut });
    await sleep.consolidate(AGENT);
    expect(read("wiki/days/2026-03-10.md")).toContain("could not look at me");
    expect(read("MEMORY.md")).toContain("Tired, less angry.");
    expect(store.get(AGENT)?.outcomes?.[0]).toMatchObject({
      result: "applied",
      attempts: 1,
      repaired: true,
      pages: 1,
      dream: true,
    });
  });

  it("a raw line break inside a string is kept", async () => {
    const { sleep } = setup({
      complete: async () =>
        '{"day": {"summary": "s", "gist": "He came by.\nHe left."}}',
    });
    await sleep.consolidate(AGENT);
    expect(read("wiki/days/2026-03-10.md")).toContain("He came by.\nHe left.");
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
    const { output, dropped, repaired } = parseSleepOutput(
      JSON.stringify({
        day: { gist: "g" },
        pages: [
          { id: "a", theyThinkOfMe: { certainty: "sure" }, view: "kept" },
          {
            id: "b",
            notes: [
              { text: "no source" },
              { source: "seen it", certainty: "Sure ", text: "ok" },
            ],
          },
          { nope: true },
        ],
      }),
    );
    expect(repaired).toBe(false);
    expect(output.pages.map(({ id }) => id)).toEqual(["a", "b"]);
    expect(output.pages[0]).toMatchObject({ view: "kept" });
    expect(output.pages[0].theyThinkOfMe).toBeUndefined();
    expect(output.pages[1].notes).toEqual([
      { source: "seen it", certainty: "sure", text: "ok" },
    ]);
    expect(dropped).toEqual([
      "malformed parts of a (theyThinkOfMe)",
      "malformed parts of b (notes)",
      "malformed parts of a page (id)",
    ]);
  });

  it("loses a bad plan or dream, not the day", () => {
    const { output, dropped } = parseSleepOutput(
      JSON.stringify({
        day: { gist: "g" },
        self: {
          lately: "tired",
          plans: [
            { on: "tomorrow", text: "x" },
            { on: "2026-03-11", text: "y" },
          ],
        },
        dream: null,
      }),
    );
    expect(output.self).toEqual({
      lately: "tired",
      plans: [{ on: "2026-03-11", text: "y" }],
    });
    expect(output.dream).toBeUndefined();
    expect(dropped).toEqual([
      "malformed parts of self (plans)",
      "a dream that was not words",
    ]);
  });

  it("reads through a code fence and rejects non-JSON or no day", () => {
    expect(
      parseSleepOutput('```json\n{"day":{"summary":"s","gist":"g"}}\n```')
        .output.day.gist,
    ).toBe("g");
    expect(() => parseSleepOutput("no")).toThrow();
    expect(() => parseSleepOutput('{"pages": []}')).toThrow(/No usable day/);
  });
});
