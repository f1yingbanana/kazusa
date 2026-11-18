import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { loadCharacterData, registerCharactersHttp } from "./http.ts";
import { KazusaRealtimeBroadcaster } from "../realtime.ts";
import {
  CharactersResponseSchema,
  CharacterDetailResponseSchema,
} from "@kazusa/client";

describe("loadCharacterData", () => {
  it("gives the default portrait's URL beside the avatar, when there is one", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "kazusa-character-"));
    const api = {
      config: {},
      runtime: {
        agent: {
          resolveAgentIdentity: vi.fn(() => undefined),
          resolveAgentWorkspaceDir: vi.fn(() => workspace),
        },
      },
    } as unknown as OpenClawPluginApi;
    expect(await loadCharacterData(api, "aris")).not.toHaveProperty(
      "portraitUrl",
    );
    await mkdir(path.join(workspace, "portraits"));
    for (const file of ["angry.webp", "neutral.webp"])
      await writeFile(path.join(workspace, "portraits", file), file);
    expect((await loadCharacterData(api, "aris")).portraitUrl).toMatch(
      /^\/kazusa\/portrait\?id=aris&name=neutral&v=\w+$/,
    );
  });
});

describe("registerCharactersHttp", () => {
  it("registers GET /kazusa/characters and GET /kazusa/character routes", async () => {
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<boolean>
    > = {};
    const api = {
      config: {
        gateway: { auth: { token: "test-service-token" } },
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
      {
        method: "GET",
        headers: { authorization: "Bearer test-service-token" },
        url: "/kazusa/characters",
      },
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
      {
        method: "GET",
        headers: { authorization: "Bearer test-service-token" },
        url: "/kazusa/characters",
      },
      charactersRes,
    );
    expect(
      JSON.parse(charactersJson ?? "{}").characters.map(
        (c: { id: string }) => c.id,
      ),
    ).toEqual(["arona", "user:sensei"]);
    await routes["/kazusa/character"]?.(
      {
        method: "GET",
        headers: { authorization: "Bearer test-service-token" },
        url: "/kazusa/character?id=arona",
      },
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
      {
        method: "GET",
        headers: { authorization: "Bearer test-service-token" },
        url: "/kazusa/characters",
      },
      charactersRes,
    );
    expect(
      CharactersResponseSchema.parse(
        JSON.parse(charactersJson ?? "{}"),
      ).characters.find((c) => c.id === "arona")?.isSystemAgent,
    ).toBe(false);
    await routes["/kazusa/character"]?.(
      {
        method: "GET",
        headers: { authorization: "Bearer test-service-token" },
        url: "/kazusa/character?id=kazusa",
      },
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
      config: {
        gateway: { auth: { token: "test-service-token" } },
        agents: { entries: { kazusa: {} } },
      },
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
          headers: { authorization: "Bearer test-service-token" },
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
    expect(setOnstage).toHaveBeenCalledWith("kazusa", false, ["kazusa"]);
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

describe("making and deleting a character", () => {
  it("writes their page and workspace offstage, joins the cast, and leaves it for good", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kazusa-cast-"));
    const wiki = path.join(root, "shared", "wiki");
    await mkdir(path.join(wiki, "characters"), { recursive: true });
    await mkdir(path.join(wiki, "concepts"), { recursive: true });
    await writeFile(path.join(wiki, "concepts", "choir.md"), "# Choir\n");
    const workspaceOf = (id: string) => path.join(root, "workspaces", id);
    await mkdir(workspaceOf("bea"), { recursive: true });
    let config = {
      gateway: { auth: { token: "test-service-token" } },
      agents: {
        defaults: { systemAgent: { agentId: "amy" } },
        entries: {
          amy: { workspace: "./workspaces/amy" },
          bea: { workspace: "./workspaces/bea", tools: { deny: ["exec"] } },
        } as Record<string, unknown>,
      },
    };
    const routes = new Map<
      string,
      (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
    >();
    const api = {
      config,
      pluginConfig: { memory: { wikiDir: wiki } },
      registerHttpRoute: vi.fn((opts) => routes.set(opts.path, opts.handler)),
      runtime: {
        agent: {
          resolveAgentWorkspaceDir: vi.fn((_: unknown, id: string) =>
            workspaceOf(id),
          ),
        },
        config: {
          // The Gateway reloads `openclaw.json` when it changes.
          current: () => {
            const file = process.env.OPENCLAW_CONFIG_PATH;
            if (!file || !existsSync(file)) return config;
            const onDisk = JSON.parse(readFileSync(file, "utf8")) as {
              agents: { entries: Record<string, unknown> };
            };
            return {
              ...config,
              agents: { ...config.agents, entries: onDisk.agents.entries },
            };
          },
          mutateConfigFile: vi.fn(
            async ({ mutate }: { mutate: (draft: typeof config) => void }) => {
              const draft = structuredClone(config);
              mutate(draft);
              config = draft;
            },
          ),
        },
      },
    } as unknown as OpenClawPluginApi;
    const setOnstage = vi.fn(async () => {});
    registerCharactersHttp(api, {
      taskman: {
        store: { lookup: vi.fn(async () => undefined) },
        onTaskChange: vi.fn(() => () => {}),
      } as never,
      perception: { onBrainStateChange: vi.fn(() => () => {}) } as never,
      messaging: { onEvent: vi.fn(() => () => {}) } as never,
      broadcaster: new KazusaRealtimeBroadcaster(),
      stage: { isOnstage: async () => true, lookup: async () => undefined },
      setOnstage,
    });
    const post = async (route: string, body: unknown) => {
      const req = Object.assign(
        Readable.from([Buffer.from(JSON.stringify(body))]),
        {
          method: "POST",
          url: route,
          headers: { authorization: "Bearer test-service-token" },
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
      await routes.get(route)!(
        req as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      );
      return { status: res.statusCode, json: JSON.parse(res.body) as unknown };
    };
    const previous = process.env.OPENCLAW_STATE_DIR;
    const previousConfig = process.env.OPENCLAW_CONFIG_PATH;
    process.env.OPENCLAW_STATE_DIR = path.join(root, ".state");
    // As written: the system agent's entry holds an `$include`.
    const configFile = path.join(root, "openclaw.json");
    await writeFile(
      configFile,
      JSON.stringify({
        agents: {
          entries: {
            amy: { $include: "./.state/system-agent.json" },
            bea: { workspace: "./workspaces/bea", tools: { deny: ["exec"] } },
          },
        },
      }),
    );
    process.env.OPENCLAW_CONFIG_PATH = configFile;
    const written = async () =>
      (
        JSON.parse(await readFile(configFile, "utf8")) as {
          agents: { entries: Record<string, unknown> };
        }
      ).agents.entries;
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const { access } = await import("node:fs/promises");
      // An id another page has is taken.
      expect(
        (await post("/kazusa/character/create", { id: "choir", name: "Choir" }))
          .status,
      ).toBe(409);
      expect(
        await post("/kazusa/character/create", {
          id: "cleo-day",
          name: "Cleo Day",
        }),
      ).toEqual({ status: 200, json: { id: "cleo-day" } });
      expect(
        await readFile(path.join(wiki, "characters", "cleo-day.md"), "utf8"),
      ).toBe('---\nname: "Cleo Day"\n---\n\n# Cleo Day\n');
      expect(
        await readFile(path.join(workspaceOf("cleo-day"), "MEMORY.md"), "utf8"),
      ).toBe("# Cleo Day\n");
      expect(setOnstage).toHaveBeenCalledWith("cleo-day", false, ["cleo-day"]);
      expect((await written())["cleo-day"]).toEqual({
        workspace: "./workspaces/cleo-day",
        tools: { deny: ["exec"] },
      });
      expect((await written()).amy).toEqual({
        $include: "./.state/system-agent.json",
      });

      expect(
        (await post("/kazusa/character/delete", { id: "amy" })).status,
      ).toBe(400);
      expect(
        await post("/kazusa/character/delete", { id: "cleo-day" }),
      ).toEqual({ status: 200, json: { id: "cleo-day" } });
      expect((await written())["cleo-day"]).toBeUndefined();
      await expect(
        access(path.join(wiki, "characters", "cleo-day.md")),
      ).rejects.toThrow();
      await expect(access(workspaceOf("cleo-day"))).rejects.toThrow();
    } finally {
      process.chdir(cwd);
      if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
      else process.env.OPENCLAW_STATE_DIR = previous;
      if (previousConfig === undefined) delete process.env.OPENCLAW_CONFIG_PATH;
      else process.env.OPENCLAW_CONFIG_PATH = previousConfig;
    }
  });
});
