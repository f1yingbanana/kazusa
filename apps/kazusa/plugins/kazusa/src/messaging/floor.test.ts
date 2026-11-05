import { describe, expect, it } from "vitest";
import { Floors } from "./floor.ts";

const open = () => new AbortController().signal;
/** Let granted claims run their continuations. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Who has been granted the floor so far, in order. */
function granted(floors: Floors) {
  const order: string[] = [];
  const take = (
    planId: string,
    choice: "NEXT" | "WAIT",
    signal = open(),
    release?: AbortSignal,
  ) =>
    floors
      .take("huddle:club", { agentId: planId, planId, choice }, signal, release)
      .then(() => {
        order.push(planId);
      });
  return { order, take };
}

describe("one floor per huddle", () => {
  it("is free until someone speaks, then contested by everyone else", async () => {
    const floors = new Floors();
    expect(floors.contested("huddle:club", "alice", "alice")).toBeUndefined();
    await granted(floors).take("alice", "NEXT");
    expect(floors.contested("huddle:club", "alice", "alice")).toBeUndefined();
    expect(floors.contested("huddle:club", "bob", "b")).toEqual({
      speaking: ["alice"],
      turn: "alice",
      waiting: 0,
    });
  });

  it("goes to the eager at a pause, then the speaker, then the patient once the turn is over", async () => {
    const floors = new Floors();
    const { order, take } = granted(floors);
    await take("alice", "NEXT");
    const waiting = [
      take("carol", "WAIT"),
      take("alice", "NEXT"), // Alice's own next line: hers while it's her turn
      take("bob", "NEXT"),
    ];
    await settle();
    floors.done("huddle:club", "alice");
    await settle();
    // Bob wants in at the pause, ahead of Alice going on.
    expect(order).toEqual(["alice", "bob"]);
    const dave = take("dave", "NEXT");
    floors.done("huddle:club", "bob");
    await settle();
    // The turn is Bob's now; Alice, eager since before Dave, gets back in.
    expect(order).toEqual(["alice", "bob", "alice"]);
    floors.done("huddle:club", "alice");
    await dave;
    floors.done("huddle:club", "dave");
    await settle();
    // Carol waits while Dave's turn is open, however quiet it is.
    expect(order).toEqual(["alice", "bob", "alice", "dave"]);
    floors.endTurn("huddle:club", "dave");
    await Promise.all(waiting);
    expect(order).toEqual(["alice", "bob", "alice", "dave", "carol"]);
  });

  it("lets the speaker go on when nobody else wants in", async () => {
    const floors = new Floors();
    const { order, take } = granted(floors);
    await take("alice", "NEXT");
    const patient = take("carol", "WAIT");
    const next = take("alice", "NEXT");
    floors.done("huddle:club", "alice");
    await next;
    expect(order).toEqual(["alice", "alice"]);
    floors.done("huddle:club", "alice");
    floors.endTurn("huddle:club", "alice");
    await patient;
    expect(order).toEqual(["alice", "alice", "carol"]);
  });

  it("lets a cut-in speak over the speaker and take the turn", async () => {
    const floors = new Floors();
    const { order, take } = granted(floors);
    await take("alice", "NEXT");
    floors.cutIn("huddle:club", "bob", "bob");
    expect(floors.contested("huddle:club", "carol", "carol")).toEqual({
      speaking: ["alice", "bob"],
      turn: "bob",
      waiting: 0,
    });
    const carol = take("carol", "NEXT");
    floors.done("huddle:club", "alice");
    await settle();
    expect(order).toEqual(["alice"]);
    floors.done("huddle:club", "bob");
    await carol;
    expect(order).toEqual(["alice", "carol"]);
  });

  it("gives up a place in line when the speaker is stopped", async () => {
    const floors = new Floors();
    const { order, take } = granted(floors);
    await take("alice", "NEXT");
    const stop = new AbortController();
    const bob = take("bob", "NEXT", stop.signal);
    const carol = take("carol", "NEXT");
    stop.abort(new Error("Speech interrupted"));
    await expect(bob).rejects.toThrow("Speech interrupted");
    floors.done("huddle:club", "alice");
    await carol;
    expect(order).toEqual(["alice", "carol"]);
  });

  it("lets everyone go at once when the Gateway stops", async () => {
    const floors = new Floors();
    const { order, take } = granted(floors);
    await take("alice", "NEXT");
    const stopping = new AbortController();
    const bob = take("bob", "WAIT", open(), stopping.signal);
    await settle();
    expect(order).toEqual(["alice"]);
    stopping.abort();
    await bob;
    await take("carol", "WAIT", open(), stopping.signal);
    expect(order).toEqual(["alice", "bob", "carol"]);
  });

  it("forgets a huddle once nobody speaks, waits or holds the turn", async () => {
    const floors = new Floors();
    await granted(floors).take("alice", "NEXT");
    floors.done("huddle:club", "alice");
    expect(floors.contested("huddle:club", "bob", "bob")).toEqual({
      speaking: [],
      turn: "alice",
      waiting: 0,
    });
    floors.endTurn("huddle:club", "alice");
    expect(floors.contested("huddle:club", "bob", "bob")).toBeUndefined();
  });
});
