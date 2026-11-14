import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
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
  type Catalog,
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

const readPackage = (dir: string): unknown =>
  JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/**
 * The fixture's world folders as downloaded worlds, and `remote` (`id` to a
 * folder elsewhere) as worlds on offer that a clone copies in, without git.
 */
function folderCatalog(
  app: string,
  remote = new Map<string, string>(),
  hold?: Promise<void>,
): Catalog & { readonly cloned: string[] } {
  const worlds = path.join(app, "worlds");
  const live = path.join(app, "world");
  const sources = () =>
    new Map([
      ...readdirSync(worlds, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            existsSync(path.join(worlds, entry.name, "package.json")),
        )
        .map(({ name }): [string, string] => [name, path.join(worlds, name)]),
      ...remote,
    ]);
  const cloned: string[] = [];
  let here: string | undefined;
  return {
    cloned,
    list: async () =>
      [...sources()].map(([id, source]) => ({
        id,
        downloaded: here === id,
        package: readPackage(here === id ? live : source),
      })),
    // As `world-repo.mjs clone` does, without git: the picked world copied
    // into `world/`, replacing another pick that wasn't set up.
    download: async (id, onProgress) => {
      if (here === id) return;
      const source = sources().get(id);
      if (!source) throw new Error(`No world ${id} is listed.`);
      if (existsSync(path.join(live, "openclaw.json")))
        throw new Error("A world is set up already.");
      onProgress?.({ stage: "receiving", percent: 40 });
      await hold;
      for (const part of [".git", "package.json", "shared", "workspaces"])
        rmSync(path.join(live, part), { recursive: true, force: true });
      cpSync(source, live, { recursive: true });
      cloned.push(id);
      here = id;
    },
  };
}

/** A repo-shaped folder with a world that has a cast and one that doesn't. */
function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-setup-"));
  const app = path.join(root, "apps/kazusa");
  mkdirSync(path.join(root, ".agents"));
  write(
    path.join(app, "base.json"),
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
  const createSetupHere = (dir: string, catalog = folderCatalog(dir)) =>
    createSetup(dir, store, catalog);
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

  it("lists worlds, with the picked one's characters, starting from scratch last", async () => {
    const setup = createSetupHere(app);
    await setup.prepare("cast-world");
    const status = await setup.status();
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

  it("lists a world not yet downloaded by its package.json, and downloads it when picked", async () => {
    const elsewhere = mkdtempSync(path.join(tmpdir(), "kazusa-remote-"));
    renameSync(
      path.join(app, "worlds/cast-world"),
      path.join(elsewhere, "cast-world"),
    );
    const catalog = folderCatalog(
      app,
      new Map([["cast-world", path.join(elsewhere, "cast-world")]]),
    );
    const setup = createSetupHere(app, catalog);
    const listed = (await setup.status()).worlds.find(
      ({ id }) => id === "cast-world",
    );
    expect(listed).toMatchObject({ downloaded: false, characters: [] });
    const picked = await setup.prepare("cast-world");
    expect(picked).toMatchObject({
      downloaded: true,
      defaultCast: ["ann", "bo"],
    });
    expect(picked.characters.map(({ id }) => id)).toEqual(["ann", "bo", "cy"]);
    // Picked again (a reload): already there.
    await setup.prepare("cast-world");
    expect(catalog.cloned).toEqual(["cast-world"]);
  });

  it("downloads a world chosen without picking it first", async () => {
    const elsewhere = mkdtempSync(path.join(tmpdir(), "kazusa-remote-"));
    renameSync(
      path.join(app, "worlds/cast-world"),
      path.join(elsewhere, "cast-world"),
    );
    const catalog = folderCatalog(
      app,
      new Map([["cast-world", path.join(elsewhere, "cast-world")]]),
    );
    await createSetupHere(app, catalog).apply({
      world: "cast-world",
      cast: ["ann"],
    });
    expect(catalog.cloned).toEqual(["cast-world"]);
    expect(existsSync(path.join(app, "world/workspaces/ann"))).toBe(true);
  });

  it("reads groups from the world's anchors, broadest first, skipping groups of one", async () => {
    const world = await createSetupHere(app).prepare("cast-world");
    expect(world?.groups).toEqual([
      { field: "city", groups: [{ name: "Port", ids: ["ann", "bo", "cy"] }] },
      { field: "guild", groups: [{ name: "The Crew", ids: ["ann", "bo"] }] },
    ]);
    expect(world?.defaultCast).toEqual(["ann", "bo"]);
  });

  it("makes a world from the choices, keeping the template untouched", async () => {
    const catalog = folderCatalog(app);
    const setup = createSetupHere(app, catalog);
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
    // A clone of the release: no snapshot beside it.
    expect(catalog.cloned).toEqual(["cast-world"]);
    expect(existsSync(path.join(app, "world/.template"))).toBe(false);
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
    await setup.prepare("cast-world");
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

  it("says how far the picked world's download has got while it runs", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => (release = resolve));
    const setup = createSetup(app, store, folderCatalog(app, undefined, hold));
    expect(setup.downloads()).toEqual({ progress: null });
    const pending = setup.prepare("cast-world");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(setup.downloads().progress).toMatchObject({
      stage: "receiving",
      percent: 40,
    });
    release();
    await pending;
    expect(setup.downloads()).toEqual({ progress: null });
  });

  it("refuses a world that does not exist", async () => {
    await expect(
      createSetupHere(app).apply({ world: "../../etc", cast: [] }),
    ).rejects.toThrow("Unknown world");
  });
});
