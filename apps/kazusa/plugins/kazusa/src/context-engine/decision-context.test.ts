import { z } from "zod";
import { describe, expect, it } from "vitest";
import { CONTEXT_ENGINE_CONFIG } from "./config.ts";
import {
  assembleDecisionBatch,
  assembleDecisionContext,
  buildDecisionQuestions,
  parsePerceptionSkill,
  quietConversationOf,
  textTokens,
  truncateText,
} from "./decision-context.ts";
import type { Stimulus } from "../stimulus.ts";
import { parseSkillMarkdown } from "./skill-loader.ts";

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

  it("gives timing evidence: activity progress and where each conversation stands", () => {
    const result = assemble({
      activeTask: {
        id: "task",
        type: "studying",
        description: "Exam revision",
        duration: 120,
        startedAt: new Date(NOW - 90 * 60_000).toISOString(),
        endAt: new Date(NOW + 30 * 60_000).toISOString(),
      },
      chats: [
        {
          sessionKey: "agent:alice:chat:group:club",
          kind: "group",
          title: "Club",
          memberCount: 100,
          lastSpokeAt: NOW - 3 * 60_000,
          unanswered: 4,
          waitingSince: NOW - 2 * 60_000,
        },
        {
          sessionKey: "agent:alice:chat:direct:bob",
          kind: "direct",
          title: null,
          memberCount: 2,
          lastSpokeAt: null,
          unanswered: 1,
          waitingSince: NOW,
        },
      ],
    });
    expect(result).toMatchObject({
      currentActivity: { elapsedMinutes: 90, remainingMinutes: 30 },
      conversations: [
        {
          channel: "chat:group:club",
          kind: "group",
          title: "Club",
          members: 100,
          youLastSpokeMinutesAgo: 3,
          unansweredMessages: 4,
          waitingMinutes: 2,
        },
        {
          channel: "chat:direct:bob",
          kind: "direct",
          title: null,
          members: 2,
          youLastSpokeMinutesAgo: null,
          unansweredMessages: 1,
          waitingMinutes: 0,
        },
      ],
    });
  });

  it("shows what the character is still in the middle of saying", () => {
    expect(assemble()).toMatchObject({ currentSpeech: null });
    expect(
      assemble({
        brainStatus: "busy_thinking",
        currentSpeech: {
          sessionKey: "agent:alice:chat:direct:bob",
          said: ["Wait..."],
          unsaid: ["I told you not to go there!"],
        },
      }),
    ).toMatchObject({
      currentSpeech: {
        chat: "chat:direct:bob",
        said: ["Wait..."],
        unsaid: ["I told you not to go there!"],
      },
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

  it("parses the shipped perception rubric", async () => {
    const { readFile } = await import("node:fs/promises");
    const rubric = parsePerceptionSkill(
      await readFile(
        new URL(
          "../../../../shared/skills/perception/SKILL.md",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(Object.keys(buildDecisionQuestions("idle", rubric))).toEqual([
      "wake_decision",
      "response_latency",
    ]);
    expect(Object.keys(buildDecisionQuestions("idle", rubric, true))).toEqual([
      "wake_decision",
    ]);
    expect(rubric.instructions).toContain("currentSpeech.unsaid is a plan");
    expect(assemble({ queuedReview: true })).toMatchObject({
      queuedReview: true,
    });
    expect(Object.keys(rubric.questions.wake_decision.criteria)).toEqual([
      "WAKE",
      "DEFER",
      "IGNORE",
    ]);
    expect(Object.keys(rubric.questions.attention_allocation.criteria)).toEqual(
      ["STEER", "QUEUE_NEXT", "DEFER", "IGNORE"],
    );
    // How they say it is asked on its own: pace always, the floor if taken.
    const speech = {
      sessionKey: "agent:alice:chat:huddle:club",
      medium: "speaking" as const,
    };
    expect(
      buildDecisionQuestions("busy_thinking", rubric, false, {
        ...speech,
        floor: { speaking: ["bob"], waiting: 0 },
      }),
    ).toEqual({
      pace: {
        type: "score",
        instructions: expect.stringContaining(
          "How fast do they type or say it?",
        ),
        criteria: expect.arrayContaining([
          { pace: 1, description: "Ordinary conversational pace." },
        ]),
      },
      floor: {
        type: "choice",
        instructions: expect.stringContaining("How badly do they want in?"),
        criteria: {
          CUT_IN: expect.any(String),
          NEXT: expect.any(String),
          WAIT: expect.any(String),
        },
      },
    });
    expect(
      Object.keys(
        buildDecisionQuestions("busy_thinking", rubric, false, speech),
      ),
    ).toEqual(["pace"]);
  });

  it("keeps every world's own rubric at the shipped version, with every question", async () => {
    // Worlds without phones reword the rubric, which copies all of it; a copy
    // left at version 7 never asked about the floor, pace or tuning out.
    const { readFile, readdir } = await import("node:fs/promises");
    const read = (path: string) =>
      readFile(new URL(path, import.meta.url), "utf8");
    const version = (text: string) =>
      (
        parseSkillMarkdown(text).frontmatter?.metadata as {
          rubricVersion?: string;
        }
      )?.rubricVersion;
    const shipped = await read("../../../../shared/skills/perception/SKILL.md");
    const questions = Object.keys(parsePerceptionSkill(shipped).questions);
    const worlds = await readdir(
      new URL("../../../../worlds/", import.meta.url),
      {
        withFileTypes: true,
      },
    );
    const rubrics: Record<string, { version?: string; questions: string[] }> =
      {};
    for (const world of worlds) {
      if (!world.isDirectory()) continue;
      const own = await read(
        `../../../../worlds/${world.name}/shared/skills/perception/SKILL.md`,
      ).catch(() => undefined);
      if (own)
        rubrics[world.name] = {
          version: version(own),
          questions: Object.keys(parsePerceptionSkill(own).questions),
        };
    }
    expect(Object.keys(rubrics).length).toBeGreaterThan(0);
    // Keyed by world, so a failure names the one left behind.
    expect(rubrics).toEqual(
      Object.fromEntries(
        Object.keys(rubrics).map((name) => [
          name,
          { version: version(shipped), questions },
        ]),
      ),
    );
  });

  it("asks someone quiet in a conversation of three or more whether they still follow it", async () => {
    const { readFile } = await import("node:fs/promises");
    const rubric = await readFile(
      new URL("../../../../shared/skills/perception/SKILL.md", import.meta.url),
      "utf8",
    );
    const line: Stimulus = {
      id: "lunch-1",
      sender: "bob",
      sessionKey: "agent:alice:chat:huddle:lunch",
      timestamp: NOW,
      text: "Anyway, the vending machine ate my coins again.",
    };
    const lunch = {
      sessionKey: "agent:alice:chat:huddle:lunch",
      kind: "huddle" as const,
      title: "Talking at the cafeteria",
      memberCount: 5,
      lastSpokeAt: NOW - 12 * 60_000,
      unanswered: 9,
      waitingSince: NOW - 11 * 60_000,
    };
    const batch = (
      overrides: Partial<Parameters<typeof assembleDecisionBatch>[0]> = {},
    ) =>
      assembleDecisionBatch({
        agentId: "alice",
        simTime: NOW,
        brainStatus: "idle",
        incomingBundle: [line],
        pendingQueue: [],
        sessionsContext: {},
        chats: [lunch],
        rubric,
        ...overrides,
      });
    const asked = batch();
    expect(asked.questions.still_following).toMatchObject({
      type: "choice",
      instructions: expect.stringContaining("Are they still following it?"),
      criteria: {
        FOLLOWING: expect.any(String),
        TUNED_OUT: expect.any(String),
      },
    });
    expect(asked.state).toMatchObject({
      quietIn: { conversation: "chat:huddle:lunch", quietMinutes: 12 },
    });
    expect(quietConversationOf(asked)).toBe("chat:huddle:lunch");
    // Never spoke there: counted from the first line they heard.
    expect(
      batch({ chats: [{ ...lunch, lastSpokeAt: null }] }).state,
    ).toMatchObject({ quietIn: { quietMinutes: 11 } });

    const notAsked = [
      // Spoke a moment ago.
      batch({ chats: [{ ...lunch, lastSpokeAt: NOW - 3 * 60_000 }] }),
      // Just came back to it: silence counts from rejoining.
      batch({ chats: [{ ...lunch, joinedAt: NOW - 2 * 60_000 }] }),
      // A pair can't drift: the other is talking to you.
      batch({ chats: [{ ...lunch, memberCount: 2 }] }),
      // A group text isn't a conversation in person.
      batch({ chats: [{ ...lunch, kind: "group" }] }),
      // Nothing of it in what they are hearing now.
      batch({ incomingBundle: [message] }),
      // About to speak, not hearing.
      batch({ speech: { sessionKey: lunch.sessionKey, medium: "speaking" } }),
      // Thinking: maybe answering that very conversation, or waiting to speak.
      batch({ brainStatus: "busy_thinking" }),
      // The setting allows longer silences.
      batch({
        config: CONTEXT_ENGINE_CONFIG.parse({ decisionQuietMinutes: 20 }),
      }),
    ];
    for (const result of notAsked) {
      expect(result.questions.still_following).toBeUndefined();
      expect(result.state).not.toHaveProperty("quietIn");
      expect(quietConversationOf(result)).toBeUndefined();
    }
    // A world's older rubric without the question never asks.
    const older = parsePerceptionSkill(rubric);
    const { still_following: _following, ...questions } = older.questions;
    expect(
      batch({ rubric: { ...older, questions } }).questions.still_following,
    ).toBeUndefined();
  });

  it("shows who has the floor, and refuses to judge speech without a rubric for it", () => {
    expect(
      assemble({
        brainStatus: "busy_thinking",
        incomingBundle: [],
        speech: {
          sessionKey: "agent:alice:chat:huddle:club",
          medium: "speaking",
          floor: { speaking: ["bob"], turn: "bob", waiting: 1 },
        },
      }),
    ).toMatchObject({
      speech: {
        conversation: expect.stringContaining("huddle"),
        floor: {
          speakingNow: ["bob"],
          whoseTurn: "bob",
          othersWaitingToSpeak: 1,
        },
      },
    });
    expect(assemble()).toMatchObject({ speech: null });
    const older = parsePerceptionSkill(`---
rubric:
  instructions: Judge.
  questions:
    wake_decision:
      criteria: { WAKE: Now. }
    attention_allocation:
      criteria: { STEER: Now. }
    response_latency:
      criteria:
        - { minutes: 0, description: Now. }
        - { minutes: 5, description: Soon. }
---
`);
    expect(() =>
      buildDecisionQuestions("busy_thinking", older, false, {
        sessionKey: "agent:alice:chat:huddle:club",
        medium: "speaking",
      }),
    ).toThrow("no speech questions");
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
    response_latency:
      description: "How soon would they reply?"
      criteria:
        - minutes: 0
          description: "Now."
        - minutes: 30
          description: "Later."
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

    expect(idleQuestions.response_latency).toEqual({
      type: "score",
      instructions: expect.stringContaining("How soon would they reply?"),
      criteria: [
        { minutes: 0, description: "Now." },
        { minutes: 30, description: "Later." },
      ],
    });

    const busyQuestions = buildDecisionQuestions("busy_thinking", rubric);
    expect(busyQuestions).not.toHaveProperty("response_latency");
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
