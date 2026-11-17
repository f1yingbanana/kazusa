import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  StatCatalogSchema,
  StatDefinitionSchema,
  statMoved,
  statStride,
  type StatCatalog,
  type StatRecord,
} from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { bundledSkillText, describeTool } from "../skill-text.ts";
import { catalogFile } from "./catalog.ts";
import { createStats } from "./register.ts";
import { changesParameter, statsText } from "./stats.ts";

const OUTFITS = [{ name: "swimsuit", description: "a navy swimsuit" }];

const CATALOG: StatCatalog = StatCatalogSchema.parse([
  {
    name: "gear",
    description: "What you are wearing.",
    on: "character",
    kind: "choice",
    values: [
      { name: "uniform", description: "School uniform" },
      { name: "gym", description: "Gym clothes" },
    ],
    initial: "uniform",
    changedBy: "character",
    shown: "everyone",
  },
  {
    name: "hp",
    description: "Health.",
    on: "character",
    kind: "number",
    min: 0,
    max: 20,
    initial: 20,
    changedBy: "reviewed",
    shown: "self",
  },
  {
    name: "warmth",
    description: "How warmly they regard someone.",
    on: "pair",
    kind: "number",
    min: 0,
    max: 10,
    initial: 3,
    bands: [
      { name: "cold", min: 0 },
      { name: "friendly", min: 3, description: "Glad to see them" },
      { name: "close", min: 7 },
    ],
    changedBy: "reviewed",
    shown: "self",
  },
  {
    name: "chapter",
    description: "Where the story is.",
    on: "world",
    kind: "choice",
    values: [{ name: "one" }, { name: "two" }],
    initial: "one",
    changedBy: "manual",
    shown: "self",
  },
]);

/** A state only the player has. */
const HALL: StatCatalog = StatCatalogSchema.parse([
  {
    name: "tired",
    description: "How tired the player is.",
    on: "player",
    kind: "choice",
    values: [{ name: "rested" }, { name: "worn out", description: "Yawning" }],
    initial: "rested",
    changedBy: "manual",
    shown: "everyone",
  },
]);

function world(catalog: StatCatalog = CATALOG) {
  const records = new Map<string, StatRecord>();
  let now = 1_000;
  const file = path.join(mkdtempSync(path.join(tmpdir(), "stats-")), "s.json");
  writeFileSync(file, JSON.stringify(catalog));
  const changed: (string | undefined)[] = [];
  const stats = createStats({
    file: catalogFile(file),
    store: {
      lookup: async (key) => records.get(key),
      register: async (key, value) => void records.set(key, value),
      entries: async () => [],
    },
    now: () => now,
    isPerson: (id) => ["airi", "natsu", "user:sensei"].includes(id),
    isPlayer: (id) => id === "user:sensei",
    outfitsOf: (id) => (id === "natsu" ? OUTFITS : []),
    labelOf: async (id) => id[0].toUpperCase() + id.slice(1),
    text: (ref, values = {}) => `${ref} ${JSON.stringify(values)}`,
    onChange: (id) => changed.push(id),
  });
  return { stats, records, changed, advance: (ms: number) => (now += ms) };
}

describe("definitions", () => {
  it("refuses what cannot work", () => {
    const base = CATALOG[0];
    const bad = (change: object) =>
      StatDefinitionSchema.safeParse({ ...base, ...change }).success;
    expect(bad({})).toBe(true);
    expect(bad({ initial: "swimsuit" })).toBe(false);
    expect(bad({ on: "world" })).toBe(false);
    expect(bad({ changedBy: "reviewed" })).toBe(true);
    expect(bad({ on: "pair" })).toBe(false);
    expect(
      StatCatalogSchema.safeParse([{ ...base, name: "outfit" }]).success,
    ).toBe(false);
    expect(bad({ name: "Outfit" })).toBe(false);
    expect(StatCatalogSchema.safeParse([base, base]).success).toBe(false);
  });

  it("lets only the player set a state of theirs, read by others or nobody", () => {
    const ok = (change: object) =>
      StatDefinitionSchema.safeParse({ ...HALL[0], ...change }).success;
    expect(ok({})).toBe(true);
    expect(ok({ shown: "nobody" })).toBe(true);
    expect(ok({ shown: "self" })).toBe(false);
    expect(ok({ changedBy: "character" })).toBe(false);
    expect(ok({ changedBy: "reviewed" })).toBe(false);
  });

  it("reads a broken file as no states", () => {
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "stats-")),
      "s.json",
    );
    writeFileSync(file, "{ nope");
    const warned: string[] = [];
    expect(catalogFile(file, (m) => warned.push(m)).read()).toEqual([]);
    expect(warned).toHaveLength(1);
    expect(catalogFile(path.join(tmpdir(), "missing.json")).read()).toEqual([]);
  });
});

