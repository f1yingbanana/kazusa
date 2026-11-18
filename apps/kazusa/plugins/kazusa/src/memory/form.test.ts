import { describe, expect, it } from "vitest";
import { composePage, splitPage, withMembership } from "./form.ts";
import { parsePage } from "./page.ts";

const SPOT = {
  id: "yuuka-hayase",
  kind: "person",
  personal: false,
} as const;
const PLACE = { id: "rooftop", kind: "concept", personal: false } as const;

const YUUKA = `---
name: Yuuka Hayase
known: { everyone: heard of }
in: { Seminar: close, Millennium: knows }
home: room_yuuka
year: 2nd
halo: a visor-like ring
---

# Yuuka Hayase

The treasurer of Seminar.

## Profile

Keeps the budgets.

## Inner voice

Known by: yuuka-hayase

Secretly kind.

## Fears

Known by: yuuka-hayase

Being wasteful.
`;

describe("a page in the Wiki's form", () => {
  it("splits into the fields Kazusa reads and one field per level", () => {
    const form = splitPage(YUUKA, SPOT);
    expect(form.fields).toMatchObject({
      name: "Yuuka Hayase",
      groups: [{ ref: "everyone", level: "heard of" }],
      in: [
        { ref: "Seminar", level: "close" },
        { ref: "Millennium", level: "knows" },
      ],
      home: "room_yuuka",
    });
    expect(form.other).toEqual([
      { key: "year", value: "2nd" },
      { key: "halo", value: "a visor-like ring" },
    ]);
    expect(form.lead).toBe("The treasurer of Seminar.");
    expect(form.close).toBe("## Profile\n\nKeeps the budgets.");
    // The first part only she knows needs no title; the rest keep theirs.
    expect(form.only).toBe("Secretly kind.\n\n## Fears\n\nBeing wasteful.");
  });

  it("composes back to a page that reads the same", () => {
    const form = splitPage(YUUKA, SPOT);
    const text = composePage(YUUKA, form, false, SPOT);
    const before = parsePage(YUUKA, "characters/yuuka-hayase.md");
    const after = parsePage(text, "characters/yuuka-hayase.md");
    expect(after.in).toEqual(before.in);
    expect(after.known).toEqual(before.known);
    expect(after.everyone).toBe("heard of");
    expect(after.sections).toEqual(before.sections);
    expect(after.lead).toBe(before.lead);
    expect(text).toContain("halo: a visor-like ring");
  });

  it("moves fields Kazusa doesn't read into the text", () => {
    const form = splitPage(YUUKA, SPOT);
    const text = composePage(YUUKA, form, true, SPOT);
    expect(text).not.toContain("halo:");
    expect(text).toContain(
      "## Details\n\n- Year: 2nd\n- Halo: a visor-like ring",
    );
  });

  it("keeps what the map owns on a place", () => {
    const place = `---
place_id: rooftop
name: Rooftop
parent: campus
entry_minutes: 3
map: { x: 1, y: 2 }
---

# Rooftop

Windy.
`;
    const form = splitPage(place, PLACE);
    expect(form.kept).toEqual(["map"]);
    expect(form.fields.place).toBe(true);
    expect(form.fields.entryMinutes).toBe(3);
    const text = composePage(
      place,
      { ...form, fields: { ...form.fields, backdrop: "rooftop-sky" } },
      false,
      PLACE,
    );
    expect(text).toContain("backdrop: rooftop-sky");
    expect(text).toContain("place_id: rooftop");
    expect(text).toContain("entry_minutes: 3");
  });

  it("edits a place's routes, each with its ways, and drops what can't be used", () => {
    const place = "---\nplace_id: rooftop\nname: Rooftop\n---\n\n# Rooftop\n";
    const form = splitPage(place, PLACE);
    const text = composePage(
      place,
      {
        ...form,
        fields: {
          ...form.fields,
          entryMinutes: 2,
          connections: [
            {
              to: "station",
              ways: [
                { by: "walk", minutes: 20 },
                { by: "bike", minutes: 4 },
                { by: " ", minutes: 1 },
              ],
              note: "Downhill all the way.",
            },
            { to: "", ways: [{ by: "walk", minutes: 1 }] },
          ],
        },
      },
      false,
      PLACE,
    );
    expect(splitPage(text, PLACE).fields.connections).toEqual([
      {
        to: "station",
        ways: [
          { by: "walk", minutes: 20 },
          { by: "bike", minutes: 4 },
        ],
        note: "Downhill all the way.",
      },
    ]);
    expect(text).toContain("entry_minutes: 2");
  });

  it("reads the editor's level words as the levels they are", () => {
    const page =
      "---\nname: Yuuka\nin:\n  seminar: close member\n  millennium: associate\n  gym: member\n---\n\n# Yuuka\n\nTreasurer.\n";
    const form = splitPage(page, SPOT);
    expect(form.fields.in).toEqual([
      { ref: "seminar", level: "close" },
      { ref: "millennium", level: "heard of" },
      { ref: "gym", level: "knows" },
    ]);
    const after = parsePage(
      composePage(page, form, false, SPOT),
      "characters/yuuka-hayase.md",
    );
    expect(after.in).toEqual(parsePage(page, "characters/yuuka-hayase.md").in);
  });

  it("keeps a heading written apart from the name until the name changes", () => {
    const club = `---\nname: Sweets Club\n---\n\n# Sweets Club (スイーツ部)\n\nCake.\n`;
    const spot = {
      kind: "concept",
      personal: false,
      id: "sweets_club",
    } as const;
    const form = splitPage(club, spot);
    expect(composePage(club, form, false, spot)).toBe(club);
    const renamed = composePage(
      club,
      { ...form, fields: { ...form.fields, name: "Cake Club" } },
      false,
      spot,
    );
    expect(renamed).toContain("\n# Cake Club\n");
  });

  it("keeps the old name as another name when renamed", () => {
    const form = splitPage(YUUKA, SPOT);
    const text = composePage(
      YUUKA,
      { ...form, fields: { ...form.fields, name: "Yuuka" } },
      false,
      SPOT,
    );
    const page = parsePage(text, "characters/yuuka-hayase.md");
    expect(page.name).toBe("Yuuka");
    expect(page.aliases).toEqual(["Yuuka Hayase"]);
  });

  it("titles text written before any heading, and keeps a page's own voice its own", () => {
    const text = composePage(
      YUUKA,
      {
        fields: { aliases: [], groups: [] },
        lead: "Treasurer.",
        close: "Strict with money.\n\n## Rumours\n\nNever sleeps.",
        only: "Tired.",
      },
      false,
      SPOT,
    );
    const page = parsePage(text, "characters/yuuka-hayase.md");
    expect(page.sections).toEqual([
      { title: "About", text: "Strict with money.", knownBy: [] },
      { title: "Rumours", text: "Never sleeps.", knownBy: [] },
      { title: "Inner voice", text: "Tired.", knownBy: ["yuuka-hayase"] },
    ]);
    expect(text).not.toContain("groups:");
  });

  it("puts a character in a group, or takes them out, keeping the rest", () => {
    const page =
      "---\nname: Noa\nin:\n  Seminar: close\n  millennium: knows\n---\n\n# Noa\n\nKeeps the minutes.\n";
    const out = withMembership(
      page,
      "seminar",
      ["seminar", "Seminar"],
      undefined,
    );
    expect(out).toContain("in:\n  millennium: knows\n");
    expect(out).not.toContain("Seminar");
    expect(out.endsWith("# Noa\n\nKeeps the minutes.\n")).toBe(true);
    const back = withMembership(out, "seminar", ["seminar"], "knows");
    expect(back).toContain("in:\n  millennium: knows\n  seminar: knows\n");
  });
});
