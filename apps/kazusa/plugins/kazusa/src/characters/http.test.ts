import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerCharactersHttp } from "./http.ts";
import { KazusaRealtimeBroadcaster } from "../realtime.ts";

describe("registerCharactersHttp", () => {
  it("registers GET /kazusa/characters and GET /kazusa/character routes", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      config: {
        agents: { entries: { kazusa: { workspace: "./workspaces/kazusa" } } },
      },
      pluginConfig: {
        user: { id: "user:sensei", name: "Sensei" },
      },
      runtime: {
        agent: {
          resolveAgentIdentity: vi.fn(() => ({ name: "Kazusa" })),
          resolveAgentWorkspaceDir: vi.fn(() => "/tmp/workspace-kazusa"),
        },
      },
      registerHttpRoute: vi.fn((opts) => {
        routes[opts.path] = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;

    const taskman = {
      store: { lookup: vi.fn(async () => undefined) },
      onTaskChange: vi.fn(() => () => {}),
    };
    const perception = {
      getBrainState: vi.fn(async () => ({ brain: "idle" as const, queued: 0 })),
      onBrainStateChange: vi.fn(() => () => {}),
    };
    const messaging = {
      getComposingChats: vi.fn(() => []),
      onEvent: vi.fn(() => () => {}),
    };
    const broadcaster = new KazusaRealtimeBroadcaster();

    registerCharactersHttp(api, {
      taskman: taskman as never,
      perception: perception as never,
      messaging: messaging as never,
      broadcaster,
    });

    expect(api.registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/kazusa/characters", match: "exact" }),
    );
    expect(api.registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/kazusa/character", match: "exact" }),
    );

    // Test GET /kazusa/characters
    let charactersStatus = 0;
    let charactersJson: string | undefined;
    const charactersRes = {
      writeHead: (s: number) => {
        charactersStatus = s;
      },
      setHeader: vi.fn(),
      end: (data?: string) => {
        charactersJson = data;
      },
    };

    await routes["/kazusa/characters"]?.(
      { method: "GET", url: "/kazusa/characters" },
      charactersRes,
    );
    expect(charactersStatus).toBe(200);
    const parsed = JSON.parse(charactersJson ?? "{}");
    expect(
      parsed.characters.some((c: { kind: string }) => c.kind === "player"),
    ).toBe(true);
    expect(
      parsed.characters.some((c: { id: string }) => c.id === "kazusa"),
    ).toBe(true);
  });
});