describe("setting by hand", () => {
  it("sets, clamps, resets and says what is wrong", async () => {
    const { stats, changed } = world();
    await stats.set({ name: "hp", characterId: "airi", value: 99 }, "user");
    expect((await stats.record("airi"))?.own.hp).toEqual({
      value: 20,
      at: 1_000,
      by: "user",
    });
    await stats.set(
      { name: "warmth", characterId: "airi", toward: "natsu", value: 8 },
      "user",
    );
    await stats.set({ name: "chapter", value: "two" }, "system");
    expect((await stats.world())?.own.chapter.value).toBe("two");
    expect(changed).toEqual(["airi", "airi", undefined]);
    await stats.set(
      { name: "warmth", characterId: "airi", toward: "natsu", value: null },
      "user",
    );
    expect((await stats.record("airi"))?.toward).toEqual({});
    await expect(
      stats.set(
        { name: "gear", characterId: "airi", value: "swimsuit" },
        "user",
      ),
    ).rejects.toThrow("one of: uniform, gym");
    await expect(stats.set({ name: "hp", value: 3 }, "user")).rejects.toThrow();
    await expect(
      stats.set({ name: "hp", characterId: "nobody", value: 3 }, "user"),
    ).rejects.toThrow("Nobody here");
    await expect(
      stats.set({ name: "mood", characterId: "airi", value: "x" }, "user"),
    ).rejects.toThrow("No state");
  });
});

describe("a character's own changes", () => {
  it("offers only states they set, and none without any", () => {
    expect(changesParameter(CATALOG)).toMatchObject({
      propertyNames: { enum: ["gear"] },
    });
    expect(changesParameter(CATALOG.slice(1))).toBeUndefined();
    const { stats } = world(CATALOG.slice(1));
    expect(stats.taskExtension.startTaskParametersFor?.("airi")).toEqual({});
    expect(stats.taskExtension.startTaskParametersFor?.("natsu")).toMatchObject(
      { changes: { propertyNames: { enum: ["outfit"] } } },
    );
  });

  it("is worded by the tools skill, with the states as its data", () => {
    const tool = describeTool(bundledSkillText(), {
      name: "start_task",
      parameters: {
        type: "object",
        properties: { changes: changesParameter(CATALOG) },
      },
    });
    const { description } = (
      tool.parameters.properties as { changes: { description: string } }
    ).changes;
    expect(description).toContain("{} when it changes none");
    expect(description).toContain(
      "gear: What you are wearing. One of: uniform (School uniform), gym (Gym clothes).",
    );
  });

  it("applies a real change at an activity start and drops the rest", async () => {
    const { stats } = world();
    const prepare = (
      changes: unknown,
      kind: "started" | "delayed" = "started",
    ) =>
      stats.taskExtension.prepare({
        kind,
        agentId: "airi",
        at: 1_000,
        task: {} as never,
        params: { changes },
      });
    const same = await prepare({ gear: "uniform", hp: 3, shoes: "red" });
    expect(same.note).toBeUndefined();
    expect((await prepare({ gear: "gym" }, "delayed")).note).toBeUndefined();
    const changed = await prepare({ gear: "gym" });
    expect(changed.note).toContain('"value":"gym"');
    expect(changed.payload).toEqual({ states: { gear: "gym" } });
    expect(await stats.record("airi")).toBeUndefined();
    await changed.commit({} as never);
    expect((await stats.record("airi"))?.own.gear).toMatchObject({
      value: "gym",
      by: "character",
    });
  });
});

describe("changing mid-activity", () => {
  it("changes what is theirs and says what is wrong with the rest", async () => {
    const { stats } = world();
    expect(await stats.change("airi", "gear", "gym")).toContain(
      "state-changed",
    );
    expect((await stats.record("airi"))?.own.gear).toMatchObject({
      value: "gym",
      by: "character",
    });
    expect(await stats.change("airi", "gear", "gym")).toContain(
      "state-unchanged",
    );
    await expect(stats.change("airi", "gear", "armour")).rejects.toThrow(
      "one of: uniform, gym",
    );
    await expect(stats.change("airi", "hp", 3)).rejects.toThrow(
      "state-not-yours",
    );
  });
});

