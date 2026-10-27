import { describe, expect, it } from "vitest";
import { parseEntityRef, sameEntity, serializeEntityRef } from "./entity-ref";

describe("EntityRef serialization", () => {
  it("round-trips ids that themselves contain colons", () => {
    const ref = { kind: "character", id: "user:you" } as const;
    expect(serializeEntityRef(ref)).toBe("character:user:you");
    expect(parseEntityRef("character:user:you")).toEqual(ref);
    expect(parseEntityRef("chat:group:club")).toEqual({
      kind: "chat",
      id: "group:club",
    });
  });
  it("rejects unknown kinds and malformed values", () => {
    for (const value of [null, "", "alice", ":alice", "character:", "robot:x"]) {
      expect(parseEntityRef(value)).toBeNull();
    }
  });
  it("compares by kind and id", () => {
    expect(
      sameEntity({ kind: "chat", id: "a" }, { kind: "chat", id: "a" }),
    ).toBe(true);
    expect(
      sameEntity({ kind: "chat", id: "a" }, { kind: "character", id: "a" }),
    ).toBe(false);
  });
});
