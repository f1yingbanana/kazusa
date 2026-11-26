import type { WikiListItem } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import {
  duplicateSource,
  firstSentence,
  splitAliases,
  toPictureName,
  unwrap,
} from "@/lib/wiki/text";
import { linkMatches } from "./link-field";
import { wikiPatch } from "./open";

describe("wikiPatch", () => {
  it("clears stale editor params when opening a page", () => {
    expect(wikiPatch("airi")).toEqual({
      view: "wiki",
      "wiki.page": "airi",
      "wiki.agent": null,
      "wiki.part": null,
      "wiki.edit": null,
      "wiki.raw": null,
      "wiki.tab": null,
      "wiki.kind": null,
      "wiki.name": null,
    });
  });

  it("names a page not written yet, and opens a character's nights", () => {
    expect(
      wikiPatch("riko", { edit: "world", kind: "person", name: "Riko" }),
    ).toMatchObject({
      "wiki.edit": "world",
      "wiki.kind": "person",
      "wiki.name": "Riko",
    });
    expect(wikiPatch(null, { agent: "hina", tab: "nights" })).toMatchObject({
      "wiki.agent": "hina",
      "wiki.tab": "nights",
      "wiki.page": null,
    });
  });
});

describe("a page's text in the form", () => {
  it("joins lines a source wrapped, keeping lists, headings and code", () => {
    expect(unwrap("One\ntwo.\n\n- a\n- b\n## Topic\n```\nx\ny\n```")).toBe(
      "One two.\n\n- a\n- b\n## Topic\n```\nx\ny\n```",
    );
  });

  it("offers the opening's first sentence as a summary", () => {
    expect(firstSentence("She runs the team.  She is tired.")).toBe(
      "She runs the team.",
    );
    expect(firstSentence("平和です。よく寝る。")).toBe("平和です。よく寝る。");
  });

  it("reads other names from commas, Japanese ones too", () => {
    expect(splitAliases("Hina, the Chairwoman、委員長 ,")).toEqual([
      "Hina",
      "the Chairwoman",
      "委員長",
    ]);
  });

  it("makes a picture name the files and tools take", () => {
    expect(toPictureName("Close to tears!")).toBe("close-to-tears");
    expect(toPictureName("¡¿")).toBe("");
  });
});

describe("a link being typed", () => {
  const pages = [
    "Gehenna School",
    "Prefect Team",
    "Hina Sorasaki",
    "School Lunch Club",
  ].map((name): WikiListItem => ({
    id: name.toLowerCase().replace(/ /g, "_"),
    kind: "concept",
    name,
    aliases: [],
    summary: "",
  }));

  it("offers names that start with it first", () => {
    expect(linkMatches(pages, "sch").map((page) => page.name)).toEqual([
      "School Lunch Club",
      "Gehenna School",
    ]);
  });

  it("finds a page by its id too, and keeps to a few", () => {
    expect(linkMatches(pages, "prefect_t")[0].name).toBe("Prefect Team");
    expect(linkMatches(pages, "", 2)).toHaveLength(2);
  });
});

describe("a page duplicated", () => {
  const source = [
    "---",
    'name: "Gehenna Station"',
    "aliases:",
    "  - the station",
    "  - Gehenna stop",
    "parent: gehenna_district",
    "place_id: gehenna_station",
    "---",
    "",
    "# Gehenna Station",
    "",
    "A busy stop.",
    "",
  ].join("\n");

  it("takes its new name and id, and leaves the other names behind", () => {
    const copy = duplicateSource(source, {
      name: "Gehenna Station East",
      id: "gehenna_station_east",
    });
    expect(copy).toBe(
      [
        "---",
        'name: "Gehenna Station East"',
        "parent: gehenna_district",
        "place_id: gehenna_station_east",
        "---",
        "",
        "# Gehenna Station East",
        "",
        "A busy stop.",
        "",
      ].join("\n"),
    );
  });

  it("gives a page with no title or front matter both", () => {
    expect(duplicateSource("Just words.", { name: "Copy", id: "copy" })).toBe(
      '---\nname: "Copy"\n---\n\n# Copy\n\nJust words.',
    );
  });
});
