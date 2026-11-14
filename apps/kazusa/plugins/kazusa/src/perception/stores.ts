import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";
import { resolveStateDir } from "../state-dir.ts";
import {
  openDecisionDatabase,
  type DecisionStore,
} from "./decision-database.ts";
import type { PerceptionState } from "./perception.ts";

const INBOX_NAMESPACE = "inbox";

/** Perception's two stores. */
export interface PerceptionStores {
  /** One record per character, keyed by agent id. */
  readonly inbox: StateStore<PerceptionState>;
  readonly decisions: DecisionStore;
}

/**
 * Opens the inbox namespace, and the decisions database on first use, so a
 * database that won't open fails recording, never attention routing.
 */
export function openPerceptionStores(api: OpenClawPluginApi): PerceptionStores {
  const inbox = api.runtime.state.openKeyedStore<PerceptionState>({
    namespace: INBOX_NAMESPACE,
    retention: "retained",
  });

  let decisions: DecisionStore | undefined;
  const database = (): DecisionStore =>
    (decisions ??= openDecisionDatabase({
      path: path.join(resolveStateDir(), "kazusa", "decisions.sqlite"),
    }));

  return {
    inbox,
    decisions: {
      record: (agentId, record) => database().record(agentId, record),
      window: (window) => database().window(window),
    },
  };
}
