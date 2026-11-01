import { describe, expect, it } from "vitest";
import { ACTIVITY_GAP_MS, beginTurn, chooseActivity, turnOf } from "./turn.ts";

describe("a turn", () => {
  it("starts each run fresh", () => {
    beginTurn("c");
    turnOf("c").lookups = 2;
    beginTurn("c");
    expect(turnOf("c")).toMatchObject({ lookups: 0 });
  });
});

describe("choosing an activity", () => {
  const GAP = ACTIVITY_GAP_MS;

  it("allows one per gap, across turns", () => {
    const at = (time: number) => ({ wall: time, sim: time });
    expect(chooseActivity("gap", at(0), "a")).toBe(true);
    beginTurn("gap");
    expect(chooseActivity("gap", at(GAP - 1), "b")).toBe(false);
    expect(chooseActivity("gap", at(GAP), "c")).toBe(true);
  });

  it("lets either clock end the gap", () => {
    expect(chooseActivity("paused", { wall: 0, sim: 0 }, "a")).toBe(true);
    expect(chooseActivity("paused", { wall: GAP, sim: 0 }, "b")).toBe(true);
    expect(chooseActivity("fast", { wall: 0, sim: 0 }, "a")).toBe(true);
    expect(chooseActivity("fast", { wall: 1, sim: GAP }, "b")).toBe(true);
  });

  it("is not fooled by one call reaching the hook twice", () => {
    const now = { wall: 0, sim: 0 };
    expect(chooseActivity("twice", now, "a")).toBe(true);
    expect(chooseActivity("twice", now, "a")).toBe(true);
    expect(chooseActivity("twice", now, "b")).toBe(false);
  });
});
