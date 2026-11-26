import type { WikiPage, WikiReachResponse } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import {
  exclusiveReadersOf,
  isOwnSection,
  leadAfterSummary,
  readerWords,
  readersOf,
  reads,
} from "./layers";

function page(summary: string, lead: string): WikiPage {
  return {
    id: "airi",
    kind: "person",
    name: "Airi",
    aliases: [],
    summary,
    lead,
    sections: [],
    notes: [],
    history: [],
    openThreads: [],
  };
}

describe("leadAfterSummary", () => {
  it("strips the summary even when whitespace or newlines differ in lead", () => {
    expect(
      leadAfterSummary(
        page(
          "Airi loves mint chocolate.",
          "Airi   loves\nmint chocolate.\n\nShe is in the sweets club.",
        ),
      ),
    ).toBe("She is in the sweets club.");
  });

  it("does not strip a prefix that splits a word", () => {
    expect(
      leadAfterSummary(page("Airi", "Airis is another character entirely.")),
    ).toBe("Airis is another character entirely.");
  });
});

const person = (id: string) => ({ id, name: id });
const reach: WikiReachResponse = {
  well: [person("hina")],
  knows: [person("ako"), person("iori")],
  heard: [person("aru")],
  none: 4,
  members: [],
};

describe("who reads a layer", () => {
  it("reaches as deep as someone knows the page, and no deeper", () => {
    expect(reads("none", "summary")).toBe(false);
    expect(reads("heard of", "summary")).toBe(true);
    expect(reads("heard of", "opening")).toBe(false);
    expect(reads("familiar", "opening")).toBe(true);
    expect(reads("familiar", "close")).toBe(false);
    expect(reads("intimate", "close")).toBe(true);
  });

  it("keeps a page's inner voice for its subject alone", () => {
    expect(reads("intimate", "self")).toBe(false);
    expect(reads("intimate", "self", true)).toBe(true);
  });

  it("counts everyone who reaches a layer, the closer ones included", () => {
    expect(readersOf("summary", reach).map((p) => p.id)).toEqual([
      "hina",
      "ako",
      "iori",
      "aru",
    ]);
    expect(readersOf("opening", reach)).toHaveLength(3);
    expect(readersOf("close", reach)).toHaveLength(1);
    expect(readersOf("self", reach)).toHaveLength(0);
  });

  it("lists only readers whose deepest level is that layer", () => {
    expect(exclusiveReadersOf("summary", reach).map((p) => p.id)).toEqual([
      "aru",
    ]);
    expect(exclusiveReadersOf("opening", reach).map((p) => p.id)).toEqual([
      "ako",
      "iori",
    ]);
    expect(exclusiveReadersOf("close", reach).map((p) => p.id)).toEqual([
      "hina",
    ]);
    expect(exclusiveReadersOf("self", reach)).toEqual([]);
  });

  it("says the count concisely", () => {
    expect(readerWords("summary", 4, "Hina")).toBe("4 readers");
    expect(readerWords("summary", 1, "Gehenna")).toBe("1 reader");
    expect(readerWords("opening", 0, "Hina")).toBe("No readers");
    expect(readerWords("close", 3, "Hina")).toBe("3 readers");
    expect(readerWords("self", 0, "Hina")).toBe("Only Hina");
  });

  it("marks a section as their own only when the subject alone knows it", () => {
    const section = (knownBy: string[]) => ({ title: "t", text: "x", knownBy });
    expect(isOwnSection(section(["hina"]), "hina")).toBe(true);
    expect(isOwnSection(section([]), "hina")).toBe(false);
    expect(isOwnSection(section(["hina", "ako"]), "hina")).toBe(false);
    expect(isOwnSection(section(["hina"]), undefined)).toBe(false);
  });
});
