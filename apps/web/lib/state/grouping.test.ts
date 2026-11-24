import { describe, expect, it } from "vitest";
import type { CharacterStatus, CharacterSummary } from "@kazusa/client";
import {
  groupByActivity,
  groupByStatus,
  statusOf,
  groupByLetter,
  groupByNearest,
  matchesQuery,
} from "./grouping";
import { nameInitial } from "./name-index";

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
    // With a reading for Chinese, it heads under its letter.
    expect(
      groupByLetter([named("过热")], (character) =>
        character === "过" ? "g" : undefined,
      ).map((g) => g.label),
    ).toEqual(["G"]);
  });

  it("heads every script the way a contact list does", () => {
    expect(nameInitial("Łucja")).toBe("L");
    expect(nameInitial("한나")).toBe("ㅎ");
    expect(nameInitial("까치")).toBe("ㄱ");
    expect(nameInitial("カズサ")).toBe("か");
    expect(nameInitial("がっこう")).toBe("か");
    expect(nameInitial("ゆうか")).toBe("や");
    expect(nameInitial("Юлия")).toBe("Ю");
    expect(nameInitial("  ")).toBe("#");
  });
});

const status = (patch: Partial<CharacterStatus> = {}): CharacterStatus => ({
  brain: "idle",
  composingIn: [],
  queued: 0,
  onstage: true,
  ...patch,
});

describe("status and activity", () => {
  it("gives each character the busiest status", () => {
    expect(statusOf(undefined)).toBe("idle");
    expect(statusOf(status())).toBe("idle");
    expect(statusOf(status({ queued: 3 }))).toBe("waiting");
    expect(statusOf(status({ brain: "thinking", queued: 3 }))).toBe("thinking");
    expect(statusOf(status({ brain: "thinking", composingIn: ["chat"] }))).toBe(
      "composing",
    );
    expect(
      statusOf(status({ onstage: false, brain: "thinking", queued: 2 })),
    ).toBe("offstage");
  });

  it("groups by status, busiest first, without empty ones", () => {
    const statuses: Record<string, CharacterStatus> = {
      a: status({ queued: 1 }),
      b: status({ brain: "thinking" }),
      c: status({ onstage: false }),
    };
    const groups = groupByStatus(people, (id) => statuses[id]);
    expect(groups.map((g) => g.label)).toEqual([
      "Thinking",
      "Waiting",
      "Offstage",
    ]);
    expect(groups[0].members.map((c) => c.name)).toEqual(["Bram"]);
  });

  it("groups by task in the world's order, then no task, then offstage", () => {
    const task = (type: string) => ({
      id: type,
      type,
      description: type,
      startedAt: 0,
      endAt: 1,
    });
    const statuses: Record<string, CharacterStatus> = {
      a: status({ task: task("eating") }),
      b: status({ task: task("sleeping") }),
      c: status({ onstage: false, task: task("eating") }),
      d: status({ task: task("knitting") }),
      e: status(),
    };
    const more = [
      ...people,
      { id: "d", name: "Dov", kind: "agent", aliases: [] },
      { id: "e", name: "Eve", kind: "agent", aliases: [] },
    ] satisfies CharacterSummary[];
    const groups = groupByActivity(
      more,
      (id) => statuses[id],
      ["sleeping", "eating"],
      (type) => type.toUpperCase(),
    );
    expect(groups.map((g) => g.label)).toEqual([
      "SLEEPING",
      "EATING",
      "KNITTING",
      "Nothing in particular",
      "Offstage",
    ]);
  });
});
