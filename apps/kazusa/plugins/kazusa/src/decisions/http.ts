import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  DecisionModelSelectPayloadSchema,
  type DecisionModelsResponse,
} from "@kazusa/client";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import type { ModelsConfig } from "../models/config.ts";
import type { ModelSelectionStore } from "../models/selection.ts";
import { JEV_ROUTES, jevRoute, routeRef } from "./jev.ts";

/**
 * The decision model, picked like the chat model: the same Jev under each
 * provider whose key can run it, kept in Kazusa's selection; unpicked, or once
 * its key is gone, the first of `models.decision` with a key (`jevRoute`). A
 * pick takes effect on the next decision, with nothing written to
 * `openclaw.json`.
 */
export function registerDecisionModelsHttp(
  api: OpenClawPluginApi,
  deps: {
    readonly selection: ModelSelectionStore;
    readonly keyConfigured: (provider: string) => boolean;
    readonly config: ModelsConfig;
  },
): void {
  const route = createRouteRegistrar(api);

  const state = async (): Promise<DecisionModelsResponse> => {
    const { decision } = await deps.selection.read();
    const current = jevRoute(decision, deps.keyConfigured, deps.config);
    return {
      current: routeRef(current),
      options: JEV_ROUTES.map((option) => {
        const available = deps.keyConfigured(option.provider);
        return {
          ref: routeRef(option),
          provider: option.provider,
          name: option.name,
          available,
          ...(available ? {} : { unavailableReason: "missing-auth" as const }),
        };
      }),
    };
  };

  route("models/decision", "GET", async (_req, res) => {
    sendJson(res, 200, (await state()) satisfies DecisionModelsResponse);
  });

  route("models/decision/select", "POST", async (req, res) => {
    const { ref } = DecisionModelSelectPayloadSchema.parse(
      await readJsonBody(req),
    );
    const option = JEV_ROUTES.find((candidate) => routeRef(candidate) === ref);
    if (!option) {
      sendJson(res, 404, { error: `${ref} isn't a decision model.` });
      return;
    }
    if (!deps.keyConfigured(option.provider)) {
      sendJson(res, 409, {
        error: `${option.name} through ${option.provider} needs its key first.`,
      });
      return;
    }
    await deps.selection.update({ decision: ref });
    sendJson(res, 200, (await state()) satisfies DecisionModelsResponse);
  });
}