describe("outfits", () => {
  it("is a state of whoever has outfits, worn until changed", async () => {
    const { stats } = world();
    expect(stats.statsOf("airi").map(({ name }) => name)).not.toContain(
      "outfit",
    );
    expect(stats.statsOf("natsu")[0]).toMatchObject({
      name: "outfit",
      initial: "usual",
      values: [{ name: "usual" }, { name: "swimsuit" }],
    });
    expect(stats.wearing("natsu")).toBeUndefined();
    await stats.change("natsu", "outfit", "swimsuit");
    expect(stats.wearing("natsu")).toBe("swimsuit");
    const seen = await stats.situation("airi", ["natsu"], "");
    expect(seen).toContain("Natsu `natsu`: outfit: swimsuit (a navy swimsuit)");
    // A state only someone else has is still said what it is.
    expect(seen).toContain("- outfit: What you are wearing.");
    await stats.set(
      { name: "outfit", characterId: "natsu", value: null },
      "user",
    );
    expect(stats.wearing("natsu")).toBeUndefined();
    await expect(
      stats.set({ name: "outfit", characterId: "airi", value: "x" }, "user"),
    ).rejects.toThrow("no outfits");
  });
});

describe("a state with bands", () => {
  const warmth = CATALOG.find(({ name }) => name === "warmth")!;
  const coarse = StatDefinitionSchema.parse({
    name: "energy",
    description: "How much they have left.",
    on: "character",
    kind: "number",
    min: 0,
    max: 2,
    initial: 1,
    bands: [
      { name: "low", min: 0 },
      { name: "fine", min: 1 },
      { name: "high", min: 2 },
    ],
    changedBy: "reviewed",
    shown: "self",
  });

  it("is told how fine it is, and moves a step at a time", () => {
    expect(statStride(warmth)).toBe(4);
    expect(statMoved(warmth, 3, "up")).toBe(4);
    expect(statMoved(warmth, 3, " Down ")).toBe(2);
    expect(statMoved(warmth, 0, "down")).toBe(0);
    expect(statMoved(warmth, 3, 9)).toBeUndefined();
    expect(statMoved(warmth, 3, "close")).toBeUndefined();
  });

  it("says nothing of small steps when its bands are a step apart", () => {
    expect(statStride(coarse)).toBe(1);
    const { stats } = world([coarse]);
    return expect(stats.review.text("airi", ["natsu"])).resolves.toContain(
      'To move it a step, give "up" or "down".',
    );
  });
});

describe("a night's review", () => {
  it("shows the reviewed states and where they stand", async () => {
    const { stats } = world();
    expect(await stats.review.text("airi", ["natsu", "airi", "ghost"]))
      .toBe(`hp: Health. A number from 0 to 20: give the new number, or a change like "-3".
warmth: How warmly they regard someone. From lowest to highest: cold, friendly (Glad to see them), close. It moves in small steps, about 4 from one of these to the next: give "up" or "down" for a step.
Yours now: hp: 20/20
Toward Natsu \`natsu\`: warmth: friendly, close to cold (Glad to see them)`);
    const none = world(CATALOG.filter(({ name }) => name === "gear"));
    expect(await none.stats.review.text("airi", ["natsu"])).toBeUndefined();
  });

  it("applies what the night changed, among the people of the day", async () => {
    const { stats } = world();
    await stats.review.apply("airi", ["natsu"], {
      own: { hp: 14, gear: "gym" },
      toward: { natsu: { warmth: "up" }, "user:sensei": { warmth: "up" } },
    });
    const record = await stats.record("airi");
    expect(record?.own.hp).toMatchObject({ value: 14, by: "reviewed" });
    expect(record?.own.gear).toBeUndefined();
    expect(record?.toward).toEqual({
      natsu: { warmth: { value: 4, at: 1_000, by: "reviewed" } },
    });
    await stats.review.apply("airi", ["natsu"], "nonsense");
    await stats.review.apply("airi", ["natsu"], { own: { hp: 14 } });
    expect((await stats.record("airi"))?.own.hp.at).toBe(1_000);
  });

  it("moves a state with bands a step at a time, and a plain number by a change", async () => {
    const { stats } = world();
    const night = (answer: unknown) =>
      stats.review.apply("airi", ["natsu"], answer);
    // A number is how far, which a model judges badly: only the way counts.
    await night({ toward: { natsu: { warmth: 9 } } });
    expect(await stats.record("airi")).toBeUndefined();
    await night({ toward: { natsu: { warmth: " Down " } } });
    await night({ own: { hp: "-3" } });
    await night({ own: { hp: "+1" } });
    const record = await stats.record("airi");
    expect(record?.toward.natsu.warmth.value).toBe(2);
    expect(record?.own.hp.value).toBe(18);
    // It stops at its ends.
    for (let times = 0; times < 5; times++)
      await night({ toward: { natsu: { warmth: "down" } } });
    expect((await stats.record("airi"))?.toward.natsu.warmth.value).toBe(0);
  });
});

