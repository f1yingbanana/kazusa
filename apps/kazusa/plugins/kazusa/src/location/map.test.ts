import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildMap,
  describeTravel,
  parsePlace,
  placeLabel,
  renderTravelTimes,
  resolvePlace,
  routeBetween,
  visibleFrom,
  type Place,
} from "./map.ts";
import { loadWorld } from "./world.ts";

/** A place with defaults; `id` doubles as a readable name. */
function place(id: string, extra: Partial<Omit<Place, "id">> = {}): Place {
  return {
    id,
    name: id,
    aliases: [],
    summary: `${id} summary.`,
    entryMinutes: 1,
    connections: [],
    bodyMarkdown: "",
    ...extra,
  };
}

/** School (gate, annex › club), dorm (private room), street (station), SCHALE. */
const PLACES: readonly Place[] = [
  place("school", {
    name: "School",
    connections: [
      {
        to: "dorm",
        ways: [
          { by: "walk", minutes: 10 },
          { by: "bike", minutes: 4 },
        ],
      },
    ],
  }),
  place("gate", {
    name: "Gate",
    parent: "school",
    entryMinutes: 2,
    connections: [
      {
        to: "street",
        ways: [
          { by: "walk", minutes: 6 },
          { by: "bike", minutes: 2 },
        ],
      },
    ],
  }),
  place("annex", { name: "Annex", parent: "school", entryMinutes: 2 }),
  place("club", { name: "Club Room", parent: "annex" }),
  place("dorm", { name: "Dorm" }),
  place("room_kazusa", { name: "Kazusa's Room", parent: "dorm" }),
  place("street", { name: "Street" }),
  place("shop", {
    name: "Secret Shop",
    aliases: ["the sweets shop"],
    parent: "street",
  }),
  place("station", {
    name: "Station",
    parent: "street",
    entryMinutes: 3,
    connections: [{ to: "schale", ways: [{ by: "monorail", minutes: 25 }] }],
  }),
  place("schale", { name: "SCHALE" }),
];

