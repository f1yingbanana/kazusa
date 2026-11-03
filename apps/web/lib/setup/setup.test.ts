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
import { createSetup, type SecretStore } from "./setup";

function write(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** The secret store, without OpenClaw's CLI. */
function memoryStore(
  entries = new Map<string, string>(),
): SecretStore & { entries: Map<string, string> } {
  return {
    entries,
    has: async (name) => entries.has(name),
    set: async (name, value) => {
      entries.set(name, value);
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
        agents: { defaults: { heartbeat: { every: "0m" } } },
        plugins: {
          entries: {
            kazusa: { config: { memory: { sleep: { enabled: true } } } },
          },
        },
      },
    }),
  );
  const world = (id: string, agents: string[]) => {
    write(
      path.join(app, "worlds", id, "world.json"),
      JSON.stringify({
        title: id,
        description: id,
        systemAgent: "admin",
        defaultGroup: "crew",
        kazusa: {
          user: { id: "user:me" },
          memory: { anchors: { guild: "intimate", city: "familiar" } },
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
      hasKey: false,
    });
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
      openrouterKey: "sk-test",
    });
    const made = config();
    expect(Object.keys(made.agents.entries).sort()).toEqual([
      "admin",
      "ann",
      "bo",
      "cy",
    ]);
    expect(made.agents.defaults.systemAgent.agentId).toBe("admin");
    expect(made.agents.entries.admin).toMatchObject({
      cwd: path.join(app, "world"),
      skills: ["kazusa"],
      identity: { name: "ADMIN" },
    });
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
    expect(store.entries.get("OPENROUTER_API_KEY")).toBe("sk-test");
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

  it("moves a key from the old keys file into the store", async () => {
    write(path.join(app, "world/.state/.env"), "OPENROUTER_API_KEY=from-env\n");
    await createSetupHere(app).apply({ world: "starter", cast: [] });
    expect(store.entries.get("OPENROUTER_API_KEY")).toBe("from-env");
  });

  it("picks up an unfinished run and keeps what is already there", async () => {
    const setup = createSetupHere(app);
    store.entries.set("OPENROUTER_API_KEY", "first");
    write(
      path.join(app, "world/workspaces/ann/IDENTITY.md"),
      "---\nname: EDITED\n---\n",
    );
    await setup.apply({
      world: "cast-world",
      cast: [],
      openrouterKey: "second",
    });
    expect(store.entries.get("OPENROUTER_API_KEY")).toBe("first");
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
    store.entries.set("OPENROUTER_API_KEY", "k");
    write(
      path.join(app, "world/world.json"),
      JSON.stringify({
        id: "starter",
        title: "s",
        description: "d",
        systemAgent: "admin",
        kazusa: {},
      }),
    );
    expect(await setup.status()).toMatchObject({
      imported: "starter",
      hasKey: true,
      configured: false,
    });
  });

  it("refuses a world that does not exist", async () => {
    await expect(
      createSetupHere(app).apply({ world: "../../etc", cast: [] }),
    ).rejects.toThrow("Unknown world");
  });
});
