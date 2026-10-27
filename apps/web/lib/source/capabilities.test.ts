import { describe, expect, it } from "vitest";
import {
  LEGACY_CAPABILITIES,
  isMocked,
  resolveSources,
  satisfies,
} from "./capabilities";

describe("per-domain source resolution", () => {
  it("uses live where the backend has it and mocks the rest in auto mode", () => {
    const resolved = resolveSources({
      capabilities: LEGACY_CAPABILITIES,
      reachable: true,
      mocks: "auto",
    });
    expect(resolved.chats).toBe("live");
    expect(resolved.characters).toBe("live");
    expect(resolved.status).toBe("mock");
    expect(resolved.timeline).toBe("mock");
    expect(resolved.observe).toBe("unavailable");
  });
  it("falls back to mocks for mockable domains when the backend is unreachable", () => {
    const resolved = resolveSources({
      capabilities: LEGACY_CAPABILITIES,
      reachable: false,
      mocks: "auto",
    });
    expect(resolved.characters).toBe("mock");
    expect(resolved.chats).toBe("unavailable");
  });
  it("never mocks when mocks are off and forces mocks when set to all", () => {
    const off = resolveSources({
      capabilities: LEGACY_CAPABILITIES,
      reachable: true,
      mocks: "off",
    });
    expect(off.timeline).toBe("unavailable");
    const all = resolveSources({
      capabilities: LEGACY_CAPABILITIES,
      reachable: true,
      mocks: "all",
    });
    expect(all.characters).toBe("mock");
    expect(all.chats).toBe("live");
  });
  it("answers registry requirement checks", () => {
    const resolved = resolveSources({
      capabilities: LEGACY_CAPABILITIES,
      reachable: true,
      mocks: "auto",
    });
    expect(satisfies(resolved, ["chats", "timeline"])).toBe(true);
    expect(satisfies(resolved, ["observe"])).toBe(false);
    expect(isMocked(resolved, ["chats", "timeline"])).toBe(true);
    expect(isMocked(resolved, ["chats"])).toBe(false);
  });
});
