import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  readSessionTranscriptCatalogPage,
  readVisibleSessionTranscriptMessageEntries,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import { registerTimelineHttp } from "./http.ts";
import type { Clock } from "../clock/clock.ts";

vi.mock("openclaw/plugin-sdk/session-transcript-runtime", () => ({
  readSessionTranscriptCatalogPage: vi.fn(),
  readVisibleSessionTranscriptMessageEntries: vi.fn(),
}));

const mockReadSessionTranscript = vi.mocked(readSessionTranscriptCatalogPage);

/*
 * Ledger streams are read as raw message entries (which keep `__openclaw`).
 * Fixtures are written once in catalog shape, with the raw message under
 * `raw`, and served through both readers.
 */
vi.mocked(readVisibleSessionTranscriptMessageEntries).mockImplementation(
  async (opts) => {
    const page = (await mockReadSessionTranscript({
      ...opts,
      limit: 200,
      pluginId: "kazusa",
      sourceDomain: "kazusa",
    })) as {
      items: Array<{
        id?: string;
        text?: string;
        timestamp?: string;
        raw?: { __openclaw?: { kazusa?: unknown } };
      }>;
    };
    return page.items.map((item, seq) => ({
      entryId: item.id ?? String(seq),
      seq,
      role: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: item.text ?? "" }],
        timestamp: item.timestamp ? Date.parse(item.timestamp) : undefined,
        __openclaw: item.raw?.__openclaw,
      },
    }));
  },
);

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
                {
                  sessionKey: "agent:alice:tasks",
                  entry: { sessionId: "s-tasks" },
                },
                {
                  sessionKey: "agent:alice:chat:direct:user:sensei",
                  entry: { sessionId: "s-sensei" },
                },
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
              raw: {
                __openclaw: {
                  kazusa: {
                    kind: "task.delayed",
                    payload: {
                      taskId: "alice:task-1",
                      additionalMinutes: 10,
                      endAt: 1_001_900,
                      reason: "Taking more notes",
                      monologue: "Need to write this down.",
                    },
                  },
                },
              },
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

    // Payloads come from structured metadata, never ledger text
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
              entries: [
                {
                  sessionKey: "agent:alice:tasks",
                  entry: { sessionId: "s-tasks" },
                },
              ],
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

  it("serves Perception's recorded decisions without collapsing them", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      id: "kazusa",
      config: {
        agents: { list: [{ id: "alice" }, { id: "bob" }] },
        session: { store: "/tmp/sessions" },
      },
      runtime: {
        agent: {
          session: {
            resolveStorePath: vi.fn(() => "/tmp/sessions/store"),
            createSessionEntryListReader: vi.fn(async () => async () => ({
              entries: [],
            })),
          },
        },
      },
      registerHttpRoute: vi.fn((opts) => {
        routes[opts.path] = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;

    // Two decisions at one sim time (a paused clock) for the same task.
    const decision = (agentId: string, stimulusIds: string[]) => ({
      agentId,
      record: {
        question: "wake_decision" as const,
        action: "STEER" as const,
        source: "model" as const,
        choice: "WAKE",
        latencyScore: 0.4,
        delayMs: 94_000,
        stimulusIds,
        taskId: "sleep",
        simTime: 500,
        wallTime: 1_000,
      },
    });
    registerTimelineHttp(api, {
      clock: createMockClock(),
      decisions: async () => [
        decision("alice", ["chat-1"]),
        decision("alice", ["chat-2"]),
        decision("bob", ["chat-3"]),
      ],
    });

    let resJson: string | undefined;
    await routes["/kazusa/timeline"]?.(
      { method: "GET", url: "/kazusa/timeline?actors=alice" },
      {
        writeHead: vi.fn(),
        setHeader: vi.fn(),
        end: (data?: string) => {
          resJson = data;
        },
      },
    );

    const parsed = JSON.parse(resJson ?? "{}");
    expect(parsed.events).toHaveLength(2);
    expect(
      parsed.events.map(
        (event: { payload: { stimulusIds: string[] } }) =>
          event.payload.stimulusIds[0],
      ),
    ).toEqual(expect.arrayContaining(["chat-1", "chat-2"]));
    expect(parsed.events[0]).toMatchObject({
      kind: "attention.decided",
      simTime: 500,
      actors: ["alice"],
      payload: { delayMs: 94_000, choice: "WAKE" },
    });
    expect(parsed.events[0].payload).not.toHaveProperty("wallTime");
  });
});
