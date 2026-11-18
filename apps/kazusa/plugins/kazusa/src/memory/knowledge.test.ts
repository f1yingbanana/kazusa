import { describe, expect, it } from "vitest";
import { WorldModel } from "./knowledge.ts";
import { lintWorld } from "./lint.ts";
import { parsePage } from "./page.ts";

const concept = (id: string, front: string, body = "Lead."): string[] => [
  `---\n${front}\n---\n# ${id}\n\n${body}\n`,
  `concepts/${id}.md`,
];
const place = (id: string, front: string): string[] => [
  `---\n${front}\n---\n# ${id}\n\nLead.\n`,
  `entities/places/${id}.md`,
];
const person = (id: string, front: string): string[] => [
  `---\n${front}\n---\n# ${id}\n\nLead.\n`,
  `entities/characters/${id}.md`,
];

const world = new WorldModel(
  [
    concept("kivotos", "renown: famous"),
    concept("trinity", "groups: [kivotos]\naliases: [Trinity General School]"),
    concept("gehenna", "groups: [kivotos]"),
    concept("sweets", "groups: [trinity]\naliases: [Sweets Club]"),
    concept("prefects", "groups: [gehenna]\nrenown: known"),
    concept("secret", "known_by: [kazusa]\nrenown: known"),
    place("campus", "groups: [trinity]"),
    place("library", "parent: campus"),
    place("gehenna_hall", "groups: [gehenna]"),
    place("west_annex", "parent: campus"),
    place("clubroom", "parent: west_annex\ngroups: [sweets]"),
    place("kazusa_room", "parent: west_annex\nrenown: private"),
    person(
      "kazusa",
      "groups: { Sweets Club: close, Trinity General School: member }\nhome: kazusa_room",
    ),
    person(
      "natsu",
      "groups: { Sweets Club: close, Trinity General School: member }",
    ),
    person("hina", "groups: [gehenna]\nhome: campus"),
  ].map(([raw, relative]) => parsePage(raw, relative)),
);

describe("WorldModel.depth", () => {
  it.each([
    ["own club's room", "kazusa", "clubroom", "intimate"],
    ["clubmate's card", "kazusa", "natsu", "intimate"],
    ["around their home", "kazusa", "west_annex", "intimate"],
    ["own school's places", "kazusa", "library", "familiar"],
    ["own school", "kazusa", "trinity", "familiar"],
    ["a rival's public body", "kazusa", "prefects", "heard of"],
    ["a famous page", "kazusa", "kivotos", "familiar"],
    ["a rival's local place", "natsu", "gehenna_hall", "none"],
    ["their own private room", "kazusa", "kazusa_room", "intimate"],
    ["someone else's private room", "natsu", "kazusa_room", "none"],
    ["`known_by` names them", "kazusa", "secret", "intimate"],
    ["`known_by` excludes them", "natsu", "secret", "none"],
  ])("%s", (_label, who, what, expected) => {
    expect(world.depth(who, what).depth).toBe(expected);
  });

  it("living on a campus root is not knowing every room in it", () => {
    expect(world.depth("hina", "campus").depth).toBe("intimate");
    expect(world.depth("hina", "library").depth).toBe("none");
  });

  it("experience raises to familiar, even for private pages", () => {
    expect(world.depth("natsu", "kazusa_room", true)).toEqual({
      depth: "familiar",
      why: "they have their own page on it",
    });
    expect(world.depth("natsu", "secret", true).depth).toBe("familiar");
  });

  it("explains itself in the author's terms", () => {
    expect(world.depth("kazusa", "library").why).toBe(
      "in Trinity General School",
    );
    expect(world.depth("kazusa", "clubroom").why).toBe("close in Sweets Club");
    expect(world.depth("kazusa", "prefects").why).toBe("renown known");
  });

  it("summarizes a footprint", () => {
    const footprint = world.footprint("natsu");
    expect(footprint.intimate).toContain("clubroom");
    expect(footprint.none).toContain("gehenna_hall");
    expect(footprint.none).not.toContain("natsu");
  });
});

describe("groups", () => {
  const guilds = new WorldModel(
    [
      concept("saltmere", "renown: famous"),
      concept("eastquay", "groups: [saltmere]"),
      concept("lamplighters", "groups: [eastquay]"),
      concept("watch", "groups: [eastquay]"),
      place("lamp_hall", "groups: [lamplighters]"),
      person("mara", "groups: { Lamplighters: close, eastquay: member }"),
    ].map(([raw, relative]) => parsePage(raw, relative)),
  );

  it("make a person know a close group well, and the others", () => {
    expect(guilds.depth("mara", "lamp_hall")).toEqual({
      depth: "intimate",
      why: "close in Lamplighters",
    });
    expect(guilds.depth("mara", "watch")).toEqual({
      depth: "familiar",
      why: "in eastquay",
    });
  });

  it("are the only field that places someone", () => {
    const world = new WorldModel(
      [concept("trinity", "groups: [x]"), person("a", "school: trinity")].map(
        ([raw, relative]) => parsePage(raw, relative),
      ),
    );
    expect(world.depth("a", "trinity").why).not.toMatch(/school/);
  });
});

describe("lintWorld", () => {
  it("finds unresolved references, unknown characters and unset concepts", () => {
    const messages = lintWorld(
      new WorldModel(
        [
          person("a", "groups: [Nowhere]"),
          concept("b", "known_by: [ghost]"),
          concept("c", "renown: known", "See [[missing]]."),
          concept("d", "groups: [c]"),
          concept("e", "name: e\nrenown: known"),
        ].map(([raw, relative]) => parsePage(raw, relative)),
      ),
    ).map((finding) => `${finding.page}: ${finding.message}`);
    expect(messages).toContain(
      'world/a: `groups` "Nowhere" resolves to no page',
    );
    expect(messages).toContain(
      'world/b: `known_by` names unknown character "ghost"',
    );
    expect(messages).toContain('world/c: link to unknown page "missing"');
    expect(messages.filter((text) => text.includes("no `groups`"))).toEqual([]);
  });
});

describe("duplicate page ids", () => {
  it("are an error, because one page hides the other", () => {
    const concept = parsePage(
      "---\nsummary: A group.\n---\n\n# Manor\n\nLead.",
      "concepts/manor.md",
    );
    const place = parsePage(
      "---\nplace_id: manor\nname: Manor\nsummary: A house.\n---\n\n# Manor\n\nLead.",
      "entities/places/manor.md",
    );
    const messages = lintWorld(new WorldModel([concept, place])).map(
      (finding) => finding.message,
    );
    expect(
      messages.some((message) => message.startsWith("two pages share this id")),
    ).toBe(true);
  });
});
