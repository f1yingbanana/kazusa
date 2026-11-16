import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTask } from "../taskman/types.ts";
import { materialize, WORLDS } from "./fixtures/worlds.ts";
import { registerMemory, type MemoryService } from "./register.ts";

vi.mock("../ledger.ts", () => ({ appendLedgerEntry: vi.fn(async () => {}) }));
vi.mock("../current-config.ts", () => ({ currentConfig: () => ({}) }));
import { appendLedgerEntry } from "../ledger.ts";

const HOUR = 3_600_000;
const NOON = Date.parse(WORLDS.saltmere.now);
const BEDTIME = NOON + 10 * HOUR;
const AGENT = "mara-vell";
type Tool = {
  name: string;
  execute: (
    id: string,
    input: unknown,
  ) => Promise<{ content: Array<{ text: string }> }>;
};
let root: string;
let now: number;
let memory: MemoryService;
let factories: Map<string, unknown>;
let reviewed: unknown[];
let turns: string[];
const call = async (name: string, input: unknown): Promise<string> => {
  const factory = factories.get(name) as (context: { agentId: string }) => Tool;
  return (await factory({ agentId: AGENT }).execute("id", input)).content[0]
    .text;
};
const file = (relative: string): string =>
  path.join(root, "agents", AGENT, relative);
const read = (relative: string): string => readFileSync(file(relative), "utf8");
const TOBIN = "wiki/entities/characters/tobin-vell.md";

const task = (type: string, minutes: number): ActiveTask => ({
  id: `task-${now}`,
  type: type as ActiveTask["type"],
  description: "In bed",
  startedAt: new Date(now).toISOString(),
  endAt: new Date(now + minutes * 60_000).toISOString(),
  duration: minutes,
});
/** `start_task`, as far as sleep sees it: what it says with the result. */
const start = async (
  type = "sleeping",
  minutes = 480,
): Promise<string | undefined> => {
  const lease = task(type, minutes);
  const prepared = await memory.sleep.taskExtension.prepare({
    kind: "started",
    agentId: AGENT,
    at: now,
    task: lease,
    params: {},
  });
  await prepared.commit(lease);
  return prepared.aside;
};
const night = (): unknown =>
  vi
    .mocked(appendLedgerEntry)
    .mock.calls.map(([, entry]) => entry)
    .find(
      (entry) =>
        (entry.metadata as { kind?: string } | undefined)?.kind ===
        "memory.consolidated",
    );

