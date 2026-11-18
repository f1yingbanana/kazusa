import { describe, expect, it } from "vitest";
import { toPictureName } from "./parts";

describe("a name typed in words", () => {
  it("becomes one the files and tools take", () => {
    expect(toPictureName("Close to tears!")).toBe("close-to-tears");
    expect(toPictureName("  Rooftop Garden ")).toBe("rooftop-garden");
    expect(toPictureName("¡¿")).toBe("");
  });
});

describe("a page's text opened in the form", () => {
  it("joins hand-wrapped lines, keeping list items and quotes", async () => {
    const { unwrap } = await import("./page-form");
    expect(
      unwrap(
        "A gifted\nmathematician.\n\n- Hair: long\n  navy blue\n- Eyes: blue\n> Receipt.",
      ),
    ).toBe(
      "A gifted mathematician.\n\n- Hair: long navy blue\n- Eyes: blue\n> Receipt.",
    );
  });
});
