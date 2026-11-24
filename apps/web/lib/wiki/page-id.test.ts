import { describe, expect, it } from "vitest";
import { WikiIdSchema } from "@kazusa/client";
import { pageId } from "./page-id";

const none = new Set<string>();

describe("pageId", () => {
  it("spells Latin names as they read", () => {
    expect(pageId("Airi Kurimura", none, { separator: "-" })).toBe(
      "airi-kurimura",
    );
    expect(pageId("Ōta Hina's Café", none)).toBe("ota_hina_s_cafe");
  });
  it("gives names without Latin letters a stable hashed id", () => {
    const id = pageId("过热", none, { separator: "-", fallback: "character" });
    expect(id).toMatch(/^character-[0-9a-z]{6}$/);
    expect(
      pageId("过热", none, { separator: "-", fallback: "character" }),
    ).toBe(id);
    expect(
      pageId("過熱", none, { separator: "-", fallback: "character" }),
    ).not.toBe(id);
  });
  it("keeps the Latin part of a mixed name and marks what was dropped", () => {
    expect(pageId("过热the", none)).toMatch(/^the_[0-9a-z]{6}$/);
  });
  it("never repeats an id already taken", () => {
    expect(pageId("Archive", new Set(["archive", "archive_2"]))).toBe(
      "archive_3",
    );
  });
  it("always makes a valid id", () => {
    for (const name of ["过热the", "  ", "---", "Ü", "x".repeat(200), "🍰"])
      expect(WikiIdSchema.safeParse(pageId(name, none)).success).toBe(true);
  });
});
