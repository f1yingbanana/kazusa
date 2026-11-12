import { describe, expect, it } from "vitest";
import {
  READING_OFF,
  stepReadingClock,
  type ReadingClock,
  type ReadingClockEvent,
} from "./reading";

/** Every speed set, from reading mode off, and whether it was taken back. */
function play(events: readonly ReadingClockEvent[]) {
  let state: ReadingClock = READING_OFF;
  const calls: number[] = [];
  let takenBack = false;
  for (const event of events) {
    const step = stepReadingClock(state, event);
    state = step.state;
    if (step.set !== undefined) calls.push(step.set);
    if (step.takenBack) takenBack = true;
  }
  return { calls, takenBack, state };
}
const enter = (speed: number | undefined, waiting = 0): ReadingClockEvent => ({
  type: "enter",
  speed,
  waiting,
});
const waiting = (count: number): ReadingClockEvent => ({
  type: "waiting",
  waiting: count,
});
const leave: ReadingClockEvent = { type: "leave" };

describe("reading mode's clock", () => {
  it.each<[string, ReadingClockEvent[], number[]]>([
    ["on with nothing waiting: the world runs as it was", [enter(10)], []],
    ["on, the world paused: it starts at 1x", [enter(0)], [1]],
    ["on with a line waiting: pause", [enter(10, 1)], [0]],
    [
      "a line arrives: pause; read: run again",
      [enter(10), waiting(1), waiting(0)],
      [0, 10],
    ],
    [
      "started at 0: runs at 1 between lines",
      [enter(0), waiting(1), waiting(0)],
      [1, 0, 1],
    ],
    [
      "a burst: one pause, one resume after the last",
      [
        enter(10),
        waiting(1),
        waiting(2),
        waiting(3),
        waiting(2),
        waiting(1),
        waiting(0),
      ],
      [0, 10],
    ],
    [
      "a send while lines wait: shown, sent, then the world runs",
      [
        enter(10),
        waiting(2),
        { type: "send" },
        waiting(0),
        { type: "sent", waiting: 0 },
      ],
      [0, 10],
    ],
    [
      "a line arriving during a send waits for the send",
      [enter(10), { type: "send" }, waiting(1), { type: "sent", waiting: 1 }],
      [0],
    ],
    [
      "off while paused: the speed found",
      [enter(10), waiting(1), leave],
      [0, 10],
    ],
    [
      "off while running as found: nothing to set",
      [enter(10), waiting(1), waiting(0), leave],
      [0, 10],
    ],
    ["off, found paused: paused again", [enter(0), leave], [1, 0]],
    [
      "off, found paused, while paused: nothing to set",
      [enter(0), waiting(1), leave],
      [1, 0],
    ],
    ["off twice: once", [enter(10), waiting(1), leave, leave], [0, 10]],
    [
      "its own speeds are its own",
      [enter(10), waiting(1), { type: "speed", speed: 0 }],
      [0],
    ],
  ])("%s", (_, events, calls) => {
    const result = play(events);
    expect(result.calls).toEqual(calls);
    expect(result.takenBack).toBe(false);
  });

  it("lets go when someone else sets the speed, setting nothing back", () => {
    const result = play([
      enter(10),
      waiting(1),
      { type: "speed", speed: 60 },
      leave,
    ]);
    expect(result.takenBack).toBe(true);
    expect(result.calls).toEqual([0]);
    expect(result.state).toBe(READING_OFF);
  });

  it("never leaves the world other than it found it", () => {
    for (const found of [0, 1, 10])
      for (const path of [
        [],
        [waiting(1)],
        [waiting(1), waiting(0)],
        [{ type: "send" } as const],
      ]) {
        const { calls } = play([enter(found), ...path, leave]);
        expect(calls.length ? calls.at(-1) : found).toBe(found);
      }
  });

  it("does nothing while off", () => {
    for (const event of [
      leave,
      waiting(1),
      { type: "speed", speed: 3 },
    ] as const)
      expect(stepReadingClock(READING_OFF, event)).toEqual({
        state: READING_OFF,
      });
  });
});
