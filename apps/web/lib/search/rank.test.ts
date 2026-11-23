import { describe, expect, it } from "vitest";
import {
  groupRanked,
  normalize,
  plainLinks,
  rank,
  type SearchEntry,
} from "./rank";

const airi: SearchEntry = {
  key: "c:airi",
  kind: "character",
  name: "Airi Kurimura",
  aliases: ["airi-kurimura", "栗村 アイリ"],
  context: [
    "After-School Sweets Club",
    "Loves [[mint_chocolate|mint chocolate]]",
  ],
};
const airiRoom: SearchEntry = {
  key: "p:dorm_room_airi",
  kind: "place",
  name: "Airi's Dorm Room",
  context: ["Trinity Dorms"],
};
const airiChat: SearchEntry = {
  key: "o:1",
  kind: "observed",
  name: "Airi Kurimura & Kazusa Kyoyama",
};
const trinity: SearchEntry = {
  key: "g:trinity",
  kind: "group",
  name: "Trinity General School",
};
const trinityStation: SearchEntry = {
  key: "p:trinity_station",
  kind: "place",
  name: "Trinity Station",
};
const hifumi: SearchEntry = {
  key: "c:hifumi",
  kind: "character",
  name: "Hifumi Ajitani",
  context: ["Trinity General School"],
};
const models: SearchEntry = {
  key: "s:models",
  kind: "command",
  name: "Models",
  context: ["Chat, decision and memory search models"],
};

const keys = (query: string, entries: readonly SearchEntry[]) =>
  rank(query, entries).map(({ entry }) => entry.key);

describe("rank", () => {
  it("puts the character before their room and their chats", () => {
    expect(keys("airi", [airiChat, airiRoom, airi])).toEqual([
      "c:airi",
      "p:dorm_room_airi",
      "o:1",
    ]);
  });

  it("matches the start of any word, in any order", () => {
    expect(keys("kurimura", [airi, hifumi])).toEqual(["c:airi"]);
    expect(keys("kuri ai", [airi, hifumi])).toEqual(["c:airi"]);
  });

  it("lets a better match of a lesser kind win", () => {
    // An exact name beats a character who only mentions it.
    expect(keys("trinity general school", [hifumi, trinity])).toEqual([
      "g:trinity",
      "c:hifumi",
    ]);
  });

  it("puts a group before a place named after it, and both before mentions", () => {
    // "trinity" means the school more often than its station.
    expect(keys("trinity", [hifumi, trinityStation, trinity])).toEqual([
      "g:trinity",
      "p:trinity_station",
      "c:hifumi",
    ]);
  });

  it("lets a viewer with no chats of their own rank others' as chats", () => {
    const station = { ...trinityStation, name: "Airi Station" };
    expect(keys("airi", [station, airiChat])).toEqual([
      "p:trinity_station",
      "o:1",
    ]);
    expect(
      rank("airi", [station, airiChat], { observed: 8 }).map(
        ({ entry }) => entry.key,
      ),
    ).toEqual(["o:1", "p:trinity_station"]);
  });

  it("finds aliases, including other scripts", () => {
    expect(keys("アイリ", [airi, hifumi])).toEqual(["c:airi"]);
    expect(keys("airi-kurimura", [airi])).toEqual(["c:airi"]);
  });

  it("reads wiki links in context as their words", () => {
    expect(keys("mint choc", [airi, hifumi])).toEqual(["c:airi"]);
    const [hit] = rank("mint", [airi]);
    expect(hit?.named).toBe(false);
  });

  it("doesn't match scattered letters", () => {
    // The old fuzzy filter matched "air" inside "chat Kazusa Ajitani Ruri".
    expect(keys("air", [hifumi, models])).toEqual([]);
  });

  it("matches a setting by name before its description", () => {
    expect(keys("models", [models])).toEqual(["s:models"]);
    expect(rank("models", [models])[0]?.named).toBe(true);
  });

  it("nudges within a tier only", () => {
    const watched = { ...hifumi, key: "c:w", name: "Hina", boost: 1 };
    const plain = { ...hifumi, key: "c:p", name: "Hino" };
    expect(keys("hin", [plain, watched])).toEqual(["c:w", "c:p"]);
    // A boost never lifts a lesser match over a better one.
    expect(keys("hino", [plain, { ...watched, name: "Old Hino" }])).toEqual([
      "c:p",
      "c:w",
    ]);
  });

  it("returns nothing for an empty query", () => {
    expect(rank("  ", [airi])).toEqual([]);
  });
});

describe("normalize", () => {
  it("folds case, width, accents and separators", () => {
    expect(normalize("  Ｃafé_du-Monde ")).toBe("cafe du monde");
    expect(normalize("ガ")).toBe("ガ");
  });
});

describe("plainLinks", () => {
  it("keeps a link's words", () => {
    expect(plainLinks("At [[trinity_school]] with [[airi|Airi]]")).toBe(
      "At trinity school with Airi",
    );
  });
});

describe("groupRanked", () => {
  it("orders kinds by their best match and caps each", () => {
    const places = Array.from({ length: 10 }, (_, i) => ({
      key: `p:${i}`,
      kind: "place" as const,
      name: `Airi Spot ${i}`,
    }));
    const groups = groupRanked(rank("airi", [...places, airi, airiChat]));
    expect(groups.map(({ kind }) => kind)).toEqual([
      "character",
      "place",
      "observed",
    ]);
    expect(groups[1]?.results).toHaveLength(8);
    expect(groups[1]?.more).toBe(2);
  });
});
