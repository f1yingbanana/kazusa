import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parsePage } from "./page.ts";
import {
  applyOperation,
  newPage,
  withNote,
  withNoteCap,
  plansOn,
  withPlan,
} from "./writes.ts";

const note = {
  date: "2026-10-30",
  source: "told by natsu",
  certainty: "suspect",
  text: "It may\nclose.",
} as const;

describe("withNote", () => {
  it("puts the newest first, in a form the parser reads", () => {
    const once = withNote(
      "# Angel 24\n\nOpen.\n\n## Notes\n\n- 2026-10-01 · seen it · sure — Old.\n",
      note,
    );
    const page = parsePage(once, "entities/places/angel.md");
    expect(page.problems).toEqual([]);
    expect(page.notes.map(({ text }) => text)).toEqual([
      "It may close.",
      "Old.",
    ]);
  });

  it("makes the section on a page without one", () => {
    const page = parsePage(
      withNote(newPage("Tea", "seen it"), note),
      "concepts/tea.md",
    );
    expect(page.name).toBe("Tea");
    expect(page.notes).toHaveLength(1);
  });
});

describe("withNoteCap", () => {
  it("drops the oldest but never what they have always known", () => {
    const next = withNoteCap(
      "## Notes\n\n- 2026-03-03 · seen it · sure — c\n- 2026-03-02 · seen it · sure — b\n- 2026-01-01 · always known · sure — a\n",
      1,
    );
    expect(next).toContain("— c");
    expect(next).not.toContain("— b");
    expect(next).toContain("— a");
  });
});

describe("withPlan", () => {
  it("adds to the day's section without touching the next", () => {
    const raw =
      "# Memory\n\n## Plans recorded for 2026-10-30\n\n- Lunch.\n\n## Long-Term Goals\n\n- Pass.\n";
    const next = withPlan(raw, "2026-10-30", "Meet Airi.");
    expect(next).toContain("- Lunch.\n- Meet Airi.\n\n## Long-Term Goals");
    expect(withPlan(raw, "2026-10-31", "Bake.")).toContain(
      "## Plans recorded for 2026-10-31\n\n- Bake.\n",
    );
  });
});

describe("plansOn", () => {
  it("reads one day's plans, each as one line", () => {
    const raw =
      "## Plans recorded for 2026-10-30\n\n- [HARD_BLOCK] 16:00 Meet Airi\n  at the club room.\n- Bake.\n\n## Plans recorded for 2026-10-31\n\n- Rest.\n";
    expect(plansOn(raw, "2026-10-30")).toEqual([
      "[HARD_BLOCK] 16:00 Meet Airi at the club room.",
      "Bake.",
    ]);
    expect(plansOn(raw, "2026-11-01")).toEqual([]);
  });
});

describe("applyOperation", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "kazusa-writes-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps an edit made while the operation ran", () => {
    const file = path.join(root, "page.md");
    writeFileSync(file, "first");
    let raced = false;
    applyOperation(file, (current) => {
      if (!raced) {
        raced = true;
        writeFileSync(file, "human edit");
      }
      return `${current} + note`;
    });
    expect(readFileSync(file, "utf8")).toBe("human edit + note");
  });

  it("creates what is missing", () => {
    const file = path.join(root, "deep", "er", "page.md");
    applyOperation(file, (current) => current ?? "new");
    expect(readFileSync(file, "utf8")).toBe("new");
  });
});
