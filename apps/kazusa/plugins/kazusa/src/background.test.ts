import { describe, expect, it, vi } from "vitest";
import { inBackground, rememberRegistration } from "./background.ts";

const closed = {
  lifecycle: {
    runInBackgroundContext: () => {
      throw new Error("scope closed");
    },
  },
} as never;

describe("inBackground", () => {
  it("never throws when a registration's scope has closed", async () => {
    const work = vi.fn(async () => {});
    expect(() => {
      inBackground(closed, work, () => {});
    }).not.toThrow();
    await vi.waitFor(() => {
      expect(work).toHaveBeenCalledOnce();
    });
  });

  it("falls back to another registration", async () => {
    const run = vi.fn((work: () => Promise<unknown>) => work());
    rememberRegistration({
      lifecycle: { runInBackgroundContext: run },
    } as never);
    const work = vi.fn(async () => {});
    inBackground(closed, work, () => {});
    expect(run).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(work).toHaveBeenCalledOnce();
    });
  });

  it("reports failed work", async () => {
    const warn = vi.fn();
    inBackground(undefined, () => Promise.reject(new Error("no")), warn);
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalled();
    });
  });
});
