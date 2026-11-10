import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";
import { resolveStateDir } from "../state-dir.ts";
import {
  isLegacyDecisionKey,
  openDecisionDatabase,
  type DecisionStore,
} from "./decision-database.ts";
import type { PerceptionState } from "./perception.ts";

/*
 * Until 2026-11, Perception kept everything in one keyed namespace,
 * "perception": one inbox record per character and one entry per attention
 * decision, 23,000 of them after two sim-days. Listing the inbox read them all.
 * Now the inbox has a namespace of its own and decisions a database of their
 * own; the old namespace is emptied once both have moved.
 */
const LEGACY_NAMESPACE = "perception";
const INBOX_NAMESPACE = "inbox";

/** The most rows `moveEntriesFrom` takes at once. */
const MOVE_LIMIT = 10_000;

/** Perception's two stores, ready once the old namespace has moved. */
export interface PerceptionStores {
  /** One record per character, keyed by agent id. */
  readonly inbox: StateStore<PerceptionState>;
  readonly decisions: DecisionStore;
}

const MIGRATION = Symbol.for("kazusa.perception.storeMigration");

/**
 * Opens the inbox namespace and the decisions database. Every inbox access
 * first waits for the move out of the old namespace: copy its decisions into
 * the database, move its inbox records, then empty it. Each step can be cut
 * short by a stop and finished by the next start, so the move runs once per
 * process and its failure is retried by the next access.
 */
export function openPerceptionStores(api: OpenClawPluginApi): PerceptionStores {
  const state = api.runtime.state;
  const legacy = state.openKeyedStore<unknown>({
    namespace: LEGACY_NAMESPACE,
    retention: "retained",
  });
  const inbox = state.openKeyedStore<PerceptionState>({
    namespace: INBOX_NAMESPACE,
    retention: "retained",
  });
  // Read once for both steps: 23,000 rows on the first start, none after.
  let listed: ReturnType<typeof legacy.entries> | undefined;
  const legacyEntries = () => (listed ??= legacy.entries());
  const decisions = openDecisionDatabase({
    path: path.join(resolveStateDir(), "kazusa", "decisions.sqlite"),
    legacy: { entries: legacyEntries },
  });

  async function migrate(): Promise<void> {
    await decisions.ready?.();
    const records = (await legacyEntries()).filter(
      ({ key }) => !isLegacyDecisionKey(key),
    );
    if (inbox.moveEntriesFrom) {
      // Atomic per call; a record already in the inbox wins.
      for (let at = 0; at < records.length; at += MOVE_LIMIT)
        await inbox.moveEntriesFrom({
          namespace: LEGACY_NAMESPACE,
          entries: records
            .slice(at, at + MOVE_LIMIT)
            .map(({ key }) => ({ sourceKey: key, targetKey: key })),
        });
    } else {
      for (const { key, value } of records)
        if ((await inbox.lookup(key)) === undefined)
          await inbox.register(key, value as PerceptionState);
    }
    const all = await legacyEntries();
    // Nothing keeps the old rows in memory once they have moved.
    listed = undefined;
    if (all.length > 0) await legacy.clear();
  }

  const holder = globalThis as { [MIGRATION]?: Promise<void> };
  const ready = (): Promise<void> =>
    (holder[MIGRATION] ??= migrate().catch((error: unknown) => {
      delete holder[MIGRATION];
      listed = undefined;
      api.logger.warn(
        `Perception: moving its records failed: ${String(error)}`,
      );
      throw error;
    }));

  return {
    inbox: {
      lookup: async (key) => {
        await ready();
        return inbox.lookup(key);
      },
      register: async (...args) => {
        await ready();
        return inbox.register(...args);
      },
      entries: async () => {
        await ready();
        return inbox.entries();
      },
    },
    decisions: {
      ready,
      record: (agentId, record) => decisions.record(agentId, record),
      window: (window) => decisions.window(window),
    },
  };
}
