import { setTimeout as sleep } from "node:timers/promises";
import type { ModelOption } from "@kazusa/client";
import {
  listAgentIds,
  resolveAgentConfig,
} from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { parseAgentSessionKey } from "openclaw/plugin-sdk/routing";
import { inBackground } from "../background.ts";
import { currentConfig } from "../current-config.ts";
import { adminCall } from "../providers/http.ts";
import { modelsConfig } from "./config.ts";
import { catalogModels, registerModelsHttp } from "./http.ts";
import {
  createModelSelection,
  splitModelRef,
  type ModelSelection,
  type ModelSelectionStore,
} from "./selection.ts";
import { createStartingModel, startingModel } from "./starting.ts";

/**
 * Re-reads of the catalog at Gateway start, until a chat model is served: a new
 * world's catalog fills in over the first seconds, and a big one's first reads
 * can fail outright ("Chat metadata access changed while preparing its
 * metadata. Retry the request.", 145 agents). About 15 s in all, and a first
 * turn waits for it. Asking with `refresh: true` instead stopped the whole
 * process tree through `callGatewayFromCli` (both seen live, 2026-11-04).
 */
const START_RETRY_MS = [0, 1000, 2000, 4000, 8000];

export interface Models extends ModelSelectionStore {
  /**
   * The chat model a character runs: picked, else (unless it has its own in
   * `openclaw.json`) the starting model. Undefined leaves it to OpenClaw.
   */
  readonly model: (agentId: string) => Promise<string | undefined>;
}

/**
 * Every character turn runs in its `:brain` session (Perception handles cron
 * wakes and everything else without a model call), so that is the one place the
 * selection has to reach. The model is swapped per turn here, and the brain
 * channel also writes it onto the session before each new turn, since OpenClaw
 * checks a steer against the session's model; reasoning has no hook, so it goes
 * only on the session (`registerBrainChannel`). Unpicked, a turn runs the
 * world's starting model (`starting.ts`), and without one OpenClaw's primary.
 */
export function registerModels(
  api: OpenClawPluginApi,
  overrides: {
    readonly call?: (method: string, params: unknown) => Promise<unknown>;
  } = {},
): Models {
  const store = api.runtime.state.openKeyedStore<ModelSelection>({
    namespace: "models",
    retention: "retained",
  });
  const selection = createModelSelection(store);
  const config = modelsConfig(api.pluginConfig);
  const starting = createStartingModel(store, config);
  const model = async (agentId: string): Promise<string | undefined> => {
    const picked = (await selection.read(agentId)).model;
    if (picked) return picked;
    if (resolveAgentConfig(currentConfig(api), agentId)?.model !== undefined)
      return undefined;
    return starting.current();
  };

  api.on("before_model_resolve", async (_event, ctx) => {
    const owner = parseAgentSessionKey(ctx.sessionKey ?? "");
    if (owner?.rest !== "brain") return;
    const picked = await model(owner.agentId);
    const ref = picked ? splitModelRef(picked) : undefined;
    if (!ref) return;
    return { providerOverride: ref.provider, modelOverride: ref.model };
  });

  // Keys may have changed while the Gateway was down. No request is in scope
  // here, so ask as the CLI does, like Settings' key routes.
  const call = overrides.call ?? adminCall(api);
  const catalogAtStart = async (agentId: string): Promise<ModelOption[]> => {
    let models: ModelOption[] = [];
    let failure: Error | undefined;
    for (const wait of START_RETRY_MS) {
      await sleep(wait);
      try {
        models = catalogModels(
          await call("models.list", { agentId, view: "all" }),
        );
        failure = undefined;
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        continue;
      }
      if (startingModel(models, config)) break;
    }
    // Only when the last read failed too: an earlier catalog is still news.
    if (failure && !models.length) throw failure;
    return models;
  };
  api.on("gateway_start", () => {
    inBackground(
      api,
      async () => {
        const agentId = listAgentIds(currentConfig(api))[0];
        if (!agentId) return;
        const ref = await starting.updateFrom(catalogAtStart(agentId));
        api.logger.info(
          `Starting model: ${ref ?? "none of models.chat is served; OpenClaw's primary runs"}.`,
        );
      },
      (error) =>
        api.logger.warn(
          `Couldn't work out the starting model: ${String(error)}`,
        ),
    );
  });

  registerModelsHttp(api, { selection, starting });
  return { ...selection, model };
}
