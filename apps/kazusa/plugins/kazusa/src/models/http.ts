import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { getRuntimeConfig } from "openclaw/plugin-sdk/runtime-config-snapshot";
import {
  ModelSelectPayloadSchema,
  ThinkingLevelSchema,
  ThinkingSelectPayloadSchema,
  type ModelOption,
  type ModelSelectResponse,
  type ModelsResponse,
  type ThinkingOption,
  type ThinkingSelectResponse,
} from "@kazusa/client";
import { z } from "zod";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import type { ModelSelectionStore } from "./selection.ts";

type Config = ReturnType<typeof getRuntimeConfig>;

/** The slice of a `models.list` result the client needs; the rest is dropped. */
const ModelsListResultSchema = z.object({
  models: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      provider: z.string(),
      alias: z.string().optional(),
      available: z.boolean().optional(),
      unavailableReason: z
        .enum(["missing-auth", "auth-failed", "cooldown"])
        .optional(),
      contextWindow: z.number().int().optional(),
      reasoning: z.boolean().optional(),
      thinkingLevels: z
        .array(z.object({ id: z.string(), label: z.string() }))
        .optional(),
      thinkingDefault: z.string().optional(),
    }),
  ),
  providerOutcomes: z
    .array(
      z.object({
        provider: z.string(),
        status: z.enum(["ready", "auth-rejected", "unavailable"]),
      }),
    )
    .optional(),
});

export interface ModelsDeps {
  /** Raw `models.list` payload for one agent's view of the catalog. */
  readonly list: (params: {
    readonly agentId: string;
    readonly refresh: boolean;
  }) => Promise<unknown>;
  readonly readConfig: () => Config;
  readonly selection: ModelSelectionStore;
}

function defaultsOf(config: Config) {
  return (
    config as {
      agents?: {
        defaults?: {
          model?: string | { primary?: string };
          models?: Record<string, { alias?: string } | undefined>;
        };
      };
    }
  ).agents?.defaults;
}

function primaryOf(config: Config): string | undefined {
  const model = defaultsOf(config)?.model;
  return typeof model === "string" ? model : model?.primary;
}

/** Drops `ultra` and anything newer than the client knows. */
function thinkingOptions(
  levels: readonly { id: string; label: string }[] = [],
): ThinkingOption[] {
  return levels.flatMap(({ id, label }) => {
    const parsed = ThinkingLevelSchema.safeParse(id);
    return parsed.success ? [{ id: parsed.data, label }] : [];
  });
}

const gatewayDeps: Omit<ModelsDeps, "selection"> = {
  list: async ({ agentId, refresh }) => {
    const response = await dispatchGatewayMethod(
      "models.list",
      { agentId, view: "default", ...(refresh ? { refresh: true } : {}) },
      { timeoutMs: 60_000 },
    );
    if (!response.ok)
      throw new Error(
        response.error?.message ?? "The Gateway couldn't list models.",
      );
    return response.payload;
  },
  readConfig: () => getRuntimeConfig(),
};

/**
 * One model and reasoning level for every character, kept in Kazusa's selection
 * (`selection.ts`) and falling back to `openclaw.json`. The catalog comes from
 * the Gateway, which discovers provider models itself, so the world config only
 * lists the shortlist (`agents.defaults.models`) by hand.
 */
export function registerModelsHttp(
  api: OpenClawPluginApi,
  overrides: Pick<ModelsDeps, "selection"> & Partial<ModelsDeps>,
): void {
  const deps: ModelsDeps = { ...gatewayDeps, ...overrides };
  // `models.list` is dispatched as the caller, so the Gateway must authenticate.
  const route = createRouteRegistrar(api, { auth: "gateway" });

  const catalog = async (refresh: boolean): Promise<ModelsResponse> => {
    const config = deps.readConfig();
    // Without an agent the Gateway can't tell whose catalog to read; all
    // characters share the defaults, so any one of them will do.
    const [agentId] = listAgentIds(config);
    if (!agentId) throw new Error("No characters are configured.");
    const result = ModelsListResultSchema.parse(
      await deps.list({ agentId, refresh }),
    );
    const shortlist = defaultsOf(config)?.models ?? {};
    const selected = await deps.selection.read();
    const models = result.models.map((model): ModelOption => {
      const ref = `${model.provider}/${model.id}`;
      return {
        ref,
        provider: model.provider,
        id: model.id,
        name: model.name,
        alias: model.alias ?? shortlist[ref]?.alias,
        pinned: ref in shortlist,
        available: model.available !== false,
        unavailableReason: model.unavailableReason,
        contextWindow: model.contextWindow,
        reasoning: model.reasoning,
        thinkingLevels: thinkingOptions(model.thinkingLevels),
        thinkingDefault: ThinkingLevelSchema.safeParse(model.thinkingDefault)
          .data,
      };
    });
    return {
      current: selected.model ?? primaryOf(config),
      configured: primaryOf(config),
      thinking: selected.thinking,
      models,
      providers: result.providerOutcomes ?? [],
    };
  };

  route("models", "GET", async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    sendJson(
      res,
      200,
      (await catalog(url.searchParams.has("refresh"))) satisfies ModelsResponse,
    );
  });

  route("model", "POST", async (req, res) => {
    const { ref } = ModelSelectPayloadSchema.parse(await readJsonBody(req));
    const model = (await catalog(false)).models.find(
      (option) => option.ref === ref,
    );
    if (!model) {
      sendJson(res, 404, { error: `${ref} isn't in the model catalog.` });
      return;
    }
    if (!model.available) {
      sendJson(res, 409, {
        error: `${model.name} can't run yet: ${model.unavailableReason ?? "unavailable"}.`,
      });
      return;
    }
    await deps.selection.update({ model: ref });
    sendJson(res, 200, { current: ref } satisfies ModelSelectResponse);
  });

  route("thinking", "POST", async (req, res) => {
    const { level } = ThinkingSelectPayloadSchema.parse(
      await readJsonBody(req),
    );
    if (level) {
      const { current, models } = await catalog(false);
      const model = models.find((option) => option.ref === current);
      if (
        model &&
        !model.thinkingLevels.some((option) => option.id === level)
      ) {
        sendJson(res, 409, {
          error: `${model.alias ?? model.name} can't think at "${level}".`,
        });
        return;
      }
    }
    await deps.selection.update({ thinking: level ?? undefined });
    sendJson(res, 200, {
      ...(level ? { thinking: level } : {}),
    } satisfies ThinkingSelectResponse);
  });
}
