import { describe, expect, it } from "vitest";
import { splitPictureName } from "./pictures.ts";

describe("a picture's name", () => {
  const outfits = new Map([
    ["swim", "A swimsuit"],
    ["school-uniform", "The school's uniform"],
    ["school", "A school jersey"],
  ]);

  it("starts with the longest declared outfit it fits", () => {
    expect(splitPictureName("school-uniform-happy", outfits)).toEqual({
      prefix: "school-uniform",
      rest: "happy",
    });
    expect(splitPictureName("school-sad", outfits)).toEqual({
      prefix: "school",
      rest: "sad",
    });
    expect(splitPictureName("swim-close-to-tears", outfits)).toEqual({
      prefix: "swim",
      rest: "close-to-tears",
    });
  });

  it("is all mood without a declared outfit, or with nothing after one", () => {
    expect(splitPictureName("close-to-tears", outfits)).toEqual({
      rest: "close-to-tears",
    });
    expect(splitPictureName("swim", outfits)).toEqual({ rest: "swim" });
    expect(splitPictureName("swimming-happy", outfits)).toEqual({
      rest: "swimming-happy",
    });
  });
});