describe("what a character reads", () => {
  it("shows their own, toward those at hand, others' that stand out, the world's", async () => {
    const { stats } = world();
    await stats.set(
      { name: "gear", characterId: "natsu", value: "gym" },
      "user",
    );
    await stats.set(
      { name: "warmth", characterId: "airi", toward: "user:sensei", value: 9 },
      "user",
    );
    expect(
      await stats.situation(
        "airi",
        ["natsu", "library"],
        "- `user:sensei`: hi",
      ),
    ).toBe(`gear: uniform (School uniform) · hp: 20/20
Toward Natsu \`natsu\`: warmth: friendly, close to cold (Glad to see them)
Toward User:sensei \`user:sensei\`: warmth: close
Natsu \`natsu\`: gear: gym (Gym clothes)
The world: chapter: one
What these are:
- gear: What you are wearing.
- hp: Health.
- warmth: How warmly they regard someone.
- chapter: Where the story is.`);
  });

  it("says nothing when nothing is shown", () => {
    expect(
      statsText({
        catalog: CATALOG.map((stat) => ({ ...stat, shown: "nobody" as const })),
        record: undefined,
        world: undefined,
        toward: [],
        present: [],
      }),
    ).toBeUndefined();
  });
});

describe("a state of the player", () => {
  it("is the player's alone to have", async () => {
    const { stats } = world(HALL);
    expect(stats.statsOf("airi").map(({ name }) => name)).toEqual([]);
    expect(stats.statsOf("user:sensei").map(({ name }) => name)).toEqual([
      "tired",
    ]);
    await stats.set(
      { name: "tired", characterId: "user:sensei", value: "worn out" },
      "user",
    );
    expect((await stats.record("user:sensei"))?.own.tired.value).toBe(
      "worn out",
    );
    await expect(
      stats.set(
        { name: "tired", characterId: "airi", value: "worn out" },
        "user",
      ),
    ).rejects.toThrow("a state of the player");
    await expect(
      stats.set({ name: "tired", value: "worn out" }, "user"),
    ).rejects.toThrow("needs who it is on");
    // Never a character's to change or to review.
    expect(stats.taskExtension.startTaskParametersFor?.("airi")).toEqual({});
    await expect(stats.change("airi", "tired", "worn out")).rejects.toThrow(
      "state-not-yours",
    );
    expect(await stats.review.text("airi", ["user:sensei"])).toBeUndefined();
  });

  it("is read by a character with the player, once it stands out", async () => {
    const { stats } = world(HALL);
    expect(await stats.situation("airi", ["user:sensei"], "")).toBeUndefined();
    await stats.set(
      { name: "tired", characterId: "user:sensei", value: "worn out" },
      "user",
    );
    expect(await stats.situation("airi", ["user:sensei"], ""))
      .toBe(`User:sensei \`user:sensei\`: tired: worn out (Yawning)
What these are:
- tired: How tired the player is.`);
    // Not by someone elsewhere, and never as their own.
    expect(await stats.situation("airi", ["natsu"], "")).toBeUndefined();
    await stats.set(
      { name: "tired", characterId: "user:sensei", value: null },
      "user",
    );
    expect(await stats.situation("airi", ["user:sensei"], "")).toBeUndefined();
  });

  it("stays unread when it is shown to nobody", async () => {
    const { stats } = world(
      StatCatalogSchema.parse([{ ...HALL[0], shown: "nobody" }]),
    );
    await stats.set(
      { name: "tired", characterId: "user:sensei", value: "worn out" },
      "user",
    );
    expect(await stats.situation("airi", ["user:sensei"], "")).toBeUndefined();
  });
});
