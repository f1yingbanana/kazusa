import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { placesNamedIn, readPlaceCards, writePlaceStub } from "./knowledge.ts";
import { buildMap, type Place } from "./map.ts";

function place(id: string, extra: Partial<Omit<Place, "id">> = {}): Place {
  return {
    id,
    name: id,
    aliases: [],
    summary: `${id}.`,
    entryMinutes: 1,
    connections: [],
    bodyMarkdown: "",
    ...extra,
  };
}

const map = buildMap([
  place("school", {
    name: "School",
    connections: [{ to: "dorm", ways: [{ by: "walk", minutes: 10 }] }],
  }),
  place("gate", { name: "Main Gate", parent: "school" }),
  place("library", { name: "Library", parent: "school" }),
  place("dorm", { name: "Dorm" }),
  place("room", { name: "Kazusa's Room", parent: "dorm" }),
  place("shop", {
    name: "Secret Shop",
    aliases: ["the sweets shop"],
    parent: "dorm",
  }),
]);

const workspaces: string[] = [];
afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true });
});
const workspace = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "kazusa-workspace-"));
  workspaces.push(dir);
  return dir;
};

describe("place knowledge", () => {
  it("starts a card once and never overwrites it", async () => {
    const dir = workspace();
    const library = map.places.get("library")!;
    const at = Date.parse("2026-10-27T16:00:00.000Z");
    expect(await writePlaceStub(dir, library, at)).toBe(true);
    const file = path.join(dir, "wiki/entities/places/library.md");
    writeFileSync(
      file,
      `${readFileSync(file, "utf8")}\nQuiet. Airi studies here.\n`,
    );
    expect(await writePlaceStub(dir, library, at + 1)).toBe(false);
    expect(readFileSync(file, "utf8")).toContain("Airi studies here.");
    expect(readFileSync(file, "utf8")).toContain("learned: been there");
    expect(await readPlaceCards(dir, vi.fn())).toEqual([
      { placeId: "library", aliases: [] },
    ]);
  });

  it("reads cards a character wrote, and skips broken ones", async () => {
    const dir = workspace();
    const cards = path.join(dir, "wiki/entities/places");
    mkdirSync(cards, { recursive: true });
    writeFileSync(
      path.join(cards, "shop.md"),
      "---\nplace_id: shop\naliases: [Natsu's secret]\n---\nSecret.\n",
    );
    writeFileSync(path.join(cards, "broken.md"), "---\naliases: 3\n---\n");
    const warn = vi.fn();
    expect(await readPlaceCards(dir, warn)).toEqual([
      { placeId: "shop", aliases: ["Natsu's secret"] },
    ]);
    expect(warn).toHaveBeenCalledOnce();
    expect(await readPlaceCards(workspace(), warn)).toEqual([]);
  });

  it("hears of places named in what the character reads", () => {
    expect(
      placesNamedIn(map, "Meet me at the main gate, then the sweets shop?"),
    ).toEqual(["shop", "gate"]);
    expect(placesNamedIn(map, "")).toEqual([]);
  });
});
