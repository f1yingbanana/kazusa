import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  backdropsBeside,
  backdropsOnWire,
  readBackdrops,
  readBackdropSet,
} from "./backdrops.ts";

async function libraryWith(
  sets: Readonly<Record<string, readonly string[]>>,
  manifests: Readonly<Record<string, unknown>> = {},
): Promise<string> {
  const library = await mkdtemp(path.join(tmpdir(), "kazusa-backdrops-"));
  for (const [set, files] of Object.entries(sets)) {
    await mkdir(path.join(library, set));
    for (const file of files)
      await writeFile(path.join(library, set, file), file);
  }
  for (const [set, manifest] of Object.entries(manifests))
    await writeFile(
      path.join(library, set, "backdrops.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  return library;
}

describe("backdrop library", () => {
  it("reads sets with pictures, by state and time", async () => {
    const library = await libraryWith(
      {
        classroom: [
          "day.webp",
          "dusk.png",
          "festival-day.webp",
          "late-night.webp",
          "Night.webp",
        ],
        hallway: ["day.jpg"],
        empty: ["notes.txt"],
        "Bad Set": ["day.webp"],
      },
      { classroom: { states: { festival: "decorated for the festival" } } },
    );
    const { sets } = readBackdrops(library);
    expect([...sets.keys()]).toEqual(["classroom", "hallway"]);
    const classroom = sets.get("classroom");
    expect([...(classroom?.files.keys() ?? [])]).toEqual([
      "day",
      "dusk",
      "festival-day",
      "late-night",
    ]);
    expect(classroom?.files.get("festival-day")).toMatchObject({
      state: "festival",
      time: "day",
    });
    // Only a declared first word is a state.
    expect(classroom?.files.get("late-night")).toMatchObject({
      time: "late-night",
    });
    expect(classroom?.files.get("late-night")).not.toHaveProperty("state");
    expect([...(classroom?.states ?? [])]).toEqual([
      ["festival", "decorated for the festival"],
    ]);
    expect(backdropsOnWire(readBackdrops(library)).hallway).toEqual({
      files: [
        {
          name: "day",
          url: expect.stringMatching(
            /^\/kazusa\/backdrop\?set=hallway&name=day&v=\w+$/,
          ),
          time: "day",
        },
      ],
    });
  });

  it("keeps the pictures when the manifest is broken", async () => {
    const library = await libraryWith(
      { park: ["rain-day.webp"] },
      { park: "{ broken" },
    );
    expect(readBackdropSet(library, "park")?.files.get("rain-day")).toEqual(
      expect.objectContaining({ time: "rain-day" }),
    );
  });

  it("reaches nothing outside the library, and has nothing without one", async () => {
    const library = await libraryWith({ park: ["day.webp"] });
    expect(readBackdropSet(library, "..")).toBeUndefined();
    expect(readBackdropSet(library, "park/..")).toBeUndefined();
    expect(readBackdrops(path.join(library, "missing")).sets.size).toBe(0);
  });

  it("changes its key with any picture or manifest", async () => {
    const library = await libraryWith({ park: ["day.webp"] });
    const before = readBackdrops(library).key;
    expect(readBackdrops(library).key).toBe(before);
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(library, "park", "day.webp"), later, later);
    const replaced = readBackdrops(library).key;
    expect(replaced).not.toBe(before);
    await writeFile(path.join(library, "park", "backdrops.json"), "{}");
    expect(readBackdrops(library).key).not.toBe(replaced);
  });

  it("lives beside the World Wiki", () => {
    expect(backdropsBeside(path.join("world", "shared", "wiki"))).toBe(
      path.join("world", "shared", "backdrops"),
    );
  });
});