beforeEach(() => {
  vi.mocked(appendLedgerEntry).mockClear();
  // Each test gets its own world, nights and familiarity.
  for (const cell of ["kazusa.memory", "kazusa.memory.nights"])
    delete (globalThis as Record<symbol, unknown>)[Symbol.for(cell)];
  root = materialize(WORLDS.saltmere);
  now = BEDTIME;
  factories = new Map();
  reviewed = [];
  turns = [];
  const stores = new Map<string, Map<string, unknown>>();
  const api = {
    id: "kazusa",
    rootDir: fileURLToPath(new URL("../..", import.meta.url)),
    pluginConfig: {
      memory: {
        wikiDir: path.join(root, "world"),
        anchors: WORLDS.saltmere.anchors,
        embedding: { provider: "kazusa-no-key", model: "m" },
      },
    },
    logger: { warn: () => {} },
    registerHttpRoute: () => {},
    registerTool: (tool: Tool | ((context: unknown) => Tool)) => {
      const shape = typeof tool === "function" ? tool({ agentId: "x" }) : tool;
      factories.set(shape.name, tool);
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir: (_config: unknown, id: string) =>
          path.join(root, "agents", id),
      },
      state: {
        openKeyedStore: ({ namespace }: { namespace: string }) => {
          const store = stores.get(namespace) ?? new Map<string, unknown>();
          stores.set(namespace, store);
          return {
            lookup: async (key: string) => store.get(key),
            register: async (key: string, value: unknown) => {
              store.set(key, structuredClone(value));
            },
            entries: async () =>
              [...store].map(([key, value]) => ({ key, value })),
          };
        },
      },
      config: { current: () => ({}) },
      modelAuth: {
        isProviderApiKeyConfigured: () => false,
        resolveApiKeyForProvider: async () => ({
          source: "none",
          mode: "api-key",
        }),
      },
    },
  };
  memory = registerMemory(api as never, {
    clock: { time: () => now },
    states: {
      text: async (_agentId, people) =>
        people.length ? `trust toward ${people.join(", ")}: wary` : undefined,
      apply: async (_agentId, people, answer) => {
        reviewed.push({ people, answer });
      },
    },
    turn: {
      current: async (_agentId, text) => {
        turns.push(text);
      },
    },
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("going to bed", () => {
  it("answers a night's sleep with how to go over the day and what it touched", async () => {
    await memory.use(AGENT, ["tobin-vell", "lamp_hall"], NOON);
    const aside = await start();
    expect(aside).toContain("Before sleep takes you, go over the day");
    // Their own pages, whole, on who and what the day touched.
    expect(aside).toContain("### tobin-vell");
    expect(aside).toContain("He still owes me the rent for February.");
    expect(aside).toContain("### lamp_hall");
    // Not on what it didn't.
    expect(aside).not.toContain("### oswin-hale");
    // The states a night reviews, toward the people of the day.
    expect(aside).toContain("trust toward tobin-vell: wary");
  });

  it("says nothing more for a nap, or for anything that isn't sleep", async () => {
    expect(await start("sleeping", 90)).toBeUndefined();
    expect(await start("studying", 480)).toBeUndefined();
    await expect(
      call("reflect", { about: "today", view: "Fine." }),
    ).rejects.toThrow(
      "You only go over things like this as you fall asleep for the night.",
    );
  });
});

describe("a night gone over", () => {
  const goOver = async (): Promise<void> => {
    await memory.use(AGENT, ["tobin-vell"], NOON);
    await start();
    await call("reflect", {
      about: "tobin-vell",
      view: "He is trying, in his way.",
      openThreads: ["See if he keeps it up."],
      theyThinkOfMe: "Still afraid of my temper. (suspect)",
      states: { trust: "warm" },
    });
    await call("remember", {
      about: "tobin-vell",
      note: "Paid the February rent.",
    });
    await call("reflect", { about: "me", view: "Tired, less angry." });
    await call("reflect", {
      about: "today",
      view: "He came by with the rent and could not look at me.",
      summary: "Tobin apologized.",
      dream: "The bell rang inside a lamp.",
    });
  };

  it("rewrites what the day changed and keeps the rest", async () => {
    await goOver();
    const tobin = read(TOBIN);
    expect(tobin).toContain("He is trying, in his way.");
    expect(tobin).not.toContain("He thinks the coat makes him a man.");
    expect(tobin).toContain("- See if he keeps it up.");
    expect(tobin).toContain("Still afraid of my temper. (suspect)");
    expect(tobin).toContain("Paid the February rent.");
    // Older notes stay: nothing here is over the cap.
    expect(tobin).toContain("Lent him ten coppers.");
    expect(read("MEMORY.md")).toContain("## Lately\n\nTired, less angry.");
    const day = read("wiki/days/2026-03-10.md");
    expect(day).toContain('summary: "Tobin apologized."');
    expect(day).toContain('touched: ["tobin-vell"]');
    expect(day).toContain("## Dream\n\nThe bell rang inside a lamp.");
  });

  it("reviews the states toward the person reflected on", async () => {
    await goOver();
    expect(reviewed).toEqual([
      {
        people: ["tobin-vell"],
        answer: { toward: { "tobin-vell": { trust: "warm" } } },
      },
    ]);
  });

  it("is told once, with the dream, and can be undone whole", async () => {
    const before = read(TOBIN);
    await goOver();
    expect(night()).toMatchObject({
      agentId: AGENT,
      stream: "tasks",
      text: "You dreamt: The bell rang inside a lamp.",
      metadata: {
        payload: { pages: ["tobin-vell"], newPages: [], notes: 1 },
      },
    });
    const [run] = await memory.sleep.runs(AGENT);
    expect(Object.keys(run.preimages).sort()).toEqual([
      "MEMORY.md",
      "wiki/days/2026-03-10.md",
      TOBIN,
    ]);
    expect(await memory.sleep.restore(AGENT, run.id)).toBe(true);
    expect(read(TOBIN)).toBe(before);
    expect(existsSync(file("wiki/days/2026-03-10.md"))).toBe(false);
  });

  it("keeps a call that arrives after the closing one", async () => {
    // Calls sent together run in any order.
    await start();
    await call("reflect", { about: "today", view: "A long day." });
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    await vi.waitFor(async () => {
      const [run] = await memory.sleep.runs(AGENT);
      expect(run.postimages["wiki/entities/characters/ilse-dray.md"]).toContain(
        "Her knee gave out.",
      );
    });
    expect(await memory.sleep.runs(AGENT)).toHaveLength(1);
  });

  it("shows a view before replacing one they haven't read tonight", async () => {
    // Nothing of the day touched Oswin, so his page wasn't shown at bedtime.
    await start();
    const first = await call("reflect", {
      about: "oswin-hale",
      view: "He was almost kind today.",
    });
    expect(first).toContain("A bully with a badge.");
    expect(read("wiki/entities/characters/oswin-hale.md")).toContain(
      "A bully with a badge.",
    );
    await call("reflect", {
      about: "oswin-hale",
      view: "A bully with a badge, who was almost kind today.",
    });
    expect(read("wiki/entities/characters/oswin-hale.md")).toContain(
      "who was almost kind today.",
    );
  });

  it("is not gone over twice in one night's sleep", async () => {
    await goOver();
    // Woken at one, back to bed: the same night.
    now = BEDTIME + 3 * HOUR;
    expect(await start()).toBeUndefined();
    now = BEDTIME + 24 * HOUR;
    expect(await start()).toContain("Before sleep takes you");
  });
});

describe("a night nobody closed", () => {
  it("is kept as it stands when they next do something", async () => {
    await start();
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    expect(night()).toBeUndefined();
    now = BEDTIME + 8 * HOUR;
    await start("eating", 30);
    expect(night()).toMatchObject({ text: "You slept on it." });
    expect(await memory.sleep.runs(AGENT)).toHaveLength(1);
  });

  it("leaves no trace when nothing was gone over, and the next sleep offers again", async () => {
    await start();
    now = BEDTIME + HOUR;
    expect(await start()).toContain("Before sleep takes you");
    expect(night()).toBeUndefined();
    expect(await memory.sleep.runs(AGENT)).toHaveLength(0);
  });
});

describe("a night asked for by hand", () => {
  it("hands them a turn of their own with the same words", async () => {
    await memory.use(AGENT, ["tobin-vell"], NOON);
    await memory.sleep.consolidate(AGENT);
    expect(turns).toHaveLength(1);
    expect(turns[0]).toContain("Before sleep takes you");
    expect(turns[0]).toContain("### tobin-vell");
    await call("reflect", { about: "today", view: "Quiet." });
    expect(read("wiki/days/2026-03-10.md")).toContain("Quiet.");
  });
});
