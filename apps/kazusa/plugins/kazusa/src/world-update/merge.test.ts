import { describe, expect, it } from "vitest";
import { mergeMarkdown, sameMarkdown } from "./merge.ts";

const world = { owner: "world", layout: "keep" } as const;
const personal = { owner: "personal", layout: "keep" } as const;

const page = (front: string, body: string) => `---\n${front}\n---\n\n${body}\n`;

describe("mergeMarkdown", () => {
  it("takes the creator's version of what play never touched", () => {
    const base = page("name: Old\nsummary: Old summary.", "# Old\n\nOld lead.");
    const template = page(
      "name: New\nsummary: New summary.",
      "# New\n\nNew lead.",
    );
    const live = page(
      "name: Old\nsummary: Old summary.\nseen: 2026-11-01",
      "# Old\n\nOld lead.",
    );
    const merged = mergeMarkdown(base, template, live, personal);
    expect(merged.conflicts).toEqual([]);
    expect(merged.text).toContain("New lead.");
    expect(merged.text).toContain("seen: 2026-11-01");
    expect(merged.text).toContain("summary: New summary.");
  });

  it("keeps sections only play wrote, and what only play changed", () => {
    const base = "# Memory\n\n## Long-Term Goals\n\n- Pass exams.\n";
    const template =
      "# Memory\n\n## Long-Term Goals\n\n- Pass exams.\n\n## My usual week\n\n- Class.\n";
    const live =
      "# Memory\n\n## Long-Term Goals\n\n- Pass exams, somehow.\n\n## Lately\n\nTired.\n";
    const merged = mergeMarkdown(base, template, live, personal);
    expect(merged.conflicts).toEqual([]);
    expect(merged.text).toContain("Pass exams, somehow.");
    expect(merged.text).toContain("## My usual week");
    expect(merged.text).toContain("## Lately");
  });

  it("reports text both sides changed and keeps the live side", () => {
    const base = page("name: A", "# A\n\nOne.");
    const template = page("name: A", "# A\n\nTwo.");
    const live = page("name: A", "# A\n\nThree.");
    const merged = mergeMarkdown(base, template, live, world);
    expect(merged.conflicts.map(({ part }) => part)).toEqual(["lead"]);
    expect(merged.text).toContain("Three.");
  });

  it("lets a character's own fields win, but follows the world's name", () => {
    const template = page(
      "place_id: x\nname: Trinity Square\nlearned: always known",
      "Mine.",
    );
    const live = page(
      "place_id: x\nname: Trinity Plaza\nlearned: been there",
      "",
    );
    const merged = mergeMarkdown(undefined, template, live, personal);
    expect(merged.conflicts).toEqual([]);
    expect(merged.keptTheirs).toBe(1);
    expect(merged.text).toContain("name: Trinity Square");
    expect(merged.text).toContain("learned: been there");
    expect(merged.text).toContain("Mine.");
  });

  it("keeps or resets an arranged map position", () => {
    const base = page("name: P", "# P");
    const template = page("name: P\nparent: q", "# P");
    const live = page("name: P\nmap: { x: 0.1, y: 0.2 }", "# P");
    expect(mergeMarkdown(base, template, live, world).text).toContain(
      "map: { x: 0.1, y: 0.2 }",
    );
    expect(
      mergeMarkdown(base, template, live, { ...world, layout: "reset" }).text,
    ).not.toContain("map:");
  });

  it("unions notes and history line by line", () => {
    const base = "# P\n\n## History\n\n- 2026-01-01 — Built.\n";
    const template =
      "# P\n\n## History\n\n- 2026-01-01 — Built.\n- 2026-02-01 — Repainted.\n";
    const live =
      "# P\n\n## History\n\n- 2026-01-01 — Built.\n- 2026-11-02 — Burned down.\n";
    const merged = mergeMarkdown(base, template, live, world);
    expect(merged.conflicts).toEqual([]);
    expect(merged.text).toContain("Repainted.");
    expect(merged.text).toContain("Burned down.");
  });

  it("ignores wrapping when deciding what changed", () => {
    const a = page(
      'summary:\n  "One long\n  summary."',
      "# A\n\nSome text\nwrapped.",
    );
    const b = page('summary: "One long summary."', "# A\n\nSome text wrapped.");
    expect(sameMarkdown(a, b)).toBe(true);
  });
});
