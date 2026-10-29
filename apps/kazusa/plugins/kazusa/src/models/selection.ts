import type { ThinkingLevel } from "@kazusa/client";
import type { StateStore } from "../state.ts";

/**
 * The model and reasoning level every character runs on. Unset fields fall back
 * to `openclaw.json`: `agents.defaults.model.primary` for the model, and each
 * model's own default for reasoning.
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

const KEY = "world";

export interface ModelSelectionStore {
  readonly read: () => Promise<ModelSelection>;
  /** Merges `patch`; an `undefined` field goes back to its fallback. */
  readonly update: (patch: ModelSelection) => Promise<ModelSelection>;
}

export function createModelSelection(
  store: StateStore<ModelSelection>,
): ModelSelectionStore {
  const read = async (): Promise<ModelSelection> =>
    (await store.lookup(KEY)) ?? {};
  return {
    read,
    update: async (patch) => {
      const merged = { ...(await read()), ...patch };
      // Drop cleared fields so the record says only what was chosen.
      const next: ModelSelection = {
        ...(merged.model ? { model: merged.model } : {}),
        ...(merged.thinking ? { thinking: merged.thinking } : {}),
      };
      await store.register(KEY, next);
      return next;
    },
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
