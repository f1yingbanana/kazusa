import { z } from "zod";
import { describe, expect, it } from "vitest";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";
import {
  assembleDecisionBatch,
  assembleDecisionContext,
  buildDecisionQuestions,
  parsePerceptionSkill,
  textTokens,
  truncateText,
} from "./decision-context.ts";
import type { Stimulus } from "../stimulus.ts";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const message: Stimulus = {
  id: "1",
  sender: "bob",
  sessionKey: "agent:alice:chat:direct:bob",
  timestamp: NOW,
  text: "Help with the exam?",
};

function assemble(
  overrides: Partial<Parameters<typeof assembleDecisionContext>[0]> = {},
) {
  return assembleDecisionContext({
    agentId: "alice",
    simTime: NOW,
    brainStatus: "idle",
    incomingBundle: [message],
    pendingQueue: [],
    sessionsContext: {},
    ...overrides,
  });
}

describe("Bounded decision evidence", () => {
  it("preserves all three character sources with independent allowances", () => {
    const config = CONTEXT_ENGINE_CONFIG.parse({
      decisionIdentityMaxTokens: 100,
      decisionSoulMaxTokens: 200,
      decisionMemoryMaxTokens: 150,
    });
    const result = assemble({
      config,
      characterFiles: {
        identity: "Identity ".repeat(3000),
        soul: "Protect Bob ".repeat(3000),
        memory: "Promise ".repeat(3000),
      },
    });
    expect(result).toMatchObject({
      character: {
        identity: expect.stringContaining("Identity"),
        soul: expect.stringContaining("Protect Bob"),
        memory: expect.stringContaining("Promise"),
      },
    });
    const { character } = z
      .object({ character: z.record(z.string(), z.string()) })
      .parse(result);
    for (const [key, limit] of Object.entries({
      identity: 100,
      soul: 200,
      memory: 150,
    })) {
      expect(textTokens(String(character[key]))).toBeLessThanOrEqual(limit);
    }
  });

  it("bounds the entire serialized state with maximum-sized incoming messages and a long queue", () => {
    const result = assemble({
      incomingBundle: Array.from({ length: 16 }, (_, i) => ({
        ...message,
        id: String(i),
        text: "火".repeat(32_000),
      })),
      pendingQueue: Array.from({ length: 1000 }, (_, i) => ({
        ...message,
        id: `queued-${i}`,
        text: "queued ".repeat(4000),
      })),
      characterFiles: {
        identity: "I".repeat(32000),
        soul: "S".repeat(32000),
        memory: "M".repeat(32000),
      },
      wiki: ["article ".repeat(10000)],
    });
    expect(textTokens(JSON.stringify(result))).toBeLessThanOrEqual(8000 - 512);
    expect(result).toMatchObject({ incomingBundle: expect.any(Array) });
  });

  it("keeps unknown activity unknown and exposes current input only while thinking", () => {
    expect(assemble()).toMatchObject({
      currentActivity: null,
      currentAttention: null,
    });
    expect(
      assemble({
        brainStatus: "busy_thinking",
        brainContext: "Responding to Bob about tomorrow's exam",
      }),
    ).toMatchObject({
      currentAttention: "Responding to Bob about tomorrow's exam",
    });
    expect(assemble({ brainContext: "Old thought" })).toMatchObject({
      currentAttention: null,
    });
  });

  it("keeps overdue timing and drops opaque stimulus IDs from model evidence", () => {
    const result = assemble({
      activeTask: {
        id: "task-id",
        type: "studying",
        description: "Physics",
        duration: 60,
        startedAt: new Date(NOW - 3_600_000).toISOString(),
        endAt: new Date(NOW - 120_000).toISOString(),
      },
    });
    expect(result).toMatchObject({
      currentActivity: { remainingMinutes: -2 },
      incomingBundle: [{ sender: "bob", text: message.text }],
    });
    expect(JSON.stringify(result)).not.toContain('"id":"1"');
    expect(JSON.stringify(result)).not.toContain("task-id");
  });

  it("does not duplicate a source message already included in incoming evidence", () => {
    const result = assemble({
      sessionsContext: {
        [message.sessionKey]: [
          {
            type: "userMessage",
            text: message.text,
            timestamp: new Date(NOW).toISOString(),
            sender: {
              identity: {
                id: "bob",
                type: "observation",
                pluginId: "kazusa",
                accountId: null,
                senderKind: "bot",
              },
              label: "Bob",
            },
          },
        ],
      },
    });
    expect(result).toMatchObject({ recentChannelContext: [] });
  });

  it("counts clipping markers and handles tiny and non-Latin budgets", () => {
    for (const budget of [0, 1, 10, 100, 1000]) {
      for (const text of ["A".repeat(10000), "🙂日本語".repeat(1000)]) {
        const clipped = truncateText(text, budget);
        expect(textTokens(clipped)).toBeLessThanOrEqual(budget);
        expect(clipped.isWellFormed()).toBe(true);
      }
    }
  });

  it("parses prompt instructions and criteria dynamically from perception skill YAML frontmatter", () => {
    const rawMarkdown = `---
name: perception
description: "Classifier prompt"
rubric:
  instructions: |
    Judge attention strictly from this character's identity and values.
    Do not optimize for a helpful assistant.
  questions:
    wake_decision:
      description: "Should the character start a new thought or turn?"
      criteria:
        WAKE: "Devote a new thought to the evidence."
        IGNORE: "Continue current activity."
    attention_allocation:
      description: "How should the character allocate attention while actively thinking?"
      criteria:
        STEER: "Interrupt current thought immediately."
        QUEUE_NEXT: "Attend after current thought finishes."
        IGNORE: "Discard this evidence."
---

# Perception Attention Gate Rubrics
`;

    const rubric = parsePerceptionSkill(rawMarkdown);
    expect(rubric.instructions).toContain("Judge attention strictly");
    expect(rubric.questions.wake_decision.description).toContain(
      "Should the character start a new thought",
    );
    expect(rubric.questions.wake_decision.criteria).toEqual({
      WAKE: "Devote a new thought to the evidence.",
      IGNORE: "Continue current activity.",
    });
    expect(rubric.questions.attention_allocation.description).toContain(
      "allocate attention while actively thinking",
    );
    expect(rubric.questions.attention_allocation.criteria).toEqual({
      STEER: "Interrupt current thought immediately.",
      QUEUE_NEXT: "Attend after current thought finishes.",
      IGNORE: "Discard this evidence.",
    });

    const idleQuestions = buildDecisionQuestions("idle", rubric);
    expect(idleQuestions).toHaveProperty("wake_decision");
    expect(idleQuestions.wake_decision).toMatchObject({
      type: "choice",
      instructions: expect.stringContaining("Judge attention strictly"),
      criteria: {
        WAKE: "Devote a new thought to the evidence.",
        IGNORE: "Continue current activity.",
      },
    });

    const busyQuestions = buildDecisionQuestions("busy_thinking", rubric);
    expect(busyQuestions).toHaveProperty("attention_allocation");
    expect(busyQuestions.attention_allocation).toMatchObject({
      type: "choice",
      instructions: expect.stringContaining("Judge attention strictly"),
      criteria: {
        STEER: "Interrupt current thought immediately.",
        QUEUE_NEXT: "Attend after current thought finishes.",
        IGNORE: "Discard this evidence.",
      },
    });

    const batch = assembleDecisionBatch({
      agentId: "alice",
      simTime: NOW,
      brainStatus: "busy_thinking",
      incomingBundle: [message],
      pendingQueue: [],
      sessionsContext: {},
      rubric,
    });
    expect(batch.state).toBeDefined();
    expect(batch.questions).toHaveProperty("attention_allocation");
  });

  it("throws Zod validation error when perception skill is missing rubric or required fields", () => {
    expect(() => parsePerceptionSkill("# Incomplete")).toThrow();
    expect(() =>
      parsePerceptionSkill(`---
name: perception
rubric:
  instructions: "Test"
  questions: {}
---
`),
    ).toThrow();
  });
});
