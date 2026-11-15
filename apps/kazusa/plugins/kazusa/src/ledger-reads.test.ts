import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  readSessionTranscriptCatalogPage: vi.fn(),
}));

import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import {
  ledgerChanged,
  ledgerReadStats,
  readLedgerRows,
  resetLedgerReads,
} from "./ledger-reads.ts";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-23T12:00:00.000Z");
const read = vi.mocked(readSessionTranscriptCatalogPage);

/** A ledger with a row every hour back from now, newest first, in pages. */
function ledger(rows: number, pageSize = 200) {
  const items = Array.from({ length: rows }, (_, i) => ({
    type: "agentMessage",
    text: `row ${i}`,
    timestamp: new Date(NOW - i * HOUR).toISOString(),
  }));
  read.mockImplementation(async ({ cursor }) => {
    const start = cursor ? Number(cursor) : 0;
    const end = start + pageSize;
    return {
      items: items.slice(start, end) as never,
      ...(end < items.length ? { nextCursor: String(end) } : {}),
    };
  });
  return items;
}

const rowsFor = (cutoff: number, maxRows?: number) =>
  readLedgerRows({
    agentId: "alice",
    sessionKey: "agent:alice:tasks",
    pluginId: "kazusa",
    cutoff,
    ...(maxRows === undefined ? {} : { maxRows }),
  });

describe("readLedgerRows", () => {
  beforeEach(() => {
    resetLedgerReads();
    read.mockReset();
  });

  it("reads a ledger once until it changes", async () => {
    ledger(48);
    const first = await rowsFor(NOW - 16 * HOUR);
    // Through the first row older than the cutoff.
    expect(first.map((row) => row.text)).toEqual(
      Array.from({ length: 18 }, (_, i) => `row ${i}`),
    );
    expect(await rowsFor(NOW - 16 * HOUR)).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);

    ledgerChanged("alice", "agent:alice:tasks");
    await rowsFor(NOW - 16 * HOUR);
    expect(read).toHaveBeenCalledTimes(2);
    // Another character's ledger changing doesn't matter.
    ledgerChanged("bob", "agent:alice:tasks");
    ledgerChanged("alice", "agent:alice:chat:direct:bob");
    await rowsFor(NOW - 16 * HOUR);
    expect(read).toHaveBeenCalledTimes(2);
    expect(ledgerReadStats()).toMatchObject({ hits: 2, misses: 2 });
  });

  it("stops once the caller has enough, and reads on for one that needs more", async () => {
    ledger(800);
    const enough = (count: number) => (rows: readonly unknown[]) =>
      rows.length >= count;
    const read1 = () =>
      readLedgerRows({
        agentId: "alice",
        sessionKey: "agent:alice:tasks",
        pluginId: "kazusa",
        cutoff: NOW - 1_000 * HOUR,
        maxRows: 800,
        enough: enough(150),
      });
    const first = await read1();
    expect(first).toHaveLength(200);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await read1()).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    // Without enough, the kept page answers nothing: read on to maxRows.
    expect(await rowsFor(NOW - 1_000 * HOUR, 800)).toHaveLength(800);
    expect(read).toHaveBeenCalledTimes(5);
  });

  it("answers a later cutoff from a longer read, and reads again for an earlier one", async () => {
    ledger(600);
    await rowsFor(NOW - 16 * HOUR);
    await rowsFor(NOW - 4 * HOUR);
    expect(read).toHaveBeenCalledTimes(1);
    const longer = await rowsFor(NOW - 24 * HOUR);
    expect(read).toHaveBeenCalledTimes(2);
    expect(longer).toHaveLength(26);
  });

  it("follows pages to the cutoff, or the ledger's start", async () => {
    ledger(450, 200);
    expect(await rowsFor(NOW - 300 * HOUR)).toHaveLength(302);
    expect(read).toHaveBeenCalledTimes(2);
    resetLedgerReads();
    read.mockClear();
    const whole = await rowsFor(NOW - 1_000 * HOUR);
    expect(whole).toHaveLength(450);
    expect(read).toHaveBeenCalledTimes(3);
    // The whole ledger answers any cutoff.
    await rowsFor(NOW - 2_000 * HOUR);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("stops at whole pages once it has enough rows", async () => {
    ledger(1_000, 200);
    expect(await rowsFor(NOW - 2_000 * HOUR, 400)).toHaveLength(400);
    expect(read).toHaveBeenCalledTimes(2);
    // Enough for the same cap, not for the whole cutoff.
    await rowsFor(NOW - 2_000 * HOUR, 400);
    expect(read).toHaveBeenCalledTimes(2);
    await rowsFor(NOW - 2_000 * HOUR);
    expect(read).toHaveBeenCalledTimes(7);
  });

  it("keeps a read that an append overtook out of date", async () => {
    ledger(10);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const original = read.getMockImplementation()!;
    read.mockImplementationOnce(async (params) => {
      await gate;
      return original(params);
    });
    const pending = rowsFor(NOW - 16 * HOUR);
    ledgerChanged("alice", "agent:alice:tasks");
    release();
    await pending;
    await rowsFor(NOW - 16 * HOUR);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
