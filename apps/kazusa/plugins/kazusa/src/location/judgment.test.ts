import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  DecisionBatch,
  DecisionOutcome,
} from "openclaw/plugin-sdk/decisions";
import { describe, expect, it, vi } from "vitest";
import { parseSkillMarkdown } from "../context-engine/skill-loader.ts";
import { LOCATION_CONFIG } from "./config.ts";
import { judge, seededRoll, type JudgeDeps } from "./judgment.ts";

const skill = parseSkillMarkdown(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../shared/skills/location-judgment/SKILL.md",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
);
const config = LOCATION_CONFIG.parse({});

function deps(
  answer: (batch: DecisionBatch) => DecisionOutcome,
): JudgeDeps & { readonly calls: DecisionBatch[] } {
  const calls: DecisionBatch[] = [];
  return {
    calls,
    evaluate: vi.fn(async (batch: DecisionBatch) => {
      calls.push(batch);
      return answer(batch);
    }),
    rubric: async () => skill,
    probabilities: config.likelihood,
    fallback: "unlikely",
    timeoutMs: 1_000,
  };
}

const choice = (word: string): DecisionOutcome => ({
  status: "ok",
  result: {
    model: "jev",
    answers: { notice: { type: "choice", choice: word, probabilities: {} } },
  },
  provenance: { providerId: "jev", rubricVersion: "1", runtimeGeneration: "1" },
});

const params = {
  agentId: "airi",
  question: "notice",
  state: { place: "Rose Courtyard", observer: "airi", other: "kazusa" },
  seed: ["notice", "airi", "kazusa", "school_courtyard", 0],
};

describe("location judgment", () => {
  it("asks one choice question with the likelihood words as criteria", async () => {
    const d = deps(() => choice("likely"));
    const result = await judge(d, params);
    const question = d.calls[0].questions.notice;
    expect(question.type).toBe("choice");
    expect(
      Object.keys(question.type === "choice" ? question.criteria : {}),
    ).toEqual(["certain", "likely", "even", "unlikely", "no chance"]);
    expect(d.evaluate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: "airi",
        purpose: "location.notice",
        rubricVersion: "4",
      }),
    );
    expect(result).toMatchObject({
      word: "likely",
      probability: 0.8,
      source: "model",
      roll: seededRoll(params.seed),
    });
    expect(result.happens).toBe(result.roll < 0.8);
  });

  it("rolls the same for the same moment and certainty always happens", async () => {
    expect(seededRoll(params.seed)).toBe(seededRoll([...params.seed]));
    expect(seededRoll(params.seed)).not.toBe(seededRoll(["notice", "x"]));
    expect(
      (
        await judge(
          deps(() => choice("certain")),
          params,
        )
      ).happens,
    ).toBe(true);
    expect(
      (
        await judge(
          deps(() => choice("no chance")),
          params,
        )
      ).happens,
    ).toBe(false);
  });

  it("falls back to the configured word when the model cannot answer", async () => {
    const unavailable = await judge(
      deps(() => ({ status: "unavailable", reason: "deadline" })),
      params,
    );
    expect(unavailable).toMatchObject({
      word: "unlikely",
      source: "fallback",
      note: "deadline",
    });
    expect(
      await judge(
        deps(() => choice("perhaps")),
        params,
      ),
    ).toMatchObject({ source: "fallback", note: "unusable answer" });
    expect(
      await judge(
        { ...deps(() => choice("likely")), evaluate: undefined },
        params,
      ),
    ).toMatchObject({ source: "fallback", note: "no decision runtime" });
  });
});
