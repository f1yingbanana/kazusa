import { describe, expect, it } from "vitest";
import type { CharacterSummary } from "@kazusa/client";
import { filterCharacters, groupCharacters } from "./grouping";

const people: CharacterSummary[] = [
  { id: "a", name: "Ada", kind: "agent", affiliation: "Archive", aliases: ["Adi"] },
  { id: "b", name: "Bram", kind: "agent", aliases: [] },
  { id: "n", name: "Nils", kind: "npc", affiliation: "Archive", aliases: [] },
];

describe("roster filtering and grouping", () => {
  it("filters by kind and searches name, id and aliases", () => {
    expect(filterCharacters(people, "characters", "").map((c) => c.id)).toEqual(["a", "b"]);
    expect(filterCharacters(people, "everyone", "adi").map((c) => c.id)).toEqual(["a"]);
    expect(filterCharacters(people, "npc", "").map((c) => c.id)).toEqual(["n"]);
  });
  it("splits characters by whether they are onstage", () => {
    const offstage = (id: string) => id === "b";
    expect(filterCharacters(people, "onstage", "", offstage).map((c) => c.id)).toEqual(["a"]);
    expect(filterCharacters(people, "offstage", "", offstage).map((c) => c.id)).toEqual(["b"]);
  });
  it("puts characters without the structured field in a trailing honest bucket", () => {
    const groups = groupCharacters(people, "affiliation", () => undefined);
    expect(groups.map((g) => g.label)).toEqual(["Archive", "No affiliation"]);
    expect(groups[0].members.map((c) => c.id)).toEqual(["a", "n"]);
  });
  it("groups by live status fields, never by task text", () => {
    const groups = groupCharacters(people.slice(0, 2), "brain", (id) =>
      id === "a" ? { brain: "thinking", composingIn: [], queued: 0, onstage: true } : undefined,
    );
    expect(groups.map((g) => g.label)).toEqual(["Thinking", "No status"]);
  });
});
