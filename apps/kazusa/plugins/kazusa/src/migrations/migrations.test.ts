import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StatRecord } from "@kazusa/client";
import { describe, expect, it, vi } from "vitest";
import type { LocationRecord } from "../location/location.ts";
import type { FamiliarityRecord } from "../memory/familiarity.ts";
import type { StateStore } from "../state.ts";
import { playAsMigration, type PlayAsDeps } from "./0082-play-as.ts";
import { runMigrations, type MigrationRecord } from "./index.ts";

function memory<T>(initial: Record<string, T> = {}): StateStore<T> & {
  readonly values: Map<string, T>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    lookup: async (key) => values.get(key),
    register: async (key, value) => {
      values.set(key, value);
    },
    entries: async () =>
      [...values].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
}

const log = { info: vi.fn(), warn: vi.fn() };

describe("runMigrations", () => {
  it("runs each once, in order, and tries a failed one again next start", async () => {
    const store = memory<MigrationRecord>();
    const ran: string[] = [];
    let fail = true;
    const migrations = [
      { id: "0090-b", run: async () => void ran.push("b") },
      {
        id: "0082-a",
        run: async () => {
          ran.push("a");
          if (fail) throw new Error("not yet");
          return "did a";
        },
      },
    ];
    await runMigrations(migrations, store, log, () => 1);
    expect(ran).toEqual(["a"]);
    fail = false;
    await runMigrations(migrations, store, log, () => 2);
    await runMigrations(migrations, store, log, () => 3);
    expect(ran).toEqual(["a", "a", "b"]);
    expect(store.values.get("0082-a")).toEqual({ at: 2, did: "did a" });
  });
});

describe("0082-play-as", () => {
  function world(oldChats = 1) {
    const root = mkdtempSync(path.join(tmpdir(), "kazusa-play-as-"));
    const wiki = path.join(root, "shared/wiki");
    const own = path.join(root, "workspaces/ann/wiki");
    mkdirSync(path.join(wiki, "characters"), { recursive: true });
    mkdirSync(path.join(own, "characters"), { recursive: true });
    writeFileSync(
      path.join(wiki, "characters/sensei.md"),
      "---\nname: Sensei\ncharacter_id: user:sensei\n---\n\n# Sensei\n",
    );
    writeFileSync(
      path.join(own, "characters/sensei.md"),
      "---\nname: Sensei\npeer_id: user:sensei\n---\n\nI owe [[user:sensei]] and [[user:sensei|them]] lunch.\n",
    );
    const play = vi.fn(async () => {});
    const deps = {
      operator: { id: "user:sensei", name: "Sensei" },
      worldWiki: wiki,
      ownWikis: () => [own],
      isAgent: (id: string) => ["ann", "sensei"].includes(id),
      stats: memory<StatRecord>({
        ann: {
          own: {},
          toward: {
            "user:sensei": {
              regard: { value: 7, at: 1, by: "reviewed" as const },
            },
          },
        },
      }),
      locations: memory<LocationRecord>({
        "user:sensei": { placeId: "office", since: 5 },
      }),
      familiarity: memory<FamiliarityRecord>({
        ann: {
          "user:sensei": { recent: [3], count: 1, first: 3, since: 3 },
        },
      }),
      oldChats: async () => oldChats,
      playing: async () => undefined,
      play,
    } satisfies PlayAsDeps;
    return { root, wiki, own, deps, play };
  }

  it("moves who the person was onto the character whose page was theirs, and plays them", async () => {
    const { wiki, own, deps, play } = world();
    expect(await playAsMigration(deps).run()).toMatch(/user:sensei is sensei/);
    expect(readFileSync(path.join(own, "characters/sensei.md"), "utf8")).toBe(
      "---\nname: Sensei\n---\n\nI owe [[sensei]] and [[sensei|them]] lunch.\n",
    );
    expect(
      readFileSync(path.join(wiki, "characters/sensei.md"), "utf8"),
    ).not.toContain("character_id");
    expect(deps.stats.values.get("ann")?.toward).toEqual({
      sensei: { regard: { value: 7, at: 1, by: "reviewed" as const } },
    });
    expect(deps.locations.values.get("sensei")).toEqual({
      placeId: "office",
      since: 5,
    });
    expect(deps.familiarity.values.get("ann")).toEqual({
      sensei: { recent: [3], count: 1, first: 3, since: 3 },
    });
    expect(play).toHaveBeenCalledWith("sensei");
  });

  it("still finds them by their page's claim when a retry follows a failure", async () => {
    const { wiki, deps } = world();
    writeFileSync(
      path.join(wiki, "characters/protagonist.md"),
      "---\nname: Me\ncharacter_id: user:me\n---\n\n# Me\n",
    );
    const flaky = { ...deps.stats, register: deps.stats.register };
    let fail = true;
    flaky.register = async (key, value) => {
      if (fail) throw new Error("database still starting");
      await deps.stats.register(key, value);
    };
    deps.stats.values.set("ann", {
      own: {},
      toward: { "user:me": { regard: { value: 7, at: 1, by: "reviewed" } } },
    });
    const migration = playAsMigration({
      ...deps,
      operator: { id: "user:me", name: "Me" },
      stats: flaky,
      isAgent: (id) => id === "protagonist",
    });
    await expect(migration.run()).rejects.toThrow("database still starting");
    fail = false;
    expect(await migration.run()).toMatch(/user:me is protagonist/);
    expect(deps.stats.values.get("ann")?.toward).toHaveProperty("protagonist");
    expect(
      readFileSync(path.join(wiki, "characters/protagonist.md"), "utf8"),
    ).not.toContain("character_id");
  });

  it("plays nobody in a world never played the old way", async () => {
    const { deps, play } = world(0);
    deps.locations.values.clear();
    await playAsMigration(deps).run();
    expect(play).not.toHaveBeenCalled();
  });

  it("does nothing when no page was the person's", async () => {
    const { deps } = world();
    const run = playAsMigration({
      ...deps,
      operator: { id: "user:nobody", name: "Nobody" },
    }).run;
    expect(await run()).toBeUndefined();
    expect(deps.stats.values.get("ann")?.toward).toHaveProperty("user:sensei");
  });
});
