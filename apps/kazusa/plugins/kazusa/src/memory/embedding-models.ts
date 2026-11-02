import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  EmbeddingModelSelectPayloadSchema,
  type EmbeddingModelOption,
  type EmbeddingModelsResponse,
} from "@kazusa/client";
import { currentConfig } from "../current-config.ts";
import type { ModelSelectionStore } from "../models/selection.ts";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";

/** An OpenAI-compatible `/embeddings` model, reached with one provider's key. */
export interface EmbeddingChoice {
  /** OpenClaw's provider id, whose key it uses. */
  readonly provider: string;
  readonly model: string;
  readonly name: string;
  readonly baseUrl: string;
  /**
   * The vectors it makes. The same model through two providers makes the same
   * vectors, so they share one set and switching between them costs nothing.
   */
  readonly vectors: string;
}

const OPENAI_SMALL = "openai/text-embedding-3-small";
const OPENAI_LARGE = "openai/text-embedding-3-large";

/** Alphabetical by provider. */
export const EMBEDDING_MODELS: readonly EmbeddingChoice[] = [
  {
    provider: "google",
    model: "gemini-embedding-001",
    name: "Gemini Embedding",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    vectors: "google/gemini-embedding-001",
  },
  {
    provider: "mistral",
    model: "mistral-embed",
    name: "Mistral Embed",
    baseUrl: "https://api.mistral.ai/v1",
    vectors: "mistral/mistral-embed",
  },
  {
    provider: "openai",
    model: "text-embedding-3-small",
    name: "text-embedding-3-small",
    baseUrl: "https://api.openai.com/v1",
    vectors: OPENAI_SMALL,
  },
  {
    provider: "openai",
    model: "text-embedding-3-large",
    name: "text-embedding-3-large",
    baseUrl: "https://api.openai.com/v1",
    vectors: OPENAI_LARGE,
  },
  {
    provider: "openrouter",
    model: OPENAI_SMALL,
    name: "text-embedding-3-small",
    baseUrl: "https://openrouter.ai/api/v1",
    vectors: OPENAI_SMALL,
  },
  {
    provider: "openrouter",
    model: OPENAI_LARGE,
    name: "text-embedding-3-large",
    baseUrl: "https://openrouter.ai/api/v1",
    vectors: OPENAI_LARGE,
  },
];

export const refOf = (choice: EmbeddingChoice): string =>
  `${choice.provider}/${choice.model}`;

/**
 * `memory.embedding` in `openclaw.json`: a listed model, or the user's own
 * endpoint, whose vectors are filed under its model name as they always were.
 */
export function configuredChoice(embedding: {
  readonly baseUrl: string;
  readonly provider: string;
  readonly model: string;
}): EmbeddingChoice {
  return (
    EMBEDDING_MODELS.find(
      (choice) =>
        choice.provider === embedding.provider &&
        choice.model === embedding.model,
    ) ?? {
      ...embedding,
      name: embedding.model,
      vectors: embedding.model,
    }
  );
}

export interface EmbeddingModels {
  /** The choice in force: the one picked here, else the configured one. */
  readonly current: () => Promise<EmbeddingChoice>;
  /** Whether the provider has a key right now. */
  readonly usable: (choice: EmbeddingChoice) => boolean;
}

/**
 * The memory search model, picked like the chat model: kept in Kazusa's
 * selection (`ModelSelection.embedding`), with `memory.embedding` as the
 * default, so a switch reloads nothing. Switching changes which stored vectors
 * the index reads; pages without one are embedded in the background, and recall
 * leans on keywords until then.
 */
export function registerEmbeddingModels(
  api: OpenClawPluginApi,
  deps: {
    readonly selection: ModelSelectionStore;
    readonly configured: EmbeddingChoice;
    readonly useVectors: (vectors: string) => void;
    readonly progress: () => { embedded: number; total: number };
    /** Embeds what the new choice lacks, without waiting. */
    readonly fillIn: () => void;
  },
): EmbeddingModels {
  const choices = (): EmbeddingChoice[] =>
    EMBEDDING_MODELS.some((choice) => refOf(choice) === refOf(deps.configured))
      ? [...EMBEDDING_MODELS]
      : [...EMBEDDING_MODELS, deps.configured];
  const usable = (choice: EmbeddingChoice): boolean =>
    api.runtime.modelAuth.isProviderApiKeyConfigured({
      provider: choice.provider,
      cfg: currentConfig(api),
    });
  const current = async (): Promise<EmbeddingChoice> => {
    const picked = (await deps.selection.read()).embedding;
    return (
      choices().find((choice) => refOf(choice) === picked) ?? deps.configured
    );
  };

  const state = async (): Promise<EmbeddingModelsResponse> => {
    const choice = await current();
    deps.useVectors(choice.vectors);
    return {
      current: refOf(choice),
      configured: refOf(deps.configured),
      options: choices().map((option): EmbeddingModelOption => {
        const available = usable(option);
        return {
          ref: refOf(option),
          provider: option.provider,
          name: option.name,
          vectors: option.vectors,
          available,
          ...(available ? {} : { unavailableReason: "missing-auth" }),
        };
      }),
      progress: deps.progress(),
    };
  };

  const route = createRouteRegistrar(api);
  route("models/embedding", "GET", async (_req, res) => {
    sendJson(res, 200, (await state()) satisfies EmbeddingModelsResponse);
  });
  route("models/embedding/select", "POST", async (req, res) => {
    const { ref } = EmbeddingModelSelectPayloadSchema.parse(
      await readJsonBody(req),
    );
    const choice = ref
      ? choices().find((option) => refOf(option) === ref)
      : deps.configured;
    if (!choice) {
      sendJson(res, 404, { error: `${ref} isn't a memory search model.` });
      return;
    }
    if (!usable(choice)) {
      sendJson(res, 409, {
        error: `${choice.name} needs a ${choice.provider} key first.`,
      });
      return;
    }
    await deps.selection.update({ embedding: refOf(choice) });
    deps.useVectors(choice.vectors);
    deps.fillIn();
    sendJson(res, 200, (await state()) satisfies EmbeddingModelsResponse);
  });

  return { current, usable };
}
