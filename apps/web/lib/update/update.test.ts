import { describe, expect, it } from "vitest";
import {
  announcedRelease,
  type UpdateStatus,
  type UpdateTarget,
} from "./update";

const RELEASE: UpdateTarget = {
  version: "0.4.0",
  date: "2026-11-05T09:10:55Z",
  url: "https://github.com/f1yingbanana/kazusa/releases/tag/0.4.0",
  installable: true,
  build: "ready",
  status: "newer",
  changes: 12,
};

function status(release: Partial<UpdateTarget> | null): UpdateStatus {
  return {
    current: { version: "0.3.1", branch: null },
    release: release ? { ...RELEASE, ...release } : null,
    development: null,
    blocked: null,
    failed: null,
    error: null,
    boot: "1",
    staging: false,
  };
}

describe("announcedRelease", () => {
  it("announces a newer release this copy can install", () => {
    expect(announcedRelease(status({}))?.version).toBe("0.4.0");
  });

  it("waits while the release's downloads are still building", () => {
    expect(announcedRelease(status({ build: "building" }))).toBeNull();
  });

  it("announces a source install's release even if its build failed", () => {
    expect(announcedRelease(status({ build: "failed" }))?.version).toBe(
      "0.4.0",
    );
  });

  it("stays quiet when there's nothing to install here", () => {
    expect(announcedRelease(status(null))).toBeNull();
    expect(announcedRelease(status({ status: "current" }))).toBeNull();
    expect(announcedRelease(status({ status: "older" }))).toBeNull();
    expect(
      announcedRelease(status({ installable: false, build: "missing" })),
    ).toBeNull();
  });
});
