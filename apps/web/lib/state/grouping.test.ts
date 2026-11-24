import { describe, expect, it } from "vitest";
import type { CharacterSummary } from "@kazusa/client";
import { groupByLetter, groupByNearest, matchesQuery } from "./grouping";

const people: CharacterSummary[] = [
  {
    id: "a",
    name: "Ada",
    kind: "agent",
    groups: ["sweets_club", "trinity"],
    aliases: ["Adi"],
  },
  { id: "b", name: "Bram", kind: "agent", aliases: [] },
  {
    id: "c",
    name: "Cleo",
    kind: "agent",
    groups: ["archive"],
    aliases: [],
  },
];

const names: Record<string, string> = {
  sweets_club: "After-School Sweets Club",
  archive: "Archive",
};

describe("roster search and grouping", () => {
  it("searches name, id and aliases", () => {
    expect(
      people.filter((c) => matchesQuery(c, "adi")).map((c) => c.id),
    ).toEqual(["a"]);
    expect(people.filter((c) => matchesQuery(c, " ")).length).toBe(3);
  });
  it("groups by the nearest group, named, with no group last", () => {
    const groups = groupByNearest(people, (id) => names[id] ?? id);
    expect(groups.map((g) => g.label)).toEqual([
      "After-School Sweets Club",
      "Archive",
      "No group",
    ]);
    expect(groups[2].members.map((c) => c.id)).toEqual(["b"]);
  });
  it("groups by first letter, accents folded, others last", () => {
    const named = (name: string): CharacterSummary => ({
      id: name,
      name,
      kind: "agent",
      aliases: [],
    });
    const groups = groupByLetter(
      ["Ōta", "Ada", "过热", "1st", "Olga"].map(named),
    );
    expect(groups.map((g) => g.label)).toEqual(["A", "O", "过", "#"]);
    expect(groups[1].members.map((c) => c.name)).toEqual(["Olga", "Ōta"]);
  });
});
