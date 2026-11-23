import { describe, expect, it, vi } from "vitest";
import type { MessageDelivery } from "../messaging/messaging.ts";
import { createHandBack, type HandBackDeps } from "./hand-back.ts";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 20, 9);

function said(text: string, at: number, byPlayer = true): MessageDelivery {
  return {
    id: text,
    sequence: at,
    sender: "airi",
    senderName: "Airi",
    chatId: "direct:airi:natsu",
    audience: ["airi", "natsu"],
    params: { requestId: text, members: ["natsu"], text },
    timestamp: at,
    copies: [],
    ...(byPlayer ? { byPlayer: true as const } : {}),
  };
}

function setup(log: MessageDelivery[], now: number, moved = false) {
  const deps = {
    messageLog: vi.fn(async () => log),
    nameOf: async (id: string) => id[0].toUpperCase() + id.slice(1),
    time: () => now,
    movedSince: async () => moved,
    idleWake: vi.fn(async () => {}),
    lookBack: vi.fn(async () => {}),
    recordsReachMs: 12 * HOUR,
  } satisfies HandBackDeps;
  return { deps, handBack: createHandBack(deps) };
}

describe("handing a character back", () => {
  it("only checks in when nothing was said or done as them", async () => {
    const { deps, handBack } = setup([said("hi", T0 + 1, false)], T0 + HOUR);
    await handBack("airi", T0);
    expect(deps.idleWake).toHaveBeenCalledWith("airi");
    expect(deps.lookBack).not.toHaveBeenCalled();
  });

  it("looks back on a short play from their own records", async () => {
    const { deps, handBack } = setup([said("see you", T0 + 1)], T0 + HOUR);
    await handBack("airi", T0);
    expect(deps.lookBack).toHaveBeenCalledWith("airi", undefined);
  });

  it("shows a long play what was said as them, to whom", async () => {
    const { deps, handBack } = setup(
      [said("Friday at four", T0 + 1)],
      T0 + 13 * HOUR,
    );
    await handBack("airi", T0);
    expect(deps.lookBack).toHaveBeenCalledWith(
      "airi",
      expect.stringMatching(/to Natsu.*Friday at four/),
    );
  });

  it("looks back after moving them even if they said nothing", async () => {
    const { deps, handBack } = setup([], T0 + HOUR, true);
    await handBack("airi", T0);
    expect(deps.lookBack).toHaveBeenCalledWith("airi", undefined);
  });
});
