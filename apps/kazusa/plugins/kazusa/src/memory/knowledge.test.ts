import { describe, expect, it } from "vitest";
import { WorldModel } from "./knowledge.ts";
import { lintWorld } from "./lint.ts";
import { parsePage } from "./page.ts";

const concept = (id: string, front: string, body = "Lead."): string[] => [
  `---\n${front}\n---\n# ${id}\n\n${body}\n`,
  `concepts/${id}.md`,
];
const group = (id: string, front: string, body = "Lead."): string[] =>
  concept(id, `group: true\n${front}`, body);
const place = (id: string, front: string): string[] =>
  concept(id, `place_id: ${id}\n${front}`);
const person = (id: string, front: string, body = "Lead."): string[] => [
  `---\n${front}\n---\n# ${id}\n\n${body}\n`,
  `characters/${id}.md`,
];
/** Deprecated layout: a world not yet upgraded. */
const olderPage =
  (folder: string) =>
  (id: string, front: string): string[] => [
    `---\n${front}\n---\n# ${id}\n\nLead.\n`,
    `${folder}/${id}.md`,
  ];

const world = new WorldModel(
  [
    concept("kivotos", "known: { everyone: knows }"),
    group(
      "trinity",
      "known: { everyone: heard of }\naliases: [Trinity General School]",
    ),
    group("gehenna", "known: { everyone: heard of }"),
    group("sweets", "known: { trinity: knows }\naliases: [Sweets Club]"),
    group("prefects", "known: { everyone: heard of, gehenna: knows }"),
    concept("rumour", "known: { gehenna: heard of }"),
    place("campus", "known: { trinity: knows }"),
    place("library", "parent: campus\nknown: { trinity: knows }"),
    place("gehenna_hall", "known: { gehenna: knows }"),
    place("west_annex", "parent: campus\nknown: { trinity: knows }"),
    place(
      "clubroom",
      "parent: west_annex\nknown: { sweets: close, trinity: knows }",
    ),
    place("kazusa_room", "parent: west_annex"),
    person(
      "kazusa",
      "in: { Sweets Club: close, Trinity General School: knows }\nhome: kazusa_room",
    ),
    person(
      "natsu",
      "in: { Sweets Club: close, Trinity General School: member }",
    ),
    person("hina", "in: { gehenna: knows }\nhome: campus"),
    person("makoto", "in: { gehenna: close }\nknown: { trinity: heard of }"),
  ].map(([raw, relative]) => parsePage(raw, relative)),
);

describe("WorldModel.depth", () => {
  it.each([
    ["own club's room", "kazusa", "clubroom", "intimate"],
    ["clubmate's card", "kazusa", "natsu", "intimate"],
    ["around their home", "kazusa", "west_annex", "intimate"],
    ["own school's places", "kazusa", "library", "familiar"],
    ["own school", "kazusa", "trinity", "familiar"],
    ["own club", "kazusa", "sweets", "intimate"],
    ["a rival's public body", "kazusa", "prefects", "heard of"],
    ["a page everyone knows", "kazusa", "kivotos", "familiar"],
    ["a rival's place", "natsu", "gehenna_hall", "none"],
    ["a page their group has heard of", "hina", "rumour", "heard of"],
    ["someone a group has heard of", "kazusa", "makoto", "heard of"],
    ["a group that has only heard of them", "makoto", "library", "none"],
    ["their own room", "kazusa", "kazusa_room", "intimate"],
    ["someone else's room", "natsu", "kazusa_room", "none"],
  ])("%s", (_label, who, what, expected) => {
    expect(world.depth(who, what).depth).toBe(expected);
  });

  it("living on a campus root is not knowing every room in it", () => {
    expect(world.depth("hina", "campus").depth).toBe("intimate");
    expect(world.depth("hina", "library").depth).toBe("none");
  });

  it("experience raises to familiar, even for a room nobody knows", () => {
    expect(world.depth("natsu", "kazusa_room", true)).toEqual({
      depth: "familiar",
      why: "they have their own page on it",
    });
  });

  it("explains itself in the author's terms", () => {
    expect(world.depth("kazusa", "library").why).toBe("in trinity");
    expect(world.depth("kazusa", "clubroom").why).toBe("in sweets");
    expect(world.depth("kazusa", "prefects").why).toBe("known to everyone");
  });

  it("gives through a group no more than they're involved in it", () => {
    const school = new WorldModel(
      [
        group("trinity", "known: { everyone: heard of }"),
        concept("vault", "known: { trinity: close }"),
        person("hifumi", "in: { trinity: close }"),
        person("koharu", "in: { trinity: knows }"),
        person("mob", "in: { trinity: heard of }"),
      ].map(([raw, relative]) => parsePage(raw, relative)),
    );
    expect(school.depth("hifumi", "vault").depth).toBe("intimate");
    expect(school.depth("koharu", "vault").depth).toBe("familiar");
    expect(school.depth("mob", "vault").depth).toBe("heard of");
    // Schoolmates who don't talk: each knows the other as far as the less
    // involved of them, and through what.
    expect(school.depth("mob", "hifumi")).toEqual({
      depth: "heard of",
      why: "in trinity",
      through: "trinity",
    });
    expect(school.depth("koharu", "hifumi").depth).toBe("familiar");
  });

  it("knows who is in a group", () => {
    expect(world.members("sweets")).toEqual(["kazusa", "natsu"]);
    expect(world.members("trinity")).toEqual(["kazusa", "natsu"]);
  });

  it("summarizes a footprint", () => {
    const footprint = world.footprint("natsu");
    expect(footprint.intimate).toContain("clubroom");
    expect(footprint.none).toContain("gehenna_hall");
    expect(footprint.none).not.toContain("natsu");
  });
});

