import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { Clock } from "../clock/clock.ts";
import { registerTaskman } from "./register.ts";
import type { ActiveTask } from "./types.ts";

const T0 = Date.parse("2026-10-27T16:00:00.000Z");

describe("taskman cron projection", () => {
  it("keeps no wake for an offstage character, and restores it on return", async () => {
    const tasks = new Map<string, ActiveTask>([
      [
        "alice",
        {
          id: "task-1",
          type: "studying",
          description: "Reading",
          duration: 60,
          startedAt: new Date(T0).toISOString(),
          endAt: new Date(T0 + 3_600_000).toISOString(),
        },
      ],
    ]);
    const handlers = new Map<
      string,
      (event: unknown, ctx: unknown) => unknown
    >();
    const api = {
      config: { agents: { entries: { alice: {} } } },
      pluginConfig: {},
      logger: { warn: vi.fn(), info: vi.fn() },
      lifecycle: {},
      on: (name: string, handler: (event: unknown, ctx: unknown) => unknown) =>
        handlers.set(name, handler),
      registerTool: () => {},
      runtime: {
        state: {
          openKeyedStore: () => ({
            lookup: async (key: string) => tasks.get(key),
            register: async (key: string, value: ActiveTask) => {
              tasks.set(key, value);
            },
            entries: async () =>
              [...tasks].map(([key, value]) => ({ key, value, createdAt: 0 })),
          }),
        },
      },
    } as unknown as OpenClawPluginApi;
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });
    const clock = {
      init: async () => {},
      time: () => T0,
      now: () => ({ simTime: T0, speed: 1 }),
      onClockChange: () => () => {},
    } as unknown as Clock;
    const offstage = new Set(["alice"]);
    const taskman = registerTaskman(api, {
      clock,
      stage: {
        isOnstage: async (id) => !offstage.has(id),
        onstage: async (ids) => ids.filter((id) => !offstage.has(id)),
      },
    });
    const jobs = new Map<string, { id: string; declarationKey: string }>();
    const cron = {
      list: async () => [...jobs.values()],
      add: async (job: { declarationKey: string }) => {
        jobs.set(job.declarationKey, { id: job.declarationKey, ...job });
      },
      remove: async (id: string) => {
        jobs.delete(id);
      },
    };

    await handlers.get("cron_reconciled")?.(
      { enabled: true },
      { abortSignal: new AbortController().signal, getCron: () => cron },
    );
    expect([...jobs.keys()]).toEqual([]);

    offstage.delete("alice");
    await taskman.reschedule("alice");
    expect([...jobs.keys()]).toEqual(["alice"]);

    offstage.add("alice");
    await taskman.reschedule("alice");
    expect([...jobs.keys()]).toEqual([]);
  });
});
