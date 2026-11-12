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

  it("takes in what works of a broken edit, and says what doesn't", async () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const warn = vi.fn();
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn, onChange });

    await vi.waitFor(() => {
      write(
        "places/tavern.md",
        place("tavern", "parent: nowhere\n" + connected),
      );
      expect(world()?.map.places.has("tavern")).toBe(true);
    }, SOON);
    expect(world()?.map.places.get("tavern")?.parent).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown parent nowhere"),
    );
    expect(onChange).toHaveBeenCalled();
  });

  it("leaves out a page that doesn't parse, and keeps the rest", () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    write("places/broken.md", "---\nplace_id: broken\n---\n");
    const world = sharedWorld(dir, { warn: () => {}, onChange: () => {} });
    expect([...(world()?.map.places.keys() ?? [])]).toEqual(["office"]);
    expect(lintMap(dir)).toEqual([
      expect.objectContaining({ page: "world/broken", level: "error" }),
    ]);
  });

  it("names what's broken for the wiki's lint", () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    expect(lintMap(dir)).toEqual([]);
    write("characters/ann.md", "---\nhome: nowhere\n---\n");
    expect(lintMap(dir)[0]?.message).toContain("home nowhere isn't on the map");
  });

  it("reports a backdrop naming no set, and reloads when the library changes", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kazusa-world-"));
    roots.push(root);
    const dir = path.join(root, "shared/wiki");
    const library = path.join(root, "shared/backdrops");
    mkdirSync(path.join(dir, "entities/places"), { recursive: true });
    mkdirSync(path.join(library, "street"), { recursive: true });
    writeFileSync(path.join(library, "street/day.webp"), "day");
    writeFileSync(
      path.join(dir, "entities/places/office.md"),
      place("office", "backdrop: lobby\n"),
    );
    writeFileSync(
      path.join(dir, "entities/places/street.md"),
      place("street", "backdrop: street\n" + connected),
    );
    expect(lintMap(dir)).toEqual([
      {
        level: "error",
        page: "world/office",
        message: expect.stringContaining("backdrop lobby isn't a set"),
      },
    ]);
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn: () => {}, onChange });
    expect(world()?.map.places.get("office")?.backdrop).toBeUndefined();
    expect(world()?.map.places.get("street")?.backdrop).toBe("street");
    onChange.mockClear();

    // The set arrives: the map takes it without a page edit.
    await vi.waitFor(() => {
      mkdirSync(path.join(library, "lobby"), { recursive: true });
      writeFileSync(path.join(library, "lobby/night.webp"), "night");
      expect(world()?.map.places.get("office")?.backdrop).toBe("lobby");
    }, SOON);
    expect(onChange).toHaveBeenCalled();
    expect(world()?.backdrops.sets.get("lobby")?.files.has("night")).toBe(true);
    expect(lintMap(dir)).toEqual([]);
  });

  it("follows a backdrop library made after it started", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "kazusa-world-"));
    roots.push(root);
    const dir = path.join(root, "shared/wiki");
    const library = path.join(root, "shared/backdrops");
    mkdirSync(path.join(dir, "entities/places"), { recursive: true });
    writeFileSync(
      path.join(dir, "entities/places/office.md"),
      place("office", "backdrop: lobby\n"),
    );
    const world = sharedWorld(dir, { warn: () => {}, onChange: () => {} });
    expect(world()?.map.places.get("office")?.backdrop).toBeUndefined();

    // The first import makes the library, then fills it.
    await vi.waitFor(() => {
      mkdirSync(path.join(library, "lobby"), { recursive: true });
      writeFileSync(path.join(library, "lobby/day.webp"), "day");
      expect(world()?.map.places.get("office")?.backdrop).toBe("lobby");
    }, SOON);
    await vi.waitFor(() => {
      writeFileSync(path.join(library, "lobby/night.webp"), "night");
      expect(world()?.backdrops.sets.get("lobby")?.files.has("night")).toBe(
        true,
      );
    }, SOON);
  });

  it("loads a map that was broken from the start", () => {
    const { dir, write } = wiki();
    write("places/tavern.md", place("tavern", "parent: nowhere\n"));
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn: () => {}, onChange });
    expect(world()?.map.places.has("tavern")).toBe(true);
    // The first load is a change: places may have gone while it was stopped.
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ before: undefined }),
    );
  });

  it("takes an edited place_id as a rename", async () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn: () => {}, onChange });
    await vi.waitFor(() => {
      write("places/office.md", place("study"));
      expect(world()?.map.places.has("study")).toBe(true);
    }, SOON);
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ renames: new Map([["office", "study"]]) }),
    );
  });

  it("carries a rename announced before its files land", () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn: () => {}, onChange });
    world.expectRename("office", "study");
    rmSync(path.join(dir, "entities/places/office.md"));
    write("places/study.md", place("study"));
    world.reload();
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ renames: new Map([["office", "study"]]) }),
    );
  });

  it("tells nobody when nothing the map reads changed", () => {
    const { dir, write } = wiki();
    write("places/office.md", place("office"));
    const onChange = vi.fn();
    const world = sharedWorld(dir, { warn: () => {}, onChange });
    onChange.mockClear();
    world.reload();
    expect(onChange).not.toHaveBeenCalled();
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
