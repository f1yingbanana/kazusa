import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { readSessionTranscriptCatalogPage } from "openclaw/plugin-sdk/session-transcript-runtime";
import { registerTimelineHttp } from "./http.ts";
import type { Clock } from "../clock/clock.ts";

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  readSessionTranscriptCatalogPage: vi.fn(),
}));

const mockReadSessionTranscript = vi.mocked(readSessionTranscriptCatalogPage);

function createMockClock(): Clock {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    time: () => 1_000_000,
    now: () => ({ simTime: 1_000_000, speed: 1, updatedAt: Date.now() }),
    setSpeed: vi.fn(),
    advance: vi.fn(),
    onClockChange: vi.fn().mockReturnValue(() => {}),
  } as unknown as Clock;
}

describe("registerTimelineHttp", () => {
  it("registers GET /kazusa/timeline and serves journal events from session transcripts", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};

    const api = {
      id: "kazusa",
      config: {
        agents: {
          list: [{ id: "alice" }],
        },
        session: { store: "/tmp/sessions" },
      },
      runtime: {
        agent: {
          session: {
            resolveStorePath: vi.fn(() => "/tmp/sessions/store"),
            createSessionEntryListReader: vi.fn(async () => async () => ({
              entries: [
                { sessionKey: "agent:alice:tasks" },
                { sessionKey: "agent:alice:chat:direct:user:sensei" },
              ],
            })),
          },
        },
      },
      registerHttpRoute: vi.fn((opts) => {
        routes[opts.path] = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;

    const clock = createMockClock();
    registerTimelineHttp(api, { clock });

    expect(api.registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/kazusa/timeline", match: "exact" }),
    );

    // Mock transcript items for the sessions
    mockReadSessionTranscript.mockImplementation(async (opts) => {
      if (opts.sessionKey === "agent:alice:tasks") {
        return {
          items: [
            {
              id: "msg-1",
              timestamp: new Date(1_000_100).toISOString(),
              text: 'Started study task: "Reading". Scheduled to conclude at 2026-10-21T08:20:00.000Z (20 minutes).\n\n> *Focusing deeply.*',
              raw: {
                __openclaw: {
                  kazusa: {
                    kind: "task.started",
                    payload: {
                      taskId: "alice:task-1",
                      type: "study",
                      description: "Reading",
                      duration: 20,
                      endAt: 1_001_300,
                      monologue: "Focusing deeply.",
                    },
                  },
                },
              },
            },
            {
              id: "msg-2",
              timestamp: new Date(1_000_200).toISOString(),
              text: "Delayed current task by 10 minutes. New completion time: 2026-10-21T08:30:00.000Z. Reason: Taking more notes.\n\n> *Need to write this down.*",
              raw: {}, // Will test narrative parser fallback
            },
          ],
        } as never;
      }
      if (opts.sessionKey.includes("chat:direct:")) {
        return {
          items: [
            {
              id: "chat-msg-1",
              timestamp: new Date(1_000_300).toISOString(),
              text: "Hello Sensei!",
              sender: { identity: { id: "alice" } },
            },
          ],
        } as never;
      }
      return { items: [] };
    });

    let resStatus = 0;
    let resJson: string | undefined;
    const res = {
      writeHead: (s: number) => {
        resStatus = s;
      },
      setHeader: vi.fn(),
      end: (data?: string) => {
        resJson = data;
      },
    };

    await routes["/kazusa/timeline"]?.(
      { method: "GET", url: "/kazusa/timeline" },
      res,
    );

    expect(resStatus).toBe(200);
    const parsed = JSON.parse(resJson ?? "{}");
    expect(parsed.events).toBeDefined();
    expect(parsed.events.length).toBe(3);

    // Newest-first order check
    expect(parsed.events[0].kind).toBe("message.sent");
    expect(parsed.events[1].kind).toBe("task.delayed");
    expect(parsed.events[2].kind).toBe("task.started");

    // Monotonic sequence numbers descending
    expect(parsed.events[0].seq).toBeGreaterThan(parsed.events[1].seq);
    expect(parsed.events[1].seq).toBeGreaterThan(parsed.events[2].seq);

    // Check payload of narrative fallback parsed event
    expect(parsed.events[1].payload.additionalMinutes).toBe(10);
    expect(parsed.events[1].payload.reason).toBe("Taking more notes");
    expect(parsed.events[1].payload.monologue).toBe("Need to write this down.");
  });

  it("filters events by kind and timestamp correctly", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};

    const api = {
      id: "kazusa",
      config: {
        agents: { list: [{ id: "alice" }] },
        session: { store: "/tmp/sessions" },
      },
      runtime: {
        agent: {
          session: {
            resolveStorePath: vi.fn(() => "/tmp/sessions/store"),
            createSessionEntryListReader: vi.fn(async () => async () => ({
              entries: [{ sessionKey: "agent:alice:tasks" }],
            })),
          },
        },
      },
      registerHttpRoute: vi.fn((opts) => {
        routes[opts.path] = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;

    registerTimelineHttp(api, { clock: createMockClock() });

    mockReadSessionTranscript.mockResolvedValue({
      items: [
        {
          id: "msg-1",
          timestamp: new Date(100).toISOString(),
          raw: {
            __openclaw: {
              kazusa: {
                kind: "task.started",
                payload: { taskId: "t1" },
              },
            },
          },
        },
        {
          id: "msg-2",
          timestamp: new Date(200).toISOString(),
          raw: {
            __openclaw: {
              kazusa: {
                kind: "task.delayed",
                payload: { taskId: "t2" },
              },
            },
          },
        },
        {
          id: "msg-3",
          timestamp: new Date(300).toISOString(),
          raw: {
            __openclaw: {
              kazusa: {
                kind: "task.started",
                payload: { taskId: "t3" },
              },
            },
          },
        },
      ],
    } as never);

    let resJson: string | undefined;
    const res = {
      writeHead: vi.fn(),
      setHeader: vi.fn(),
      end: (data?: string) => {
        resJson = data;
      },
    };

    // Filter by kinds=task.started and before=250
    await routes["/kazusa/timeline"]?.(
      {
        method: "GET",
        url: "/kazusa/timeline?kinds=task.started&before=250",
      },
      res,
    );

    const parsed = JSON.parse(resJson ?? "{}");
    expect(parsed.events.length).toBe(1);
    expect(parsed.events[0].payload.taskId).toBe("t1");
  });
});