describe("groups", () => {
  it("are the only field that places someone", () => {
    const world = new WorldModel(
      [group("trinity", "known: [x]"), person("a", "school: trinity")].map(
        ([raw, relative]) => parsePage(raw, relative),
      ),
    );
    expect(world.depth("a", "trinity").depth).toBe("none");
  });

  it("are concepts with the group component", () => {
    const page = parsePage(
      "---\ngroup: true\n---\n# Seminar\n",
      "concepts/seminar.md",
    );
    expect([page.kind, page.group]).toEqual(["concept", true]);
  });

  it("read a plain list as knowing it", () => {
    const page = parsePage(
      "---\nknown: [Seminar, everyone]\n---\n# X\n",
      "concepts/x.md",
    );
    expect(page.known).toEqual([{ ref: "Seminar", level: "knows" }]);
    expect(page.everyone).toBe("knows");
  });
});

describe("lintWorld", () => {
  it("finds unresolved references, others' secrets and pages nobody knows", () => {
    const messages = lintWorld(
      new WorldModel(
        [
          group("crew", "name: crew"),
          person("a", "in: [Nowhere]"),
          concept(
            "b",
            "known: { everyone: knows }",
            "Lead.\n\n## Plot\n\nKnown by: a\n\nShh.",
          ),
          concept("c", "known: { everyone: heard of }", "See [[missing]]."),
          concept("d", "known: [c]"),
          concept("e", "name: e"),
          concept("g", "known: { b: knows }"),
          person("f", "name: f", "Lead.\n\n## Voice\n\nKnown by: f\n\nMine."),
        ].map(([raw, relative]) => parsePage(raw, relative)),
      ),
    ).map((finding) => `${finding.page}: ${finding.message}`);
    expect(messages).toContain('world/a: `in` "Nowhere" resolves to no page');
    expect(messages.some((text) => text.startsWith('world/b: "Plot" is'))).toBe(
      true,
    );
    expect(messages.some((text) => text.startsWith("world/f:"))).toBe(false);
    expect(messages).toContain('world/c: link to unknown page "missing"');
    expect(
      messages.some((text) => text.startsWith("world/g: `known` names b")),
    ).toBe(true);
    expect(messages.filter((text) => text.includes("nobody knows it"))).toEqual(
      ["world/e: nobody knows it: no `known`"],
    );
  });
});

describe("a world not yet upgraded", () => {
  const older = new WorldModel(
    [
      olderPage("concepts")("kivotos", "renown: famous"),
      olderPage("concepts")("trinity", "groups: [kivotos]"),
      olderPage("concepts")("plot", "known_by: [kazusa]\nrenown: known"),
      olderPage("entities/places")("campus", "groups: [trinity]"),
      olderPage("entities/places")("library", "parent: campus"),
      olderPage("entities/characters")("kazusa", "groups: { trinity: member }"),
      olderPage("entities/characters")("natsu", "groups: { trinity: member }"),
    ].map(([raw, relative]) => parsePage(raw, relative)),
  );

  it("is read the way it was written, until it has a Groups folder", () => {
    expect(older.upgraded).toBe(false);
    expect(older.depth("kazusa", "kivotos").depth).toBe("familiar");
    expect(older.depth("kazusa", "library").depth).toBe("familiar");
    expect(older.depth("kazusa", "plot").depth).toBe("intimate");
    expect(older.depth("natsu", "plot").depth).toBe("none");
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

describe("rules a review found loose", () => {
  const of = (pages: string[][]) =>
    new WorldModel(pages.map(([text, file]) => parsePage(text, file)));

  it("never gives a neighbour someone's room, unless it is more than a name", () => {
    const w = of([
      group("tea", "known: { everyone: heard of }"),
      place("corridor", ""),
      place("room_a", "parent: corridor"),
      place("room_b", "parent: corridor\nknown: { tea: heard of }"),
      place("guardhouse", "parent: corridor\nknown: { tea: knows }"),
      person("amy", "home: room_a"),
      person("bea", "home: room_b"),
      person("cleo", "home: guardhouse"),
    ]);
    expect(w.depth("amy", "room_b").depth).toBe("none");
    expect(w.depth("amy", "guardhouse").depth).toBe("intimate");
    expect(w.depth("amy", "corridor").depth).toBe("intimate");
  });

  it("reads `in` only on a character, and `parent` only on a place", () => {
    const w = of([
      group("trinity", ""),
      concept("tea", "in: { trinity: close }"),
      place("dorm", ""),
      concept("leftover", "parent: dorm"),
      place("room_amy", "parent: dorm"),
      person("amy", "home: room_amy\nin: { trinity: close }"),
    ]);
    expect(w.depth("amy", "tea").depth).toBe("none");
    expect(w.depth("amy", "leftover").depth).toBe("none");
  });

  it("keeps the closer level of a group named twice", () => {
    const w = of([
      group("trinity", "aliases: [Trinity]"),
      person("amy", "in: { trinity: knows, Trinity: heard of }"),
    ]);
    expect(w.memberships(w.pages.get("amy")!).get("trinity")).toBe("knows");
  });

  it("is in two folders before it has any characters", () => {
    expect(
      of([concept("kivotos", "known: { everyone: knows }")]).upgraded,
    ).toBe(true);
    expect(of([olderPage("entities/places")("plaza", "")]).upgraded).toBe(
      false,
    );
  });
});
