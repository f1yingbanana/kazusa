import type { WikiPage } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { wikiPatch } from "./open";
import { leadAfterSummary } from "./page-body";

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

describe("wikiPatch", () => {
  it("clears stale editor params when opening a page", () => {
    expect(wikiPatch("airi")).toEqual({
      view: "wiki",
      "wiki.page": "airi",
      "wiki.agent": null,
      "wiki.part": null,
      "wiki.edit": null,
      "wiki.raw": null,
    });
  });

  it("includes kind and name resets when opening a new page draft", () => {
    expect(
      wikiPatch("riko", { edit: "world", kind: "person", name: "Riko" }),
    ).toEqual({
      view: "wiki",
      "wiki.page": "riko",
      "wiki.agent": null,
      "wiki.part": null,
      "wiki.edit": "world",
      "wiki.raw": null,
      "wiki.tab": null,
      "wiki.kind": "person",
      "wiki.name": "Riko",
    });
  });
});
