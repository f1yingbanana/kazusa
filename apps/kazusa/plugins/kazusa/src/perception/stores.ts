import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";
import { resolveStateDir } from "../state-dir.ts";
import {
  openDecisionDatabase,
  type DecisionStore,
} from "./decision-database.ts";
import type { PerceptionState } from "./perception.ts";

/*
 * Until 2026-11, Perception kept everything in one keyed namespace,
 * "perception": one inbox record per character and one entry per attention
 * decision, 23,000 of them after one sim-day. Listing the inbox read them all.
 * Now the inbox has a namespace of its own, and the few decisions worth showing
 * a database of their own. The old decisions are not carried over: they say
 * neither what they were about nor what the character was doing, which is all
 * the timeline shows now. The old namespace is emptied once the inbox records
 * have moved.
 */
const LEGACY_NAMESPACE = "perception";
const INBOX_NAMESPACE = "inbox";

/**
 * Old decisions were keyed `<agentId>:decision:<uuid>`; agent ids never contain
 * ":".
 */
const LEGACY_DECISION_KEY = ":decision:";

/** The most rows `moveEntriesFrom` takes at once. */
const MOVE_LIMIT = 10_000;

/** Perception's two stores; the inbox is ready once the old namespace moved. */
export interface PerceptionStores {
  /** One record per character, keyed by agent id. */
  readonly inbox: StateStore<PerceptionState>;
  readonly decisions: DecisionStore;
}

const MIGRATION = Symbol.for("kazusa.perception.storeMigration");

/**
 * Opens the inbox namespace and the decisions database. Every inbox access
 * first waits for the move out of the old namespace: move its inbox records,
 * then empty it. Either step can be cut short by a stop and finished by the
 * next start, so the move runs once per process and its failure is retried by
 * the next access.
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

  async function migrate(): Promise<void> {
    const all = await legacy.entries();
    if (all.length === 0) return;
    const records = all.filter(({ key }) => !key.includes(LEGACY_DECISION_KEY));
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
    await legacy.clear();
  }

  const holder = globalThis as { [MIGRATION]?: Promise<void> };
  const ready = (): Promise<void> =>
    (holder[MIGRATION] ??= migrate().catch((error: unknown) => {
      delete holder[MIGRATION];
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
    decisions: openDecisionDatabase({
      path: path.join(resolveStateDir(), "kazusa", "decisions.sqlite"),
    }),
  };
}
