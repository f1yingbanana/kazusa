import type { ThinkingLevel } from "@kazusa/client";
import { KeyedAsyncQueue } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";

/**
 * Sparse model and reasoning choices for the world or one agent. Agent fields
 * inherit the world's choices, then OpenClaw's native defaults.
 *
 * This lives in plugin state rather than `openclaw.json` because OpenClaw
 * treats any change to a configured model ref as a provider change and reloads
 * every plugin (Kazusa included) for about ten seconds. See
 * `backend-contract.md`, "Built: models".
 */
export interface ModelSelection {
  /** `provider/model`. */
  readonly model?: string;
  readonly thinking?: ThinkingLevel;
}

const WORLD_KEY = "world";
const scopeKey = (agentId?: string): string =>
  agentId === undefined ? WORLD_KEY : `agent:${agentId}`;

// Plugin registrations share the retained store, so serialize their patches too.
const QUEUE = Symbol.for("kazusa.models.serial");
function sharedQueue(): KeyedAsyncQueue {
  const scope = globalThis as { [QUEUE]?: KeyedAsyncQueue };
  return (scope[QUEUE] ??= new KeyedAsyncQueue());
}

export interface ModelSelectionStore {
  readonly read: (agentId?: string) => Promise<ModelSelection>;
  /** This agent's explicit choices, without inherited world values. */
  readonly overrides: (agentId: string) => Promise<ModelSelection>;
  /** Merges `patch`; an `undefined` field goes back to its fallback. */
  readonly update: (
    patch: ModelSelection,
    agentId?: string,
  ) => Promise<ModelSelection>;
}

export function createModelSelection(
  store: StateStore<ModelSelection>,
): ModelSelectionStore {
  const own = async (agentId?: string): Promise<ModelSelection> =>
    (await store.lookup(scopeKey(agentId))) ?? {};
  const read = async (agentId?: string): Promise<ModelSelection> => {
    const world = await own();
    return agentId === undefined
      ? world
      : { ...world, ...(await own(agentId)) };
  };
  return {
    read,
    overrides: own,
    update: (patch, agentId) =>
      sharedQueue().enqueue(scopeKey(agentId), async () => {
        const merged = { ...(await own(agentId)), ...patch };
        // Drop cleared fields so the record says only what was chosen.
        const next: ModelSelection = {
          ...(merged.model ? { model: merged.model } : {}),
          ...(merged.thinking ? { thinking: merged.thinking } : {}),
        };
        await store.register(scopeKey(agentId), next);
        return next;
      }),
  };
}

/** `venice/qwen3-235b` → `{ provider: "venice", model: "qwen3-235b" }`. */
export function splitModelRef(
  ref: string,
): { readonly provider: string; readonly model: string } | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}
