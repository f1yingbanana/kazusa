import { describe, expect, it } from "vitest";
import { resolveSources, satisfies } from "./capabilities";

describe("per-domain source resolution", () => {
  it("uses live where the backend has it and nothing else", () => {
    const resolved = resolveSources({
      capabilities: { characters: "live", chats: "live" },
      reachable: true,
    });
    expect(resolved.chats).toBe("live");
    expect(resolved.characters).toBe("live");
    expect(resolved.timeline).toBe("unavailable");
    expect(resolved.relationships).toBe("unavailable");
  });
  it("has nothing live when the backend is unreachable", () => {
    const resolved = resolveSources({
      capabilities: { characters: "live", chats: "live" },
      reachable: false,
    });
    expect(resolved.characters).toBe("unavailable");
    expect(resolved.chats).toBe("unavailable");
  });
  it("answers registry requirement checks", () => {
    const resolved = resolveSources({
      capabilities: { characters: "live", chats: "live" },
      reachable: true,
    });
    expect(satisfies(resolved, ["chats", "characters"])).toBe(true);
    expect(satisfies(resolved, ["relationships"])).toBe(false);
  });
});
