import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("reads like a disk's sizes", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(35_400_000)).toBe("35 MB");
    expect(formatBytes(1_020_000_000)).toBe("1.0 GB");
  });
});
