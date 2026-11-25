import type { StatEntry, WikiListItem } from "@kazusa/client";
import { describe, expect, it } from "vitest";
import { acquaintances, placeInCast, privateTo } from "./cast-book";

function page(
  id: string,
  kind: WikiListItem["kind"] = "person",
  summary = "",
): WikiListItem {
  return {
    id,
    kind,
    name: id[0].toUpperCase() + id.slice(1),
    aliases: [],
    summary,
  };
}

const warm: StatEntry = { value: 20, at: 0, by: "user" };

describe("placeInCast", () => {
  it("wraps round at either end", () => {
    expect(placeInCast(["a", "b", "c"], "a")).toEqual({
      index: 0,
      total: 3,
      prev: "c",
      next: "b",
    });
    expect(placeInCast(["a", "b", "c"], "c")).toMatchObject({ next: "a" });
  });

  it("has nowhere to turn with one character", () => {
    expect(placeInCast(["a"], "a")).toEqual({
      index: 0,
      total: 1,
      prev: undefined,
      next: undefined,
    });
  });

  it("is undefined for someone the order leaves out", () => {
    expect(placeInCast(["a", "b"], "z")).toBeUndefined();
  });
});

describe("acquaintances", () => {
  const pages = [
    page("zoe", "person", " Always late. "),
    page("rei"),
    page("mika"),
    page("self"),
    page("school", "concept"),
    page("admin"),
  ];

  it("keeps only other people, those with a state toward them first", () => {
    const list = acquaintances({
      self: "self",
      pages,
      simulated: new Set(["rei", "zoe"]),
      toward: { zoe: { regard: warm } },
      exclude: ["admin"],
    });
    expect(list.map(({ id }) => id)).toEqual(["zoe", "rei", "mika"]);
    expect(list[0]).toMatchObject({
      take: "Always late.",
      simulated: true,
      toward: { regard: warm },
    });
    expect(list[2]).toMatchObject({ simulated: false, toward: {} });
  });
});

describe("privateTo", () => {
  it("is true only when the character alone knows it", () => {
    expect(privateTo(["self"], "self")).toBe(true);
    expect(privateTo([], "self")).toBe(false);
    expect(privateTo(["self", "rei"], "self")).toBe(false);
  });
});
