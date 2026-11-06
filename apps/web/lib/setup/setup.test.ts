import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_AGENT_INCLUDE as SCRIPT_INCLUDE } from "../../../../scripts/system-agent.mjs";
import { execFileSync } from "node:child_process";
import {
  createSetup,
  sdkScript,
  SYSTEM_AGENT_INCLUDE,
  type KeyStore,
} from "./setup";

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Auth profiles by provider, without OpenClaw. */
function memoryStore(
  entries = new Map<string, string>(),
): KeyStore & { entries: Map<string, string> } {
  return {
    entries,
    saved: async () => [...entries.keys()],
    set: async (provider, key) => {
      entries.set(provider, key);
    },
  };
}

/** A repo-shaped folder with a world that has a cast and one that doesn't. */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-setup-"));
  const app = path.join(root, "apps/kazusa");
  mkdirSync(path.join(root, ".agents"));
  write(
    path.join(app, "worlds/base.json"),
    JSON.stringify({
      systemAgent: { skills: ["kazusa"] },
      config: {
        agents: {
          defaults: {
            heartbeat: { every: "0m" },
            models: { "openrouter/z-ai/glm-5.3-flash": {} },
            model: { primary: "openrouter/z-ai/glm-5.3-flash" },
          },
        },
        plugins: {
          entries: {
            kazusa: {
              config: {
                memory: { sleep: { enabled: true } },
                // An unknown id is dropped from the guide.
                models: { providers: ["openrp", "nobody", "openrouter"] },
              },
            },
          },
        },
      },
    }),
  );
  const world = (id: string, agents: string[]) => {
    write(
      path.join(app, "worlds", id, "package.json"),
      JSON.stringify({
        name: id,
        displayName: id,
        version: "1.0.0",
        description: id,
        kazusa: {
          systemAgent: "admin",
          defaultGroup: "crew",
          config: {
            user: { id: "user:me" },
            memory: { anchors: { guild: "intimate", city: "familiar" } },
          },
        },
      }),
    );
    write(path.join(app, "worlds", id, "shared/wiki/index.md"), "wiki");
    for (const agent of agents)
      write(
        path.join(app, "worlds", id, "workspaces", agent, "IDENTITY.md"),
        `---\nname: "${agent.toUpperCase()}"\n---\n`,
      );
  };
  world("cast-world", ["admin", "ann", "bo", "cy"]);
  world("starter", ["admin"]);
  const cards = path.join(app, "worlds/cast-world/shared/wiki");
  write(
    path.join(cards, "entities/characters/ann.md"),
    '---\nguild: crew\ncity: "Port"\n---\n',
  );
  write(
    path.join(cards, "entities/characters/bo.md"),
    "---\nguild: crew\ncity: Port\n---\n",
  );
  write(
    path.join(cards, "entities/characters/cy.md"),
    "---\nguild: lone\ncity: Port\n---\n",
  );
  write(path.join(cards, "concepts/crew.md"), '---\ntitle: "The Crew"\n---\n');
  return app;
}

describe("sdkScript", () => {
  it("imports the SDK by file URL, which Windows needs for a drive path", () => {
    const [, , code] = sdkScript(
      "Z:\\Kazusa\\node_modules\\openclaw\\dist\\plugin-sdk\\provider-auth.js",
      "",
      true,
    );
    expect(code).toContain(
      'import("file:///Z:/Kazusa/node_modules/openclaw/dist/plugin-sdk/provider-auth.js")',
    );
  });

  it("loads OpenClaw's SDK in a child Node process", () => {
    const sdk = path.resolve(
      __dirname,
      "../../../../node_modules/openclaw/dist/plugin-sdk/provider-auth.js",
    );
    const out = execFileSync(
      process.execPath,
      sdkScript(
        sdk,
        "process.stdout.write(typeof sdk.ensureAuthProfileStore);",
      ),
      { encoding: "utf8" },
    );
    expect(out).toBe("function");
  });
});

