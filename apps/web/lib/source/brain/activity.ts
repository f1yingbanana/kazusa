import type {
  BrainCall,
  BrainStep,
  BrainTurn,
  ChatMessage,
} from "@kazusa/client";

export type ToolStep = Extract<BrainStep, { type: "tool" }>;

/** LLM calls in a row, shown just before a message, or last when it has none. */
export interface BrainActivity {
  readonly key: string;
  readonly beforeSequence?: number;
  readonly calls: readonly BrainCall[];
}

/**
 * Where a brain's LLM calls fall among its chat's messages, by real time: sim
 * time stands still while paused. Anything older than the first loaded message
 * stays in the brain view, and without any times only the latest run shows.
 */
export function brainActivity(
  turnsNewestFirst: readonly BrainTurn[],
  messages: readonly ChatMessage[],
): BrainActivity[] {
  const timed = messages.filter(
    (message): message is ChatMessage & { createdAt: number } =>
      message.createdAt !== undefined,
  );
  const first = timed[0];
  // With nothing to place it by, what's happening now still belongs on screen.
  if (!first) {
    const latest = turnsNewestFirst[0];
    return latest?.calls.length
      ? [{ key: `brain-${latest.id}`, calls: latest.calls }]
      : [];
  }
  const groups: {
    key: string;
    beforeSequence?: number;
    calls: BrainCall[];
  }[] = [];
  for (const turn of turnsNewestFirst.toReversed()) {
    for (const call of turn.calls) {
      if (call.at === undefined || call.at < first.createdAt) continue;
      const before = timed.find((message) => message.createdAt > call.at!);
      const last = groups.at(-1);
      if (last && last.beforeSequence === before?.sequence)
        last.calls.push(call);
      else
        groups.push({
          key: `brain-${call.id}`,
          beforeSequence: before?.sequence,
          calls: [call],
        });
    }
  }
  return groups;
}
