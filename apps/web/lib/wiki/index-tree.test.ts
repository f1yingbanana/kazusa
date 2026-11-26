import type { WikiListItem } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { areasOf, buildIndex, shelfOf } from "./index-tree";

const page = (id: string, extra: Partial<WikiListItem> = {}): WikiListItem => ({
  id,
  kind: "concept",
  name: id[0].toUpperCase() + id.slice(1),
  aliases: [],
  summary: "",
  ...extra,
});

const pages: WikiListItem[] = [
  page("kivotos", { place: true }),
  page("gehenna", { place: true, parent: "kivotos" }),
  page("cafeteria", { place: true, parent: "gehenna", summary: "lunch" }),
  page("prefects", { group: true }),
  page("hall", { place: true, group: true, parent: "gehenna" }),
  page("hina", { kind: "person", aliases: ["Chairwoman"] }),
  page("eden", {}),
  page("2026-11-01", { kind: "day" }),
  page("2026-11-03", { kind: "day" }),
];

describe("a wiki's index", () => {
  it("puts each page on one shelf, a place that is a group with the places", () => {
    expect(shelfOf(pages[4])).toBe("places");
    expect(shelfOf(pages[3])).toBe("groups");
    expect(shelfOf(pages[5])).toBe("people");
    expect(shelfOf(pages[6])).toBe("things");
    expect(shelfOf(pages[7])).toBe("days");
  });

  it("nests places inside their areas, and orders the shelves", () => {
    const { items, counts } = buildIndex(pages);
    expect(items.map((item) => item.value)).toEqual([
      "§places",
      "§people",
      "§groups",
      "§things",
      "§days",
    ]);
    expect(counts.places).toBe(4);
    const [kivotos] = items[0].children ?? [];
    expect(kivotos.value).toBe("kivotos");
    expect(kivotos.children?.[0].children?.map((child) => child.value)).toEqual(
      ["cafeteria", "hall"],
    );
  });

  it("lists diary days newest first", () => {
    const days = buildIndex(pages).items.find((item) => item.value === "§days");
    expect(days?.children?.map((child) => child.value)).toEqual([
      "2026-11-03",
      "2026-11-01",
    ]);
  });

  it("lays search matches out flat, by name, other names or summary", () => {
    const { items, counts } = buildIndex(pages, "lunch");
    expect(items).toHaveLength(1);
    expect(items[0].children).toEqual([
      { value: "cafeteria", label: "Cafeteria" },
    ]);
    expect(counts.places).toBe(1);
    expect(buildIndex(pages, "chairwoman").items[0].value).toBe("§people");
  });

  it("survives areas that loop back on themselves", () => {
    const loop = [
      page("a", { place: true, parent: "b" }),
      page("b", { place: true, parent: "a" }),
      page("c", { place: true, parent: "a" }),
    ];
    const { items, parents } = buildIndex(loop);
    const values = items[0].children?.map((child) => child.value);
    expect(values).toEqual(["a", "b"]);
    expect(
      items[0].children?.[0].children?.map((child) => child.value),
    ).toEqual(["c"]);
    expect(areasOf("c", parents)).toEqual(["b", "a"]);
  });
});
