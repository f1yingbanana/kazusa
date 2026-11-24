import { describe, expect, it } from "vitest";
import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import {
  activityOf,
  groupByActivity,
  groupByLetter,
  groupByNearest,
  matchesQuery,
} from "./grouping";

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

const status = (patch: Partial<CharacterStatus> = {}): CharacterStatus => ({
  brain: "idle",
  composingIn: [],
  queued: 0,
  onstage: true,
  ...patch,
});

describe("activity", () => {
  it("gives each character the busiest thing they're doing", () => {
    expect(activityOf(undefined)).toBe("idle");
    expect(activityOf(status())).toBe("idle");
    expect(activityOf(status({ queued: 3 }))).toBe("waiting");
    expect(activityOf(status({ brain: "thinking", queued: 3 }))).toBe(
      "thinking",
    );
    expect(
      activityOf(status({ brain: "thinking", composingIn: ["chat"] })),
    ).toBe("composing");
    expect(activityOf(status({ playedBy: "user:me", queued: 1 }))).toBe(
      "played",
    );
    expect(
      activityOf(status({ onstage: false, brain: "thinking", queued: 2 })),
    ).toBe("offstage");
  });

  it("groups busiest first and leaves out empty activities", () => {
    const statuses: Record<string, CharacterStatus> = {
      a: status({ queued: 1 }),
      b: status({ brain: "thinking" }),
      c: status({ onstage: false }),
    };
    const groups = groupByActivity(people, (id) => statuses[id]);
    expect(groups.map((g) => g.label)).toEqual([
      "Thinking",
      "Waiting",
      "Offstage",
    ]);
    expect(groups[0].members.map((c) => c.name)).toEqual(["Bram"]);
  });
});
