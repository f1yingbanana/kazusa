import { describe, expect, it } from "vitest";
import { beginTurn, turnOf } from "./turn.ts";

describe("a turn", () => {
  it("starts each run fresh", () => {
    beginTurn("c");
    turnOf("c").activity = true;
    turnOf("c").lookups = 2;
    beginTurn("c");
    expect(turnOf("c")).toMatchObject({
      activity: false,
      lookups: 0,
    });
  });
});
