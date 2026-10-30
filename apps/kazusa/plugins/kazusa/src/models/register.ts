import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { registerModelsHttp } from "./http.ts";
import {
  createModelSelection,
  splitModelRef,
  type ModelSelection,
  type ModelSelectionStore,
} from "./selection.ts";

/**
 * Every character turn runs in its `:brain` session (Perception handles cron
 * wakes and everything else without a model call), so that is the one place the
 * selection has to reach. The model is swapped per turn here; reasoning has no
 * hook, so the brain channel writes it onto the session before each dispatch
 * (`thinking` in `registerBrainChannel`).
 */
export function registerModels(api: OpenClawPluginApi): ModelSelectionStore {
  const selection = createModelSelection(
    api.runtime.state.openKeyedStore<ModelSelection>({
      namespace: "models",
      retention: "retained",
    }),
  );

  api.on("before_model_resolve", async (_event, ctx) => {
    const owner = parseAgentSessionKey(ctx.sessionKey ?? "");
    if (owner?.rest !== "brain") return;
    const { model } = await selection.read(owner.agentId);
    const ref = model ? splitModelRef(model) : undefined;
    if (!ref) return;
    return { providerOverride: ref.provider, modelOverride: ref.model };
  });

  registerModelsHttp(api, { selection });
  return selection;
}
