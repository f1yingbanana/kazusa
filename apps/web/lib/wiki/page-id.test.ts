import { describe, expect, it } from "vitest";
import { WikiIdSchema } from "@kazusa/client";
import { idProblem, pageId } from "./page-id";

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

describe("idProblem", () => {
  it("asks for an id, a free one, in the id alphabet", () => {
    expect(idProblem("", none)).toBe("Enter an id.");
    expect(idProblem("airi", new Set(["airi"]))).toMatch(/already uses/);
    expect(idProblem("Airi", none)).toMatch(/lowercase/);
    expect(idProblem("airi-kurimura", none)).toBeUndefined();
  });

  it("keeps a character's id short enough for an agent", () => {
    const long = "a".repeat(65);
    expect(idProblem(long, none)).toBeUndefined();
    expect(idProblem(long, none, { character: true })).toMatch(/64/);
  });
});
