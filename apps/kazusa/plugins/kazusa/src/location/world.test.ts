import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lintMap, sharedWorld } from "./world.ts";

const place = (id: string, extra = ""): string =>
  `---\nplace_id: ${id}\nname: ${id}\nsummary: ${id}.\n${extra}---\n\n# ${id}\n`;

const connected =
  "connections:\n  - to: office\n    ways:\n      - { by: walk, minutes: 5 }\n";

/**
 * The OS can drop a change made just after a watcher starts, so these write
 * again until it lands, slower than the watcher settles.
 */
const SOON = { timeout: 10_000, interval: 500 };

describe("the world on disk", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true });
  });

  function wiki(): {
    dir: string;
    write: (file: string, text: string) => void;
  } {
    const dir = mkdtempSync(path.join(tmpdir(), "kazusa-world-"));
    roots.push(dir);
    mkdirSync(path.join(dir, "entities/places"), { recursive: true });
    mkdirSync(path.join(dir, "entities/characters"), { recursive: true });
    return {
      dir,
      write: (file, text) => {
        writeFileSync(path.join(dir, "entities", file), text);
      },
    };
  }

  it("takes in a new place and tells who is listening", async () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn: () => {}, onChange });
    expect([...(world()?.map.places.keys() ?? [])]).toEqual(["office"]);

    await vi.waitFor(() => {
      write("places/tavern.md", place("tavern", connected));
      expect(world()?.map.places.has("tavern")).toBe(true);
    }, SOON);
    expect(onChange).toHaveBeenCalled();
  });

  it("follows a new home on a character card", async () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const world = sharedWorld(dir, { warn: () => {}, onChange: () => {} });

    await vi.waitFor(() => {
      write("characters/ann.md", "---\nhome: office\n---\n");
      expect(world()?.homes.get("ann")).toBe("office");
    }, SOON);
  });

  it("keeps the map in use when an edit breaks it, until it's fixed", async () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const warn = vi.fn();
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn, onChange });

    await vi.waitFor(() => {
      write("places/tavern.md", place("tavern", "parent: nowhere\n"));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("keeping"));
    }, SOON);
    expect(world()?.map.places.has("tavern")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      write("places/tavern.md", place("tavern", connected));
      expect(world()?.map.places.has("tavern")).toBe(true);
    }, SOON);
  });

  it("names what's broken for the wiki's lint", () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    expect(lintMap(dir)).toEqual([]);
    write("characters/ann.md", "---\nhome: nowhere\n---\n");
    expect(lintMap(dir)[0]?.message).toContain("unknown home nowhere");
  });

  it("throws for a map that was broken from the start", () => {
    const { dir, write } = wiki();
    write("places/tavern.md", place("tavern", "parent: nowhere\n"));
    expect(() =>
      sharedWorld(dir, { warn: () => {}, onChange: () => {} }),
    ).toThrow();
  });

  it("serves every registration from one source", () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const handlers = { warn: () => {}, onChange: () => {} };
    const first = sharedWorld(dir, handlers);
    const second = sharedWorld(dir, handlers);
    expect(first()?.map.places.has("office")).toBe(true);
    expect(second()?.map.places.has("office")).toBe(true);
  });
});
