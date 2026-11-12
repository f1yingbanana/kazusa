import { describe, expect, it } from "vitest";
import { canDrawScene, chatRendering, type RenderingInput } from "./rendering";

const huddle: RenderingInput = {
  type: "huddle",
  explicit: null,
  preferred: "scene",
};

describe("chatRendering", () => {
  it.each<[string, Partial<RenderingInput>, "scene" | "list"]>([
    // Art doesn't decide: a huddle without any is a scene too.
    ["any huddle, by default", {}, "scene"],
    [
      "a huddle when the viewer prefers the transcript",
      { preferred: "list" },
      "list",
    ],
    [
      "the link over the preference",
      { preferred: "list", explicit: "scene" },
      "scene",
    ],
    ["the transcript from the link", { explicit: "list" }, "list"],
    ["a draft huddle", { draft: true, explicit: "scene" }, "list"],
    ["a direct chat", { type: "direct", explicit: "scene" }, "list"],
    ["a group", { type: "group" }, "list"],
  ])("%s", (_, change, expected) => {
    expect(chatRendering({ ...huddle, ...change })).toBe(expected);
  });

  it("offers the scene only for a sent huddle", () => {
    expect(canDrawScene({ type: "huddle" })).toBe(true);
    expect(canDrawScene({ type: "huddle", draft: true })).toBe(false);
    expect(canDrawScene({ type: "group" })).toBe(false);
  });
});
