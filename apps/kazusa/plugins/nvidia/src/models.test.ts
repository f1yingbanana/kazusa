import { describe, expect, it } from "vitest";
import {
  NVIDIA_BASE_URL,
  buildStaticProvider,
  featuredModel,
  projectModels,
} from "./models.ts";

/** NVIDIA's public `/v1/models` on 2026-11-18: ids alone. */
const LISTED = [
  "bigcode/starcoder2-15b",
  "google/gemma-4-31b-it",
  "moonshotai/kimi-k3.1-pro",
  "nvidia/ai-synthetic-video-detector",
  "nvidia/embed-qa-4",
  "nvidia/llama-3.1-nemoguard-8b-topic-control",
  "nvidia/llama-3.2-nemoretriever-1b-vlm-embed-v1",
  "nvidia/llama-3.2-nv-embedqa-1b-v1",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3.5-content-safety",
  "nvidia/nv-embedqa-mistral-7b-v2",
  "nvidia/nvclip",
  "nvidia/riva-translate-4b-instruct-v2",
  "snowflake/arctic-embed-l",
  "z-ai/glm-5.3-flash",
].map((id) => ({ id, object: "model", created: 0, owned_by: "x" }));

const featured = featuredModel({
  model: "nvidia/nemotron-3-ultra-550b-a55b",
  "model-name": "Nemotron 3 Ultra 550B",
  context: 1_048_576,
  "max-output": 8192,
});

describe("NVIDIA models", () => {
  it("offers every listed model that can chat, known or not", () => {
    const ids = projectModels(LISTED, buildStaticProvider()).map((m) => m.id);
    expect(ids).toEqual([
      "bigcode/starcoder2-15b",
      "google/gemma-4-31b-it",
      "moonshotai/kimi-k3.1-pro",
      "nvidia/llama-3.1-nemoguard-8b-topic-control",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "nvidia/nemotron-3.5-content-safety",
      "nvidia/riva-translate-4b-instruct-v2",
      "z-ai/glm-5.3-flash",
    ]);
  });

  it("offers nothing NVIDIA doesn't list, featured or not", () => {
    const fallback = {
      ...buildStaticProvider(),
      models: [featured!],
    };
    const ids = projectModels([{ id: "z-ai/glm-5.3-flash" }], fallback).map(
      (m) => m.id,
    );
    expect(ids).toEqual(["z-ai/glm-5.3-flash"]);
  });

  it("takes a featured model's limits and name", () => {
    const fallback = { ...buildStaticProvider(), models: [featured!] };
    const ultra = projectModels(LISTED, fallback).find(
      (m) => m.id === "nvidia/nemotron-3-ultra-550b-a55b",
    );
    expect(ultra).toMatchObject({
      name: "Nemotron 3 Ultra 550B",
      contextWindow: 1_048_576,
      maxTokens: 8192,
    });
  });

  it("never lends a featured model's limits to a model it doesn't cover", () => {
    const fallback = { ...buildStaticProvider(), models: [featured!] };
    const small = projectModels(
      [{ id: "nvidia/cosmos-reason2-8b" }],
      fallback,
    )[0];
    expect(small?.contextWindow).toBe(128_000);
  });

  it("sends string content to every model, and Ultra's template settings", () => {
    const models = projectModels(LISTED, buildStaticProvider());
    for (const model of models)
      expect(model.compat).toMatchObject({ requiresStringContent: true });
    expect(
      models.find((m) => m.id === "nvidia/nemotron-3-ultra-550b-a55b")?.params,
    ).toEqual({
      chat_template_kwargs: {
        enable_thinking: false,
        force_nonempty_content: true,
      },
    });
  });

  it("keeps a bare featured id under NVIDIA and skips rows missing limits", () => {
    expect(
      featuredModel({
        model: "nemotron-x",
        "model-name": "X",
        context: 10,
        "max-output": 5,
      })?.id,
    ).toBe("nvidia/nemotron-x");
    expect(
      featuredModel({ model: "a/b", "model-name": "B", context: 10 }),
    ).toBeUndefined();
  });

  it("has no models of its own without a listing", () => {
    expect(buildStaticProvider()).toEqual({
      baseUrl: NVIDIA_BASE_URL,
      api: "openai-completions",
      models: [],
    });
  });
});