describe("world map", () => {
  it("parses place frontmatter with defaults", () => {
    const parsed = parsePlace(`---
place_id: sweets_club_room
name: Sweets Club Room
parent: west_annex
summary: "Smells of vanilla."
connections:
  - to: trinity_dorm
    ways:
      - { by: walk, minutes: 12 }
---

# Sweets Club Room

Body text.
`);
    expect(parsed).toMatchObject({
      id: "sweets_club_room",
      parent: "west_annex",
      entryMinutes: 1,
      connections: [
        { to: "trinity_dorm", ways: [{ by: "walk", minutes: 12 }] },
      ],
      bodyMarkdown: "# Sweets Club Room\n\nBody text.",
    });
    expect(() => parsePlace("---\nname: No id\n---\n")).toThrow();
  });

  it("orders the tree depth-first, areas by name", () => {
    const map = buildMap(PLACES);
    expect(map.order).toEqual([
      "dorm",
      "room_kazusa",
      "schale",
      "school",
      "annex",
      "club",
      "gate",
      "street",
      "shop",
      "station",
    ]);
  });

  it.each([
    [[place("a", { parent: "missing" })], ["a"], "unknown parent missing"],
    [
      [place("a", { parent: "b" }), place("b", { parent: "a" })],
      ["a", "b"],
      "parent cycle",
    ],
    [
      [
        place("a", {
          connections: [{ to: "zz", ways: [{ by: "walk", minutes: 1 }] }],
        }),
      ],
      ["a"],
      "connection to unknown zz",
    ],
    [
      [
        place("a", {
          connections: [{ to: "b", ways: [{ by: "walk", minutes: 1 }] }],
        }),
        place("b", {
          connections: [{ to: "a", ways: [{ by: "walk", minutes: 1 }] }],
        }),
      ],
      ["a", "b"],
      "declared on both pages",
    ],
    [[place("a"), place("b")], ["a", "b"], "the map is 2 separate parts"],
    [[place("a"), place("a")], ["a"], "two pages say"],
  ])(
    "loads a broken map and says what it worked around (%#)",
    (places, ids, problem) => {
      const map = buildMap(places);
      expect([...map.places.keys()].sort()).toEqual(ids);
      expect(map.order).toHaveLength(ids.length);
      expect(map.problems.map(({ message }) => message).join("\n")).toContain(
        problem,
      );
    },
  );

  it("keeps what it can of a broken place", () => {
    const map = buildMap([
      place("a", {
        parent: "gone",
        connections: [
          { to: "gone", ways: [{ by: "walk", minutes: 1 }] },
          { to: "b", ways: [{ by: "walk", minutes: 2 }] },
        ],
      }),
      place("b"),
    ]);
    expect(map.places.get("a")?.parent).toBeUndefined();
    expect(map.places.get("a")?.connections.map(({ to }) => to)).toEqual(["b"]);
    expect(routeBetween(map, "a", "b").minutes).toBe(2);
  });

  it("lists places it can't reach without travel times", () => {
    const map = buildMap([place("a"), place("b")]);
    expect(() => routeBetween(map, "a", "b")).toThrow("No route");
    expect(renderTravelTimes(map, "a", ["b"])).toBe("");
  });

  it("routes through the tree and its connections by the usual way", () => {
    const map = buildMap(PLACES);
    const route = routeBetween(map, "club", "dorm");
    expect(route.legs.map(({ placeId }) => placeId)).toEqual([
      "annex",
      "school",
      "dorm",
    ]);
    expect(route.minutes).toBe(13);
    expect(describeTravel(route)).toBe("13 min on foot, 7 by bike");
    // The bike saves too little of a monorail trip to mention.
    expect(describeTravel(routeBetween(map, "club", "schale"))).toBe(
      "39 min (by monorail)",
    );
    expect(describeTravel(routeBetween(map, "club", "annex"))).toBe("1 min");
    expect(routeBetween(map, "club", "club")).toMatchObject({
      legs: [],
      minutes: 0,
    });
  });

  it("labels a place with its areas", () => {
    expect(placeLabel(buildMap(PLACES), "club")).toBe(
      "Club Room `club` (Annex › School)",
    );
  });

  it("finds a place by id, name or alias, ignoring case", () => {
    const map = buildMap(PLACES);
    expect(resolvePlace(map, "club")?.id).toBe("club");
    expect(resolvePlace(map, "club room")?.id).toBe("club");
    expect(resolvePlace(map, "The Sweets Shop")?.id).toBe("shop");
    expect(resolvePlace(map, "the bench under the willow")).toBeUndefined();
    // A label copied whole from Where you are, as characters do live.
    expect(resolvePlace(map, "Club Room `club`")?.id).toBe("club");
    expect(resolvePlace(map, "the bench `nowhere`")).toBeUndefined();
  });

  it("sees the area, what is inside, neighbours and connections", () => {
    const map = buildMap(PLACES);
    expect(visibleFrom(map, "gate")).toEqual(["school", "annex", "street"]);
    expect(visibleFrom(map, "street")).toEqual(["shop", "station", "gate"]);
  });

  it("lists travel times nearest first, up to a limit", () => {
    const map = buildMap(PLACES);
    expect(renderTravelTimes(map, "club", ["dorm", "street", "annex"], 2)).toBe(
      "Annex `annex` 1 min · Street `street` 11 min on foot, 7 by bike",
    );
  });

  // Worlds live in their own repositories (`apps/kazusa/world-sources.json`): only those
  // downloaded here can be checked.
  const worlds = fileURLToPath(new URL("../../../../worlds/", import.meta.url));
  const downloaded = existsSync(worlds)
    ? readdirSync(worlds).filter((id) =>
        existsSync(path.join(worlds, id, "shared/wiki")),
      )
    : [];
  it
    .skipIf(downloaded.length === 0)
    .each(downloaded.length ? downloaded : ["(none downloaded)"])(
    "loads the %s world's wiki",
    (id) => {
      const wikiDir = path.join(worlds, id, "shared/wiki");
      const world = loadWorld(wikiDir);
      expect(world?.map.places.size).toBeGreaterThan(0);
      for (const home of world?.homes.values() ?? []) {
        expect(world?.map.places.has(home)).toBe(true);
      }
    },
  );
});
