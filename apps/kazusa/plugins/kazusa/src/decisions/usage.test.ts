import { describe, expect, it, vi } from "vitest";
import type { UsageResponse } from "@kazusa/client";
import { JEV_ROUTES } from "./jev.ts";
import {
  createDecisionUsage,
  withDecisionUsage,
  type DecisionUsageBucket,
} from "./usage.ts";

function memoryStore() {
  const rows = new Map<string, DecisionUsageBucket>();
  return {
    rows,
    lookup: async (key: string) => rows.get(key),
    register: async (key: string, value: DecisionUsageBucket) => {
      rows.set(key, value);
    },
    entries: async () =>
      [...rows].map(([key, value]) => ({ key, value, createdAt: 0 })),
  };
}

const route = JEV_ROUTES[0];
const totals = (input: number, output: number, cost: number) => ({
  input,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: input + output,
  totalCost: cost,
  missingCostEntries: 0,
});

describe("decision usage", () => {
  it("adds up each day's calls per character and route, priced or not", async () => {
    const store = memoryStore();
    const usage = createDecisionUsage(store, vi.fn(), () =>
      Date.parse("2026-11-02T23:00:00Z"),
    );
    usage.record({
      agentId: "noa",
      route,
      inputTokens: 300,
      outputTokens: 20,
      cost: 0.0001,
    });
    usage.record({ agentId: "noa", route, inputTokens: 200, outputTokens: 10 });
    usage.record({ route, inputTokens: 50, outputTokens: 5, cost: 0.00002 });
    await vi.waitFor(async () =>
      expect(await usage.between("2026-11-02", "2026-11-02")).toHaveLength(2),
    );
    expect(store.rows.get("2026-11-02|noa|openrouter/jev-latest")).toEqual({
      date: "2026-11-02",
      agentId: "noa",
      provider: "openrouter",
      model: "jev-latest",
      calls: 2,
      input: 500,
      output: 30,
      cost: 0.0001,
      unpriced: 1,
    });
    expect(await usage.between("2026-11-03", "2026-11-04")).toEqual([]);
  });

  it("adds decisions into OpenClaw's session report", () => {
    const report: UsageResponse = {
      startDate: "2026-11-01",
      endDate: "2026-11-02",
      totals: totals(1000, 100, 0.5),
      sessionCount: 3,
      messages: { total: 10, toolCalls: 4, errors: 0 },
      byAgent: [{ agentId: "noa", totals: totals(1000, 100, 0.5) }],
      byModel: [
        {
          provider: "venice",
          model: "mimo-flash",
          count: 10,
          totals: totals(1000, 100, 0.5),
        },
      ],
      daily: [{ date: "2026-11-02", tokens: 1100, cost: 0.5 }],
      partial: false,
    };
    const bucket = (
      date: string,
      agentId: string | undefined,
    ): DecisionUsageBucket => ({
      date,
      ...(agentId ? { agentId } : {}),
      provider: "openrouter",
      model: "jev-latest",
      calls: 2,
      input: 400,
      output: 40,
      cost: 0.01,
      unpriced: 1,
    });
    const merged = withDecisionUsage(report, [
      bucket("2026-11-02", "noa"),
      bucket("2026-11-01", "airi"),
      bucket("2026-11-02", undefined),
    ]);
    expect(merged.totals).toMatchObject({
      input: 2200,
      output: 220,
      totalTokens: 2420,
      totalCost: 0.53,
      missingCostEntries: 3,
    });
    expect(merged.byAgent).toEqual([
      {
        agentId: "noa",
        totals: { ...totals(1400, 140, 0.51), missingCostEntries: 1 },
      },
      {
        agentId: "airi",
        totals: { ...totals(400, 40, 0.01), missingCostEntries: 1 },
      },
    ]);
    expect(merged.byModel[1]).toMatchObject({
      provider: "openrouter",
      model: "jev-latest",
      count: 6,
    });
    expect(merged.daily).toEqual([
      { date: "2026-11-01", tokens: 440, cost: 0.01 },
      { date: "2026-11-02", tokens: 1980, cost: 0.52 },
    ]);
    expect(report.byAgent).toHaveLength(1);
  });
});
