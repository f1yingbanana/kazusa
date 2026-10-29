import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCATION_CONFIG } from "./config.ts";
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
import { loadWorld } from "./register.ts";

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
    [[place("a", { parent: "missing" })], "a: unknown parent missing"],
    [
      [place("a", { parent: "b" }), place("b", { parent: "a" })],
      "parent cycle",
    ],
    [
      [
        place("a", {
          connections: [{ to: "zz", ways: [{ by: "walk", minutes: 1 }] }],
        }),
      ],
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
      "declared twice",
    ],
    [[place("a"), place("b")], "unreachable from a: b"],
    [[place("a"), place("a")], "duplicate place a"],
  ])("rejects a broken map (%#)", (places, problem) => {
    expect(() => buildMap(places)).toThrow(problem);
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

  const wikiDir = LOCATION_CONFIG.parse({}).wikiDir;
  it.skipIf(!existsSync(`${wikiDir}/entities/places`))(
    "loads the local World Wiki",
    () => {
      const world = loadWorld(wikiDir);
      expect(world?.map.places.size).toBeGreaterThan(0);
      for (const home of world?.homes.values() ?? []) {
        expect(world?.map.places.has(home)).toBe(true);
      }
    },
  );
});
