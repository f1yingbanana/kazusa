import { describe, expect, it } from "vitest";
import type { BrainCall, BrainTurn, ChatMessage } from "@kazusa/client";
import { brainActivity } from "./activity";

const message = (sequence: number, createdAt?: number): ChatMessage => ({
  id: `m${sequence}`,
  requestId: `r${sequence}`,
  sequence,
  senderId: "arona",
  senderName: "ARONA",
  text: "hi",
  // Sim time stands still, so nothing can be ordered by this.
  timestamp: 5,
  ...(createdAt === undefined ? {} : { createdAt }),
});
const call = (at: number, ...names: string[]): BrainCall => ({
  id: `call-${at}`,
  at,
  steps: names.map((name) => ({
    type: "tool",
    id: `${name}-${at}`,
    name,
    input: "{}",
  })),
});
const turn = (...calls: BrainCall[]): BrainTurn => ({
  id: "run",
  prompts: [],
  calls,
});
const summary = (groups: ReturnType<typeof brainActivity>) =>
  groups.map((group) => [
    group.beforeSequence,
    group.calls.flatMap((call) =>
      call.steps.flatMap((step) => (step.type === "tool" ? [step.name] : [])),
    ),
  ]);

describe("brainActivity", () => {
  it("places calls before the next message, and last when none follows", () => {
    expect(
      summary(
        brainActivity(
          [turn(call(150, "read"), call(250, "write"))],
          [message(1, 100), message(2, 200)],
        ),
      ),
    ).toEqual([
      [2, ["read"]],
      [undefined, ["write"]],
    ]);
  });

  it("joins calls with no message between them", () => {
    expect(
      summary(
        brainActivity(
          [turn(call(150, "ls"), call(160, "read"))],
          [message(1, 100)],
        ),
      ),
    ).toEqual([[undefined, ["ls", "read"]]]);
  });

  it("reads turns newest first and keeps everything the brain shows", () => {
    expect(
      summary(
        brainActivity(
          [turn(call(300, "write")), turn(call(150, "read", "send_message"))],
          [message(1, 100), message(2, 200)],
        ),
      ),
    ).toEqual([
      [2, ["read", "send_message"]],
      [undefined, ["write"]],
    ]);
  });

  it("leaves out what can't be placed", () => {
    expect(
      summary(
        brainActivity(
          [turn(call(50, "ls"), call(150, "read"))],
          [message(1), message(2, 100)],
        ),
      ),
    ).toEqual([[undefined, ["read"]]]);
  });

  it("shows the latest run last when no message has a real time", () => {
    expect(
      summary(
        brainActivity(
          [turn(call(300, "write")), turn(call(150, "read"))],
          [message(1)],
        ),
      ),
    ).toEqual([[undefined, ["write"]]]);
    expect(brainActivity([], [message(1)])).toEqual([]);
  });
});
