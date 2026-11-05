import { z } from "zod";

const preferences = (defaults: readonly string[]) =>
  z.array(z.string().min(1)).default([...defaults]);

/**
 * `plugins.entries.kazusa.config.models`: which providers the setup guide
 * offers, and what each model role runs until someone picks for it.
 *
 * `chat`, `decision` and `embedding` list models best first. A role runs the
 * first one that some provider with a working key serves (`preferred`), matched
 * by name or by the last part of a model's id, ignoring case, spaces and
 * punctuation, so `"GLM 5.3 Flash"` matches OpenRouter's `z-ai/glm-5.3-flash`
 * and Z.AI's `glm-5.3-flash`.
 */
export const MODELS_CONFIG = z.strictObject({
  /**
   * The providers the setup guide offers a key for, in order. When several
   * providers with a key serve a preferred model, the first listed here runs
   * it; unlisted ones come after.
   */
  providers: preferences(["openrp", "openrouter"]),
  /** From the Gateway's catalog. With none served, OpenClaw's primary runs. */
  chat: preferences([
    "GLM 5.3 Flash",
    "MiMo V2.6 Flash",
    "DeepSeek V4.1 Flash",
  ]),
  /** From `JEV_ROUTES`. With none served, the first route. */
  decision: preferences(["Jev"]),
  /**
   * From `EMBEDDING_MODELS`. A hand-configured `memory.embedding` endpoint
   * comes first; with none served, recall uses keywords.
   */
  embedding: preferences(["text-embedding-3-small"]),
});
export type ModelsConfig = z.infer<typeof MODELS_CONFIG>;

export const modelsConfig = (pluginConfig: unknown): ModelsConfig =>
  MODELS_CONFIG.parse(
    (pluginConfig as { models?: unknown } | undefined)?.models ?? {},
  );

/** `"Z.ai: GLM 5.3 Flash"` and `"glm-5.3-flash"` both → `"glm53flash"`. */
const key = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A name without its vendor prefix (`"Z.ai: "`), as OpenRouter writes them. */
const nameKey = (name: string): string => key(name.replace(/^[^:]*:\s*/, ""));

/** The last part of an id: `z-ai/glm-5.3-flash` → `glm-5.3-flash`. */
const idKey = (id: string): string => key(id.slice(id.lastIndexOf("/") + 1));

export interface Candidate {
  readonly provider: string;
  /** The model's id at that provider. */
  readonly id: string;
  readonly name: string;
}

/**
 * The first of `wanted` among `candidates` (pass only what can run), through
 * the first of `providers` that serves it, else in the candidates' order.
 */
export function preferred<T>(
  candidates: readonly T[],
  wanted: readonly string[],
  providers: readonly string[],
  describe: (candidate: T) => Candidate,
): T | undefined {
  const rank = (candidate: T): number => {
    const index = providers.indexOf(describe(candidate).provider);
    return index < 0 ? providers.length : index;
  };
  for (const name of wanted) {
    const target = key(name);
    const match = candidates
      .filter((candidate) => {
        const model = describe(candidate);
        return idKey(model.id) === target || nameKey(model.name) === target;
      })
      .toSorted((a, b) => rank(a) - rank(b))[0];
    if (match) return match;
  }
  return undefined;
}
