import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { registerCharactersHttp } from "./http.ts";
import { KazusaRealtimeBroadcaster } from "../realtime.ts";
import {
  CharactersResponseSchema,
  CharacterDetailResponseSchema,
} from "@kazusa/client";

describe("registerCharactersHttp", () => {
  it("registers GET /kazusa/characters and GET /kazusa/character routes", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      config: {
        agents: {
          defaults: { systemAgent: { agentId: "kazusa" } },
          entries: { kazusa: { workspace: "./workspaces/kazusa" } },
        },
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
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });

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

    let current = api.config;
    Object.assign(api.runtime, { config: { current: () => current } });
    registerCharactersHttp(api, {
      taskman: taskman as never,
      perception: perception as never,
      messaging: messaging as never,
      broadcaster,
      stage: {
        isOnstage: vi.fn(async () => true),
        lookup: vi.fn(async () => undefined),
      },
      setOnstage: vi.fn(async () => {}),
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
      CharactersResponseSchema.parse(parsed).characters.find(
        (c) => c.id === "kazusa",
      )?.isSystemAgent,
    ).toBe(true);
    expect(
      CharactersResponseSchema.parse(parsed).characters.find(
        (c) => c.kind === "player",
      )?.isSystemAgent,
    ).toBeUndefined();
    expect(
      parsed.characters.some((c: { kind: string }) => c.kind === "player"),
    ).toBe(true);
    expect(
      parsed.characters.some((c: { id: string }) => c.id === "kazusa"),
    ).toBe(true);

    // Native roster updates replace the runtime snapshot; the registered API
    // object still carries its original configuration.
    const updated = {
      agents: {
        defaults: { systemAgent: { agentId: "arona" } },
        entries: { arona: { workspace: "/tmp/new-arona-workspace" } },
      },
    };
    current = updated;
    await routes["/kazusa/characters"]?.(
      { method: "GET", url: "/kazusa/characters" },
      charactersRes,
    );
    expect(
      JSON.parse(charactersJson ?? "{}").characters.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual(["arona", "user:sensei"]);
    await routes["/kazusa/character"]?.(
      { method: "GET", url: "/kazusa/character?id=arona" },
      charactersRes,
    );
    expect(charactersStatus).toBe(200);
    expect(JSON.parse(charactersJson ?? "{}").character.id).toBe("arona");
    expect(
      CharacterDetailResponseSchema.parse(JSON.parse(charactersJson ?? "{}"))
        .character.isSystemAgent,
    ).toBe(true);
    expect(api.runtime.agent.resolveAgentWorkspaceDir).toHaveBeenCalledWith(
      updated,
      "arona",
    );
    current = { agents: { entries: updated.agents.entries } };
    await routes["/kazusa/characters"]?.(
      { method: "GET", url: "/kazusa/characters" },
      charactersRes,
    );
    expect(
      CharactersResponseSchema.parse(
        JSON.parse(charactersJson ?? "{}"),
      ).characters.find((c) => c.id === "arona")?.isSystemAgent,
    ).toBe(false);
    await routes["/kazusa/character"]?.(
      { method: "GET", url: "/kazusa/character?id=kazusa" },
      charactersRes,
    );
    expect(charactersStatus).toBe(404);
  });

  it("sends a character offstage through POST /kazusa/character/stage", async () => {
    const routes = new Map<
      string,
      (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
    >();
    const api = {
      config: { agents: { entries: { kazusa: {} } } },
      pluginConfig: {},
      registerHttpRoute: vi.fn((opts) => routes.set(opts.path, opts.handler)),
    } as unknown as OpenClawPluginApi;
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });
    const onstage = new Map<string, boolean>();
    const setOnstage = vi.fn(async (id: string, value: boolean) => {
      onstage.set(id, value);
    });
    const broadcaster = new KazusaRealtimeBroadcaster();
    const pushed: unknown[] = [];
    broadcaster.subscribe((event) => pushed.push(event));
    registerCharactersHttp(api, {
      taskman: {
        store: { lookup: vi.fn(async () => undefined) },
        onTaskChange: vi.fn(() => () => {}),
      } as never,
      perception: {
        getBrainState: vi.fn(async () => ({ brain: "idle", queued: 2 })),
        onBrainStateChange: vi.fn(() => () => {}),
      } as never,
      messaging: {
        getComposingChats: vi.fn(() => []),
        onEvent: vi.fn(() => () => {}),
      } as never,
      broadcaster,
      stage: {
        isOnstage: async (id) => onstage.get(id) ?? true,
        lookup: async (id) =>
          onstage.has(id) ? { onstage: onstage.get(id)!, since: 7 } : undefined,
      },
      setOnstage,
    });

    const post = async (body: unknown) => {
      const req = Object.assign(
        Readable.from([Buffer.from(JSON.stringify(body))]),
        {
          method: "POST",
          url: "/kazusa/character/stage",
          headers: {},
          socket: new Socket(),
        },
      );
      const res = {
        statusCode: 0,
        body: "",
        writeHead(status: number) {
          this.statusCode = status;
        },
        setHeader: vi.fn(),
        end(data: string) {
          this.body = data;
        },
      };
      await routes.get("/kazusa/character/stage")!(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      );
      return { status: res.statusCode, json: JSON.parse(res.body) };
    };

    const sent = await post({ ids: ["kazusa", "kazusa"], onstage: false });
    expect(setOnstage).toHaveBeenCalledWith("kazusa", false);
    expect(sent).toMatchObject({
      status: 200,
      json: {
        statuses: { kazusa: { onstage: false, queued: 2, offstageSince: 7 } },
      },
    });
    expect(pushed).toContainEqual(
      expect.objectContaining({
        type: "status",
        characterId: "kazusa",
        status: expect.objectContaining({ onstage: false }),
      }),
    );
    expect(
      (await post({ ids: ["kazusa", "nobody"], onstage: true })).status,
    ).toBe(404);
    expect(setOnstage).toHaveBeenCalledTimes(1);
  });
});
