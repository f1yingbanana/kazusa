import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
/** What the world's states say at bedtime, when a test needs it long. */
let statesText: string | undefined;
/** The nights' store refuses writes, as a database under load does. */
let storeDown: boolean;
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
  for (const cell of [
    "kazusa.memory",
    "kazusa.memory.nights",
    "kazusa.memory.asked",
    "kazusa.memory.owed",
  ])
    delete (globalThis as Record<symbol, unknown>)[Symbol.for(cell)];
  root = materialize(WORLDS.saltmere);
  // Its own state folder: the vectors database is one file per state folder.
  vi.stubEnv("OPENCLAW_STATE_DIR", path.join(root, "state"));
  now = BEDTIME;
  factories = new Map();
  reviewed = [];
  turns = [];
  storeDown = false;
  statesText = undefined;
  const stores = new Map<string, Map<string, unknown>>();
  const api = {
    id: "kazusa",
    rootDir: fileURLToPath(new URL("../..", import.meta.url)),
    pluginConfig: {
      memory: {
        wikiDir: path.join(root, "world"),
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
              if (storeDown && namespace === "memory")
                throw new Error("SQLite worker queue capacity reached");
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
        statesText ??
        (people.length ? `trust toward ${people.join(", ")}: wary` : undefined),
      apply: async (_agentId, people, answer) => {
        reviewed.push({ people, answer });
        return { moved: ["trust: warm"], left: ["luck"] };
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
  vi.unstubAllEnvs();
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
    expect(aside).toContain("trust toward tobin-vell");
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
    // The run that went to bed is over, and the night with it.
    await memory.sleep.runEnded(AGENT);
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
    expect(reviewed).toMatchObject([
      { answer: { toward: { "tobin-vell": { trust: "warm" } } } },
    ]);
  });

  it("reviews states toward the player under the id the player goes by", async () => {
    // Live, a night moved its regard for Sensei and nothing changed: their
    // page is `sensei`, and states are kept under `user:sensei`.
    mkdirSync(path.dirname(file("wiki/entities/characters/sensei.md")), {
      recursive: true,
    });
    writeFileSync(
      file("wiki/entities/characters/sensei.md"),
      "---\nname: Sensei\npeer_id: user:sensei\n---\n\n# Sensei\n\nKeeps odd hours.\n",
    );
    await memory.use(AGENT, ["user:sensei"], NOON);
    const aside = await start();
    expect(aside).toContain("user:sensei");
    await call("reflect", { about: "Sensei", states: { trust: "warm" } });
    expect(reviewed).toMatchObject([
      { answer: { toward: { "user:sensei": { trust: "warm" } } } },
    ]);
    expect((reviewed[0] as { people: string[] }).people).toContain(
      "user:sensei",
    );
  });

  it("closes the day they were up for when bed comes after midnight", async () => {
    now = BEDTIME + 3 * HOUR;
    await start();
    await call("reflect", { about: "today", view: "Too long." });
    expect(read("wiki/days/2026-03-10.md")).toContain("Too long.");
  });

  it("takes a date for the day, never for a page of its own", async () => {
    // Live, back after days away, one wrote the day down as `2026-11-03`: it
    // became a concept page, and the day and its dream were lost.
    now = BEDTIME + 3 * HOUR;
    await start();
    await call("reflect", { about: "2026-03-11", view: "Past midnight." });
    expect(read("wiki/days/2026-03-10.md")).toContain("Past midnight.");
    expect(existsSync(file("wiki/concepts/2026_03_11.md"))).toBe(false);
  });

  it("files the day under an earlier date when that is the one they name", async () => {
    await start();
    await call("reflect", { about: "2026-03-08", view: "Days ago." });
    expect(read("wiki/days/2026-03-08.md")).toContain("Days ago.");
    expect(existsSync(file("wiki/concepts/2026_03_08.md"))).toBe(false);
  });

  it("dates a note made in bed after midnight to the day they were up for", async () => {
    // Dated tomorrow, the next night reads it as that day's news and goes
    // over it again.
    now = BEDTIME + 3 * HOUR;
    await start();
    await call("remember", {
      about: "Tobin",
      note: "Paid me back.",
      source: "seen it",
      certainty: "sure",
    });
    expect(read(TOBIN)).toContain(
      "- 2026-03-10 · seen it · sure — Paid me back.",
    );
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

  it("keeps a call that arrives after the day's, and none after the run", async () => {
    // Calls sent together run in any order: the day's ends nothing.
    await start();
    await call("reflect", { about: "today", view: "A long day." });
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    expect(await call("reflect", { about: "Tonight", view: "Again." })).toBe(
      "The day is kept.",
    );
    await memory.sleep.runEnded(AGENT);
    const runs = await memory.sleep.runs(AGENT);
    expect(runs).toHaveLength(1);
    expect(
      runs[0].postimages["wiki/entities/characters/ilse-dray.md"],
    ).toContain("Her knee gave out.");
    expect(read("wiki/days/2026-03-10.md")).not.toContain("Again.");
    // Awake again, what they note is no part of last night.
    await call("remember", { about: "ilse-dray", note: "She is on a stick." });
    expect((await memory.sleep.runs(AGENT))[0].postimages).toEqual(
      runs[0].postimages,
    );
    await expect(
      call("reflect", { about: "ilse-dray", view: "Frail." }),
    ).rejects.toThrow("as you fall asleep");
  });

  it("shows the pages they have before making one for an unknown name", async () => {
    await start();
    // Saying it is new on a first try proves nothing: they are shown first.
    const asked = await call("reflect", {
      about: "February rent",
      view: "It is a weight between us.",
      new: true,
    });
    expect(asked).toContain("You have no page called February rent.");
    expect(asked).toContain("(`tobin-vell`)");
    expect(existsSync(file("wiki/concepts/february_rent.md"))).toBe(false);
    // The same while awake.
    await memory.sleep.runEnded(AGENT);
    expect(
      await call("remember", {
        about: "February rent",
        note: "Still owed.",
        new: true,
      }),
    ).toBe("Noted, about February rent.");
    expect(read("wiki/concepts/february_rent.md")).toContain("Still owed.");
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

  it("drops old notes only from a page tonight showed whole", async () => {
    const notes = (file: string): number =>
      read(file).match(/^- \d{4}-/gm)?.length ?? 0;
    const many = (relative: string): void => {
      const old = Array.from(
        { length: 31 },
        (_, at) =>
          `- 2025-01-${String(at + 1).padStart(2, "0")} · seen it · sure — Old thing ${at}.`,
      ).join("\n");
      writeFileSync(
        file(relative),
        read(relative).replace(/## Notes\n\n/, `## Notes\n\n${old}\n`),
      );
    };
    const OSWIN = "wiki/entities/characters/oswin-hale.md";
    many(TOBIN);
    many(OSWIN);
    // The day touched Tobin, so bedtime showed his page, notes and all. Of
    // Oswin's only the view is shown, when a new one is first given.
    await memory.use(AGENT, ["tobin-vell"], NOON);
    await start();
    for (const about of ["tobin-vell", "oswin-hale", "oswin-hale"])
      await call("reflect", { about, view: "Seen plainly, for once." });
    await memory.sleep.runEnded(AGENT);
    expect(notes(TOBIN)).toBe(30);
    expect(notes(OSWIN)).toBe(32);
  });

  it("counts as their night when all it did was move a state", async () => {
    await memory.use(AGENT, ["tobin-vell"], NOON);
    await start();
    await call("reflect", { about: "tobin-vell", states: { trust: "up" } });
    await memory.sleep.runEnded(AGENT);
    expect(night()).toMatchObject({ text: "You slept on it." });
    expect(await memory.sleep.runs(AGENT)).toHaveLength(1);
    // Back to bed later the same night: the day is not gone over again.
    now = BEDTIME + 3 * HOUR;
    expect(await start()).toBeUndefined();
  });

  it("is still their night, and kept later, when it could not be kept", async () => {
    await start();
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    storeDown = true;
    await memory.sleep.runEnded(AGENT);
    // Told all the same: the pages are written whether or not the run is kept.
    expect(night()).toMatchObject({ text: "You slept on it." });
    // Back to bed with the store still down: the day is not gone over again.
    now = BEDTIME + 3 * HOUR;
    expect(await start()).toBeUndefined();
    storeDown = false;
    const runs = await memory.sleep.runs(AGENT);
    expect(runs).toHaveLength(1);
    expect(runs[0].at).toBe(BEDTIME);
    // Kept with what the night found, so it can still be undone.
    expect(await memory.sleep.restore(AGENT, runs[0].id)).toBe(true);
    expect(await memory.sleep.runs(AGENT)).toHaveLength(0);
  });

  it("is not offered again when they go back to bed in the same run", async () => {
    await memory.use(AGENT, ["tobin-vell"], NOON);
    expect(await start()).toContain("Before sleep takes you");
    await call("reflect", { about: "tobin-vell", states: { trust: "up" } });
    // A second sleep in the same run: the night they are going over stands.
    expect(await start()).toBeUndefined();
    await call("reflect", { about: "today", view: "Quiet." });
    await memory.sleep.runEnded(AGENT);
    expect(await memory.sleep.runs(AGENT)).toHaveLength(1);
  });

  it("shows no page that the rest of what it says leaves no room for", async () => {
    await memory.use(AGENT, ["tobin-vell"], NOON);
    // States that take nearly all a turn can be handed.
    statesText = "trust: wary\n".repeat(2_600);
    const aside = await start();
    expect(aside).toContain("trust: wary");
    expect(aside).not.toContain("### tobin-vell");
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

describe("a night that never wrote the day down", () => {
  it("is kept and tidied all the same when its run ends", async () => {
    writeFileSync(
      file("MEMORY.md"),
      "# Memory\n\n## Plans recorded for 2026-03-09\n\n- Mend the net.\n\n## Plans recorded for 2026-03-12\n\n- Market day.\n",
    );
    await start();
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    expect(night()).toBeUndefined();
    await memory.sleep.runEnded(AGENT);
    expect(night()).toMatchObject({ text: "You slept on it." });
    expect(await memory.sleep.runs(AGENT)).toHaveLength(1);
    // Plans for days gone by went with it, without the model saying so.
    expect(read("MEMORY.md")).not.toContain("Mend the net.");
    expect(read("MEMORY.md")).toContain("Market day.");
  });

  it("leaves no trace when nothing was gone over, and the next sleep offers again", async () => {
    await start();
    await memory.sleep.runEnded(AGENT);
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
    // A run already under way ends first: the night is for the turn to come.
    await memory.sleep.runEnded(AGENT);
    memory.sleep.runStarted(AGENT);
    expect(
      await call("reflect", { about: "tobin-vell", states: { trust: "up" } }),
    ).toBe("Kept, about Tobin Vell. Now trust: warm. Left as they were: luck.");
    await call("reflect", { about: "today", view: "Quiet." });
    expect(read("wiki/days/2026-03-10.md")).toContain("Quiet.");
    await memory.sleep.runEnded(AGENT);
    expect(night()).toMatchObject({ text: "You slept on it." });
  });

  it("is not begun by a note in the run it was asked during", async () => {
    await memory.sleep.consolidate(AGENT);
    // Still the run under way: what it notes is the day's, not the night's.
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    await memory.sleep.runEnded(AGENT);
    expect(night()).toBeUndefined();
    memory.sleep.runStarted(AGENT);
    await call("reflect", { about: "today", view: "Quiet." });
    await memory.sleep.runEnded(AGENT);
    expect(night()).toMatchObject({ text: "You slept on it." });
  });

  it("is dropped when its turn comes and goes without a call", async () => {
    // Live, the turn ran out of thinking time before its first call.
    await memory.sleep.consolidate(AGENT);
    memory.sleep.runStarted(AGENT);
    await memory.sleep.runEnded(AGENT);
    await call("remember", { about: "ilse-dray", note: "Her knee gave out." });
    await memory.sleep.runEnded(AGENT);
    expect(night()).toBeUndefined();
    expect(await memory.sleep.runs(AGENT)).toHaveLength(0);
  });

  it("leaves no night behind when no turn could be handed over", async () => {
    turns = undefined as never;
    await expect(memory.sleep.consolidate(AGENT)).rejects.toThrow();
    await expect(
      call("reflect", { about: "today", view: "Quiet." }),
    ).rejects.toThrow("as you fall asleep");
  });
});
