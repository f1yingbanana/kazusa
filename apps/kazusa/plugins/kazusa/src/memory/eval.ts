import type { Page } from "./page.ts";
import type { MemoryIndex } from "./index.ts";
import { renderOnYourMind } from "./render.ts";
import { brainRequest, retrieve, spokenText } from "./retrieve.ts";
import type { RetrievalCase } from "./fixtures/cases.ts";

export interface CaseResult {
  readonly failures: readonly string[];
  readonly ids: readonly string[];
  readonly text: string;
  readonly tokens: number;
}

const estimate = (text: string): number => Math.ceil(text.length / 4);

export function promptOf(test: RetrievalCase): string {
  if (test.prompt) return test.prompt;
  const [name, id] = test.from ?? ["Someone", "someone"];
  return `Incoming chats:\n- [${name} \`${id}\` Tue 16:00] (chat:direct:${id}): ${test.text ?? ""}`;
}

/** Runs one case through the same request and render a brain turn uses. */
export function runCase(
  index: MemoryIndex,
  test: RetrievalCase,
  now: number,
  queryVector?: Float32Array,
): CaseResult {
  const entities = retrieve(index, {
    ...brainRequest({
      agentId: test.agent,
      prompt: promptOf(test),
      ...(test.task ? { task: test.task } : {}),
      here: test.here ?? [],
      awaiting: test.awaiting ?? [],
      now,
    }),
    ...(queryVector ? { queryVector } : {}),
  });
  const nameOf = (id: string): string | undefined =>
    index.world().pages.get(id)?.name;
  const { text, ids } = renderOnYourMind(entities, {
    maxTokens: 800,
    estimate,
    nameOf,
  });
  const failures: string[] = [];
  for (const id of test.expect ?? []) {
    if (!ids.includes(id)) failures.push(`missed ${id}`);
  }
  for (const id of test.forbid ?? []) {
    if (ids.includes(id)) failures.push(`leaked ${id}`);
  }
  if (test.first && ids[0] !== test.first)
    failures.push(`first was ${ids[0] ?? "nothing"}, not ${test.first}`);
  for (const [id, depth] of Object.entries(test.depth ?? {})) {
    const got = entities.find((entity) => entity.id === id)?.knowledge.depth;
    if (got !== depth)
      failures.push(`${id} at ${got ?? "absent"}, not ${depth}`);
  }
  for (const words of test.shows ?? []) {
    if (!text.includes(words)) failures.push(`does not show "${words}"`);
  }
  for (const words of test.hides ?? []) {
    if (text.includes(words)) failures.push(`shows "${words}"`);
  }
  if (test.maxFull !== undefined) {
    const full = text
      .split("\n")
      .filter((line) => line && !/^(Also:| {2}·)/.test(line)).length;
    if (full > test.maxFull) failures.push(`${full} full entries`);
  }
  return { failures, ids, text, tokens: estimate(text) };
}

export const spoken = (test: RetrievalCase): string =>
  spokenText(promptOf(test));

export type { Page };
