import { WORLD_SCOPE, personalScope, type MemoryIndex } from "./index.ts";
import { searchQuery } from "./index.ts";

export interface Embedder {
  readonly model: string;
  readonly embed: (
    texts: readonly string[],
    signal?: AbortSignal,
  ) => Promise<number[][]>;
}

const BATCH = 96;
const QUERY_TIMEOUT_MS = 3_000;

/** The OpenAI-compatible `/embeddings` call. */
export function openAiEmbedder(options: {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}): Embedder {
  const url = `${options.baseUrl.replace(/\/+$/, "")}/embeddings`;
  return {
    model: options.model,
    embed: async (texts, signal) => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
          "api-key": options.apiKey,
        },
        body: JSON.stringify({ model: options.model, input: texts }),
        ...(signal ? { signal } : {}),
      });
      if (!response.ok) {
        throw new Error(`Embeddings failed: HTTP ${response.status}`);
      }
      const { data } = (await response.json()) as {
        data: Array<{ index: number; embedding: number[] }>;
      };
      return [...data]
        .sort((a, b) => a.index - b.index)
        .map(({ embedding }) => embedding);
    },
  };
}

/** Embeds what has no vector yet, a batch at a time, until nothing is left. */
export async function embedPending(
  index: MemoryIndex,
  embedder: Embedder,
  agentId?: string,
): Promise<number> {
  const scopes = [WORLD_SCOPE, ...(agentId ? [personalScope(agentId)] : [])];
  let embedded = 0;
  for (;;) {
    const texts = index.unembedded(scopes, BATCH);
    if (!texts.length) return embedded;
    const vectors = await embedder.embed(texts);
    index.addVectors(texts.map((text, i) => [text, vectors[i]] as const));
    embedded += texts.length;
  }
}

/** The stimulus as a vector, or undefined: a turn never waits long or fails. */
export async function embedQuery(
  embedder: Embedder,
  text: string,
  warn: (message: string) => void,
): Promise<Float32Array | undefined> {
  if (!searchQuery(text)) return undefined;
  try {
    const [vector] = await embedder.embed(
      [text],
      AbortSignal.timeout(QUERY_TIMEOUT_MS),
    );
    return vector ? Float32Array.from(vector) : undefined;
  } catch (error: unknown) {
    warn(`Memory: keywords only this turn: ${String(error)}`);
    return undefined;
  }
}
