import { describe, expect, it } from "vitest";
import { revealCommand } from "./reveal";

describe("revealCommand", () => {
  it("selects the file in Finder and Explorer", () => {
    expect(revealCommand("darwin", "/world/a b/.env")).toEqual([
      "open",
      ["-R", "/world/a b/.env"],
    ]);
    expect(revealCommand("win32", "C:\\a b\\.env")).toEqual([
      "explorer.exe",
      ["/select,", "C:\\a b\\.env"],
    ]);
  });

  it("opens the folder elsewhere", () => {
    expect(revealCommand("linux", "/world/.state/.env")).toEqual([
      "xdg-open",
      ["/world/.state"],
    ]);
  });
});
