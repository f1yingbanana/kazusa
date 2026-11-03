import type { UsageResponse } from "@kazusa/client";
import { KeyedAsyncQueue } from "openclaw/plugin-sdk/core";
import type { StateStore } from "../state.ts";
import type { JevUsage } from "./jev.ts";

/**
 * What decision calls cost, per UTC day, agent and route. OpenClaw's usage
 * report reads session transcripts, and a decision runs in no session, so Jev
 * is counted here and added to that report (`usage/http.ts`).
 */
export interface DecisionUsageBucket {
  /** UTC, as `sessions.usage` buckets its days by default. */
  readonly date: string;
  /** Absent for calls owned by no character. */
  readonly agentId?: string;
  readonly provider: string;
  readonly model: string;
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  /** US dollars, over the calls with a known price. */
  readonly cost: number;
  /** Calls whose provider reported no price. */
  readonly unpriced: number;
}

export interface DecisionUsageLedger {
  /** Never throws: failing to count must not fail a decision. */
  readonly record: (usage: JevUsage) => void;
  /** Buckets from `start` through `end`, inclusive (`YYYY-MM-DD`). */
  readonly between: (
    start: string,
    end: string,
  ) => Promise<DecisionUsageBucket[]>;
}

// Registrations share the retained store, so their read-modify-writes too.
const QUEUE = Symbol.for("kazusa.decisions.usage.serial");
function sharedQueue(): KeyedAsyncQueue {
  const scope = globalThis as { [QUEUE]?: KeyedAsyncQueue };
  return (scope[QUEUE] ??= new KeyedAsyncQueue());
}

export function createDecisionUsage(
  store: StateStore<DecisionUsageBucket>,
  warn: (error: unknown) => void,
  now: () => number = Date.now,
): DecisionUsageLedger {
  return {
    record: (usage) => {
      const date = new Date(now()).toISOString().slice(0, 10);
      const { provider, model } = usage.route;
      const key = [date, usage.agentId ?? "", `${provider}/${model}`].join("|");
      sharedQueue()
        .enqueue(key, async () => {
          const before = await store.lookup(key);
          await store.register(key, {
            date,
            ...(usage.agentId ? { agentId: usage.agentId } : {}),
            provider,
            model,
            calls: (before?.calls ?? 0) + 1,
            input: (before?.input ?? 0) + usage.inputTokens,
            output: (before?.output ?? 0) + usage.outputTokens,
            cost: (before?.cost ?? 0) + (usage.cost ?? 0),
            unpriced:
              (before?.unpriced ?? 0) + (usage.cost === undefined ? 1 : 0),
          });
        })
        .catch(warn);
    },
    between: async (start, end) =>
      (await store.entries())
        .map(({ value }) => value)
        .filter((bucket) => bucket.date >= start && bucket.date <= end),
  };
}

type Totals = UsageResponse["totals"];

function plus(totals: Totals, bucket: DecisionUsageBucket): Totals {
  return {
    ...totals,
    input: totals.input + bucket.input,
    output: totals.output + bucket.output,
    totalTokens: totals.totalTokens + bucket.input + bucket.output,
    totalCost: totals.totalCost + bucket.cost,
    missingCostEntries: totals.missingCostEntries + bucket.unpriced,
  };
}

const NOTHING: Totals = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  totalCost: 0,
  missingCostEntries: 0,
};

/** OpenClaw's session report with decision calls added in. */
export function withDecisionUsage(
  report: UsageResponse,
  buckets: readonly DecisionUsageBucket[],
): UsageResponse {
  let { totals } = report;
  const byAgent = report.byAgent.map((entry) => ({ ...entry }));
  const byModel = report.byModel.map((entry) => ({ ...entry }));
  const daily = report.daily.map((entry) => ({ ...entry }));
  for (const bucket of buckets) {
    totals = plus(totals, bucket);
    if (bucket.agentId) {
      const agent = byAgent.find((entry) => entry.agentId === bucket.agentId);
      if (agent) agent.totals = plus(agent.totals, bucket);
      else
        byAgent.push({
          agentId: bucket.agentId,
          totals: plus(NOTHING, bucket),
        });
    }
    const model = byModel.find(
      (entry) =>
        entry.provider === bucket.provider && entry.model === bucket.model,
    );
    if (model) {
      model.count += bucket.calls;
      model.totals = plus(model.totals, bucket);
    } else
      byModel.push({
        provider: bucket.provider,
        model: bucket.model,
        count: bucket.calls,
        totals: plus(NOTHING, bucket),
      });
    const day = daily.find((entry) => entry.date === bucket.date);
    if (day) {
      day.tokens += bucket.input + bucket.output;
      day.cost += bucket.cost;
    } else
      daily.push({
        date: bucket.date,
        tokens: bucket.input + bucket.output,
        cost: bucket.cost,
      });
  }
  return {
    ...report,
    totals,
    byAgent,
    byModel,
    daily: daily.sort((a, b) => a.date.localeCompare(b.date)),
  };
}
