import { describe, expect, it } from "vitest";
import {
  requestContinuation,
  resetContinuations,
  takeContinuation,
} from "./continue.ts";

describe("continuations", () => {
  it("delivers a note once", () => {
    expect(requestContinuation("once", "next", 5)).toBe(true);
    expect(takeContinuation("once")).toBe("next");
    expect(takeContinuation("once")).toBeUndefined();
  });

  it("stops at the limit until a person speaks", () => {
    expect(requestContinuation("leash", "a", 1)).toBe(true);
    takeContinuation("leash");
    expect(requestContinuation("leash", "b", 1)).toBe(false);
    resetContinuations("leash");
    expect(requestContinuation("leash", "c", 1)).toBe(true);
  });

  it("counts a second request in one run once", () => {
    requestContinuation("twice", "a", 1);
    expect(requestContinuation("twice", "b", 1)).toBe(true);
    expect(takeContinuation("twice")).toBe("b");
  });
});