describe("setup", () => {
  let app: string;
  let store: ReturnType<typeof memoryStore>;
  const createSetupHere = (dir: string) => createSetup(dir, store);
  beforeEach(() => {
    app = fixture();
    store = memoryStore();
    vi.stubEnv("OPENROUTER_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const config = () =>
    JSON.parse(readFileSync(path.join(app, "world/openclaw.json"), "utf8"));

  it("lists worlds with their characters, starting from scratch last", async () => {
    const status = await createSetupHere(app).status();
    expect(status).toMatchObject({
      configured: false,
      imported: null,
      savedKey: null,
    });
    // In config order, labelled and linked from the provider catalog.
    expect(status.providers).toEqual([
      expect.objectContaining({
        id: "openrp",
        label: "OpenRP",
        keysUrl: "https://openrp.ai/settings/api-keys",
      }),
      expect.objectContaining({ id: "openrouter", label: "OpenRouter" }),
    ]);
    expect(status.worlds.map(({ id }) => id)).toEqual([
      "cast-world",
      "starter",
    ]);
    expect(status.worlds[0]?.characters).toEqual([
      { id: "ann", name: "ANN" },
      { id: "bo", name: "BO" },
      { id: "cy", name: "CY" },
    ]);
    expect(status.worlds[1]?.characters).toEqual([]);
  });

  it("reads groups from the world's anchors, broadest first, skipping groups of one", async () => {
    const [world] = (await createSetupHere(app).status()).worlds;
    expect(world?.groups).toEqual([
      { field: "city", groups: [{ name: "Port", ids: ["ann", "bo", "cy"] }] },
      { field: "guild", groups: [{ name: "The Crew", ids: ["ann", "bo"] }] },
    ]);
    expect(world?.defaultCast).toEqual(["ann", "bo"]);
  });

  it("makes a world from the choices, keeping the template untouched", async () => {
    const setup = createSetupHere(app);
    await setup.apply({
      world: "cast-world",
      cast: ["ann"],
      startAt: "2027-01-01T06:30",
      key: { provider: "openrouter", value: "sk-test" },
    });
    const made = config();
    expect(Object.keys(made.agents.entries).sort()).toEqual([
      "admin",
      "ann",
      "bo",
      "cy",
    ]);
    expect(made.agents.defaults.systemAgent.agentId).toBe("admin");
    expect(made.agents.entries.admin).toEqual({
      $include: SYSTEM_AGENT_INCLUDE,
      workspace: "./workspaces/admin",
      cwd: path.join(app, "world"),
      identity: { name: "ADMIN" },
    });
    expect(
      JSON.parse(
        readFileSync(path.join(app, "world", SYSTEM_AGENT_INCLUDE), "utf8"),
      ),
    ).toEqual({ skills: ["kazusa"] });
    expect(SYSTEM_AGENT_INCLUDE).toBe(SCRIPT_INCLUDE);
    const kazusa = made.plugins.entries.kazusa.config;
    expect(kazusa.stage).toEqual({
      defaultOnstage: false,
      cast: ["admin", "ann"],
    });
    expect(kazusa.clock).toEqual({
      speed: 0,
      startAt: "2027-01-01T06:30:00.000Z",
    });
    expect(kazusa.memory).toEqual({
      sleep: { enabled: true },
      anchors: { guild: "intimate", city: "familiar" },
    });
    expect(store.entries.get("openrouter")).toBe("sk-test");
    expect(made.agents.defaults.model).toEqual({
      primary: "openrouter/z-ai/glm-5.3-flash",
    });
    expect(existsSync(path.join(app, "world/.state/.env"))).toBe(false);
    expect(
      lstatSync(
        path.join(app, "world/workspaces/admin/.agents"),
      ).isSymbolicLink(),
    ).toBe(true);
    expect(
      existsSync(path.join(app, "worlds/cast-world/workspaces/admin/.agents")),
    ).toBe(false);
    // The template as imported, for a later world update to compare against.
    const manifest = JSON.parse(
      readFileSync(path.join(app, "world/.template/manifest.json"), "utf8"),
    );
    expect(manifest.template).toBe("cast-world");
    expect(Object.keys(manifest.files)).toContain(
      "workspaces/admin/IDENTITY.md",
    );
    expect((await setup.status()).configured).toBe(true);
  });

  it("leaves a world without a cast running with everyone onstage", async () => {
    await createSetupHere(app).apply({ world: "starter", cast: [] });
    const kazusa = config().plugins.entries.kazusa.config;
    expect(kazusa.stage).toBeUndefined();
    expect(kazusa.clock).toBeUndefined();
  });

  it("saves the key for whichever offered provider was picked", async () => {
    await createSetupHere(app).apply({
      world: "starter",
      cast: [],
      key: { provider: "openrp", value: "sk-rp" },
    });
    expect(store.entries.get("openrp")).toBe("sk-rp");
    expect(store.entries.has("openrouter")).toBe(false);
    // The plugin picks the model from the keys there are; config stays as is.
    expect(config().agents.defaults.model).toEqual({
      primary: "openrouter/z-ai/glm-5.3-flash",
    });
  });

  it("refuses a key for a provider it doesn't offer", async () => {
    await expect(
      createSetupHere(app).apply({
        world: "starter",
        cast: [],
        key: { provider: "nobody", value: "k" },
      }),
    ).rejects.toThrow("Unknown provider");
    expect(store.entries.size).toBe(0);
  });

  it("moves a key from the old keys file into a profile", async () => {
    write(path.join(app, "world/.state/.env"), "OPENROUTER_API_KEY=from-env\n");
    await createSetupHere(app).apply({ world: "starter", cast: [] });
    expect(store.entries.get("openrouter")).toBe("from-env");
  });

  it("picks up an unfinished run and keeps what is already there", async () => {
    const setup = createSetupHere(app);
    store.entries.set("openrouter", "first");
    write(
      path.join(app, "world/workspaces/ann/IDENTITY.md"),
      "---\nname: EDITED\n---\n",
    );
    await setup.apply({
      world: "cast-world",
      cast: [],
      key: { provider: "openrp", value: "second" },
    });
    expect(store.entries.get("openrouter")).toBe("first");
    expect(store.entries.has("openrp")).toBe(false);
    expect(
      readFileSync(path.join(app, "world/workspaces/ann/IDENTITY.md"), "utf8"),
    ).toContain("EDITED");

    // Once done, another request changes nothing.
    const before = readFileSync(path.join(app, "world/openclaw.json"), "utf8");
    await setup.apply({ world: "starter", cast: ["bo"] });
    expect(readFileSync(path.join(app, "world/openclaw.json"), "utf8")).toBe(
      before,
    );
  });

  it("reports an imported world and a saved key on the next visit", async () => {
    const setup = createSetupHere(app);
    store.entries.set("openrouter", "k");
    write(
      path.join(app, "world/package.json"),
      JSON.stringify({
        name: "s",
        kazusa: { systemAgent: "admin", template: "starter" },
      }),
    );
    expect(await setup.status()).toMatchObject({
      imported: "starter",
      savedKey: expect.objectContaining({ id: "openrouter" }),
      configured: false,
    });
  });

  it("refuses a world that does not exist", async () => {
    await expect(
      createSetupHere(app).apply({ world: "../../etc", cast: [] }),
    ).rejects.toThrow("Unknown world");
  });
});
