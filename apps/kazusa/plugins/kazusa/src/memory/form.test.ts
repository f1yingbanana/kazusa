import { describe, expect, it } from "vitest";
import { composePage, splitPage } from "./form.ts";
import { parsePage } from "./page.ts";

const YUUKA = `---
name: Yuuka Hayase
groups: { Seminar: close, Millennium: member }
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
`;

describe("a page in the Wiki's form", () => {
  it("splits into the fields Kazusa reads, the opening and sections", () => {
    const form = splitPage(YUUKA, "person", false);
    expect(form.fields).toMatchObject({
      name: "Yuuka Hayase",
      groups: [
        { ref: "Seminar", close: true },
        { ref: "Millennium", close: false },
      ],
      home: "room_yuuka",
    });
    expect(form.other).toEqual([
      { key: "year", value: "2nd" },
      { key: "halo", value: "a visor-like ring" },
    ]);
    expect(form.lead).toBe("The treasurer of Seminar.");
    expect(form.sections).toEqual([
      { title: "Profile", knownBy: [], text: "Keeps the budgets." },
      {
        title: "Inner voice",
        knownBy: ["yuuka-hayase"],
        text: "Secretly kind.",
      },
    ]);
  });

  it("composes back to a page that reads the same", () => {
    const form = splitPage(YUUKA, "person", false);
    const text = composePage(YUUKA, form, false, "person", false);
    const before = parsePage(YUUKA, "entities/characters/yuuka-hayase.md");
    const after = parsePage(text, "entities/characters/yuuka-hayase.md");
    expect(after.groups).toEqual(before.groups);
    expect(after.sections).toEqual(before.sections);
    expect(after.lead).toBe(before.lead);
    expect(text).toContain("halo: a visor-like ring");
  });

  it("moves fields Kazusa doesn't read into the text", () => {
    const form = splitPage(YUUKA, "person", false);
    const text = composePage(YUUKA, form, true, "person", false);
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
    const form = splitPage(place, "place", false);
    expect(form.kept).toEqual(["place_id", "entry_minutes", "map"]);
    const text = composePage(
      place,
      { ...form, fields: { ...form.fields, backdrop: "rooftop-sky" } },
      false,
      "place",
      false,
    );
    expect(text).toContain("backdrop: rooftop-sky");
    expect(text).toContain("place_id: rooftop");
    expect(text).toContain("entry_minutes: 3");
  });
});
