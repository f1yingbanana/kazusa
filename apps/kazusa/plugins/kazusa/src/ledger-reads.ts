import type { SessionCatalogTranscriptItem } from "openclaw/plugin-sdk/session-catalog";
import {
  appendSessionTranscriptMessageByIdentityStrict,
  readSessionTranscriptCatalogPage,
} from "openclaw/plugin-sdk/session-transcript-runtime";

/**
 * Recent rows of a character's ledgers (`agent:<id>:tasks`,
 * `agent:<id>:chat:…`), kept between reads. Every context build and decision
 * reads each of the character's ledgers back to its cutoff, and OpenClaw serves
 * every catalog page with a synchronous database read on the Gateway's main
 * thread: with 145 characters that was about 1,500 page reads a minute, some
 * taking 0.2-0.6 s. Kazusa is the only writer of these ledgers and appends
 * through `appendToLedger`, so a ledger is read again only once it has
 * changed.
 */

type Row = SessionCatalogTranscriptItem;

interface Entry {
  /** The ledger's version when this read started. */
  readonly version: number;
  /** Raw catalog rows, newest first, as the pages gave them. */
  readonly rows: readonly Row[];
  /** The read reached the ledger's first row. */
  readonly whole: boolean;
  /** The rows run through the first one older than this. */
  readonly through?: number;
}

interface Cell {
  readonly versions: Map<string, number>;
  readonly entries: Map<string, Entry>;
  hits: number;
  misses: number;
}

/** One per process: OpenClaw can load the plugin more than once. */
const CELL = Symbol.for("kazusa.ledger-reads");

function cell(): Cell {
  const scope = globalThis as { [CELL]?: Cell };
  return (scope[CELL] ??= {
    versions: new Map(),
    entries: new Map(),
    hits: 0,
    misses: 0,
  });
}

/** The most ledgers kept in memory; the least recently read go first. */
const LIMIT = 4_096;

/** Catalog page size: OpenClaw's maximum, not a history cap. */
const PAGE = 200;

const ledgerKey = (agentId: string, sessionKey: string): string =>
  `${agentId}\u0000${sessionKey}`;

/** Marks a ledger's kept reads out of date. */
export function ledgerChanged(agentId: string, sessionKey: string): void {
  const { versions } = cell();
  const key = ledgerKey(agentId, sessionKey);
  versions.set(key, (versions.get(key) ?? 0) + 1);
}

/**
 * The only way Kazusa appends to a ledger: kept reads are out of date however
 * it ends.
 */
export function appendToLedger(
  params: Parameters<typeof appendSessionTranscriptMessageByIdentityStrict>[0],
): ReturnType<typeof appendSessionTranscriptMessageByIdentityStrict> {
  return appendSessionTranscriptMessageByIdentityStrict(params).finally(() =>
    ledgerChanged(params.agentId, params.sessionKey),
  );
}

const timeOf = (row: Row): number =>
  row.timestamp ? Date.parse(row.timestamp) : Number.NaN;

/** Whether a kept read answers this one exactly as a fresh read would. */
function answers(
  entry: Entry,
  cutoff: number,
  maxRows: number | undefined,
): boolean {
  if (entry.whole) return true;
  if (entry.through !== undefined && cutoff >= entry.through) return true;
  return maxRows !== undefined && entry.rows.length >= maxRows;
}

/**
 * A ledger's rows, newest first, as the catalog pages give them: through the
 * first row older than `cutoff` (rows with no time don't stop it), or the
 * ledger's first row, or at least `maxRows` rows (whole pages). Callers walk
 * them as they walked pages; the rows are shared, so never change them.
 */
export async function readLedgerRows(params: {
  readonly agentId: string;
  readonly sessionKey: string;
  readonly storePath?: string;
  readonly pluginId: string;
  readonly cutoff: number;
  readonly maxRows?: number;
}): Promise<readonly Row[]> {
  const { agentId, sessionKey, storePath, pluginId, cutoff, maxRows } = params;
  const state = cell();
  const key = `${ledgerKey(agentId, sessionKey)}\u0000${storePath ?? ""}`;
  const version = state.versions.get(ledgerKey(agentId, sessionKey)) ?? 0;
  const kept = state.entries.get(key);
  if (kept && kept.version === version && answers(kept, cutoff, maxRows)) {
    state.hits += 1;
    state.entries.delete(key);
    state.entries.set(key, kept);
    return kept.rows;
  }
  state.misses += 1;
  const rows: Row[] = [];
  let cursor: string | undefined;
  let whole = false;
  let through: number | undefined;
  for (;;) {
    const page = await readSessionTranscriptCatalogPage({
      agentId,
      sessionKey,
      storePath,
      pluginId,
      sourceDomain: "kazusa",
      limit: PAGE,
      cursor,
    });
    for (const row of page.items) {
      rows.push(row);
      if (timeOf(row) < cutoff) {
        through = cutoff;
        break;
      }
    }
    if (through !== undefined) break;
    if (!page.nextCursor) {
      whole = true;
      break;
    }
    if (maxRows !== undefined && rows.length >= maxRows) break;
    cursor = page.nextCursor;
  }
  // An append during the read leaves this entry already out of date.
  state.entries.delete(key);
  state.entries.set(key, { version, rows, whole, through });
  if (state.entries.size > LIMIT) {
    const [oldest] = state.entries.keys();
    state.entries.delete(oldest);
  }
  return rows;
}

/** How often kept reads answered, for monitoring and tests. */
export function ledgerReadStats(): {
  readonly ledgers: number;
  readonly hits: number;
  readonly misses: number;
} {
  const { entries, hits, misses } = cell();
  return { ledgers: entries.size, hits, misses };
}

export function resetLedgerReads(): void {
  const state = cell();
  state.versions.clear();
  state.entries.clear();
  state.hits = state.misses = 0;
}
