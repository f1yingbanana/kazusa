import { rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CASES } from "./fixtures/cases.ts";
import { materialize, WORLDS } from "./fixtures/worlds.ts";
import { runCase } from "./eval.ts";
import { MemoryIndex } from "./index.ts";
import { lintWorld } from "./lint.ts";

const roots = new Map<string, string>();
const indexes = new Map<string, MemoryIndex>();

function indexOf(name: string): MemoryIndex {
  let index = indexes.get(name);
  if (!index) {
    const root = materialize(WORLDS[name]);
    roots.set(name, root);
    index = new MemoryIndex({
      worldDir: path.join(root, "world"),
      workspaceDir: (agentId) => path.join(root, "agents", agentId),
      anchors: WORLDS[name].anchors,
    });
    indexes.set(name, index);
  }
  return index;
}

afterAll(() => {
  for (const root of roots.values())
    rmSync(root, { recursive: true, force: true });
});

describe("the evaluation set", () => {
  it("has at least 100 cases across every category", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(100);
    expect(new Set(CASES.map(({ category }) => category)).size).toBeGreaterThan(
      9,
    );
  });

  it.each(Object.keys(WORLDS))("%s lints without errors", (name) => {
    const errors = lintWorld(indexOf(name).world()).filter(
      ({ level }) => level === "error",
    );
    expect(errors).toEqual([]);
  });
});

const keywordCases = CASES.filter((test) => !test.semantic);
describe.each([...new Set(keywordCases.map(({ category }) => category))])(
  "%s",
  (category) => {
    it.each(
      keywordCases
        .filter((test) => test.category === category)
        .map((test) => [test.name, test] as const),
    )("%s", (_name, test) => {
      const now = Date.parse(WORLDS[test.world].now);
      expect(runCase(indexOf(test.world), test, now).failures).toEqual([]);
    });
  },
);
