import { afterEach, describe, expect, it } from "vitest";
import {
  beginGatewayLifetime,
  followGatewayLifetime,
  noteShutdown,
  shutdownSignal,
} from "./shutdown.ts";

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("kazusa.shutdown")];
});

describe("shutdownSignal", () => {
  it("aborts when the Gateway's start signal does, with no process signal", () => {
    const gateway = new AbortController();
    const waiting = shutdownSignal();
    followGatewayLifetime(gateway.signal);
    expect(waiting.aborted).toBe(false);
    gateway.abort();
    expect(waiting.aborted).toBe(true);
  });

  it("stays stopped until the next registration, which a stale lifetime cannot stop", () => {
    const first = new AbortController();
    followGatewayLifetime(first.signal);
    noteShutdown("draining");
    expect(shutdownSignal().aborted).toBe(true);
    beginGatewayLifetime();
    const next = shutdownSignal();
    expect(next.aborted).toBe(false);
    const second = new AbortController();
    followGatewayLifetime(second.signal);
    first.abort();
    expect(next.aborted).toBe(false);
    second.abort();
    expect(next.aborted).toBe(true);
  });

  it("aborts at once when the start signal already has", () => {
    followGatewayLifetime(AbortSignal.abort());
    expect(shutdownSignal().aborted).toBe(true);
  });
});
