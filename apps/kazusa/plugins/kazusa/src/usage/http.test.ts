import { describe, expect, it } from "vitest";
import { toUsageResponse } from "./http.ts";

const totals = {
  input: 10,
  output: 5,
  cacheRead: 2,
  cacheWrite: 0,
  totalTokens: 17,
  totalCost: 0.5,
  inputCost: 0.25,
  missingCostEntries: 1,
};

const report = (status?: string) => ({
  startDate: "2026-10-01",
  endDate: "2026-11-01",
  totals,
  ...(status ? { cacheStatus: { status } } : {}),
  aggregates: {
    sessionCount: 2,
    messages: { total: 9, user: 4, toolCalls: 3, errors: 1 },
    byAgent: [{ agentId: "miriel", totals }],
    byModel: [{ provider: "zai", model: "glm", count: 3, totals }],
    daily: [
      { date: "2026-11-01", tokens: 17, cost: 0.5, messages: 9, toolCalls: 3 },
    ],
  },
});

describe("toUsageResponse", () => {
  it("keeps what the client shows and drops the rest", () => {
    const usage = toUsageResponse(report("fresh"));
    expect(usage.partial).toBe(false);
    expect(usage.byAgent[0].agentId).toBe("miriel");
    expect(usage.totals).not.toHaveProperty("inputCost");
    expect(usage.daily[0]).toEqual({
      date: "2026-11-01",
      tokens: 17,
      cost: 0.5,
    });
  });

  it("marks totals partial until OpenClaw has read all history", () => {
    expect(toUsageResponse(report("refreshing")).partial).toBe(true);
    expect(toUsageResponse(report()).partial).toBe(false);
  });
});
