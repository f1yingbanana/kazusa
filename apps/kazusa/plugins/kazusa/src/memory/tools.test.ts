import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { materialize, WORLDS } from "./fixtures/worlds.ts";
import { registerMemory } from "./register.ts";

vi.mock("../ledger.ts", () => ({ appendLedgerEntry: vi.fn(async () => {}) }));
vi.mock("../current-config.ts", () => ({ currentConfig: () => ({}) }));
import { appendLedgerEntry } from "../ledger.ts";

const NOW = Date.parse(WORLDS.saltmere.now);
let root: string;
type Tool = {
  name: string;
  execute: (
    id: string,
    input: unknown,
  ) => Promise<{ content: Array<{ text: string }> }>;
};
let factories: Map<string, unknown>;
const call = async (
  name: string,
  agentId: string,
  input: unknown,
): Promise<string> => {
  const factory = factories.get(name) as
    Tool | ((context: { agentId: string }) => Tool);
  const tool = typeof factory === "function" ? factory({ agentId }) : factory;
  return (await tool.execute("id", input)).content[0].text;
};
const page = (agent: string, relative: string): string =>
  readFileSync(path.join(root, "agents", agent, "wiki", relative), "utf8");

beforeEach(() => {
  vi.mocked(appendLedgerEntry).mockClear();
  // Each test gets its own world, not the process-wide index.
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("kazusa.memory")];
  root = materialize(WORLDS.saltmere);
  factories = new Map();
  const api = {
    id: "kazusa",
    rootDir: root,
    pluginConfig: {
      memory: {
        wikiDir: path.join(root, "world"),
        anchors: WORLDS.saltmere.anchors,
        embedding: {
          apiKeyEnv: "KAZUSA_NO_KEY",
          model: "m",
        },
      },
    },
    logger: { warn: () => {} },
    registerHttpRoute: () => {},
    registerTool: (tool: Tool | ((context: unknown) => Tool)) => {
      const shape = typeof tool === "function" ? tool({ agentId: "x" }) : tool;
      factories.set(shape.name, tool);
    },
    runtime: {
      agent: {
        resolveAgentWorkspaceDir: (_config: unknown, id: string) =>
          path.join(root, "agents", id),
      },
      state: {
        openKeyedStore: () => ({
          lookup: async () => undefined,
          register: async () => {},
        }),
      },
    },
  };
  registerMemory(api as never, {
    clock: { time: () => NOW },
    experiences: async () => ({ text: "", speakers: [], through: NOW }),
  });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("recall", () => {
  it("finds their own memory and labels it", async () => {
    const text = await call("recall", "mara-vell", {
      query: "who is stealing the oil?",
    });
    expect(text).toContain("You remember: My night ledger");
  });

  it("labels what anyone would know", async () => {
    const text = await call("recall", "hope-marrow", {
      query: "the Founding of Saltmere",
    });
    expect(text).toContain("Everyone knows: Founding of Saltmere");
  });

  it("admits when nothing comes", async () => {
    expect(
      await call("recall", "hope-marrow", { query: "zeppelin hangar" }),
    ).toBe("Nothing comes to mind.");
  });

  it("does not reach secrets or others' minds", async () => {
    const text = await call("recall", "hope-marrow", {
      query: "crates on stilts, night ledger",
    });
    expect(text).not.toContain("black water");
    expect(text).not.toContain("every lamp that fails");
  });
});

describe("look_up", () => {
  it("finds public pages, and records that they looked", async () => {
    const text = await call("look_up", "hope-marrow", {
      topic: "Drowned Bell",
    });
    expect(text).toContain("Fishermen swear");
    expect(vi.mocked(appendLedgerEntry).mock.calls[0][1]).toMatchObject({
      agentId: "hope-marrow",
      stream: "tasks",
      timestamp: NOW,
    });
  });

  it("does not find secrets, private or local pages", async () => {
    for (const topic of ["The Undertow", "Mara's Loft"]) {
      expect(await call("look_up", "hope-marrow", { topic })).toBe(
        "Nothing public turns up.",
      );
    }
    expect(
      await call("look_up", "hope-marrow", { topic: "Lamp Oath" }),
    ).not.toContain("swears");
  });

  it("only reads the public layers", async () => {
    const text = await call("look_up", "hope-marrow", {
      topic: "Lamplighters guild accounts",
    });
    expect(text).not.toContain("widows");
  });
});

describe("remember", () => {
  it("adds a note to an existing page, resolved by name", async () => {
    await call("remember", "mara-vell", {
      about: "Tobin",
      note: "He looks thin.",
    });
    const notes = page("mara-vell", "entities/characters/tobin-vell.md");
    expect(notes).toMatch(
      /- 2026-03-10 · seen it · sure — He looks thin\.\n- 2026-03-08/,
    );
  });

  it("starts a page for someone in the world, in the right place", async () => {
    await call("remember", "tobin-vell", {
      about: "Bram Stokes",
      note: "Paid in new coin.",
      source: "told by Oswin Hale",
      certainty: "suspect",
    });
    expect(page("tobin-vell", "entities/characters/bram-stokes.md")).toContain(
      "- 2026-03-10 · told by oswin-hale · suspect — Paid in new coin.",
    );
  });

  it("starts a concept for something new", async () => {
    await call("remember", "mara-vell", {
      about: "Oil Prices!",
      note: "Up again.",
    });
    expect(page("mara-vell", "concepts/oil_prices.md")).toContain("Up again.");
  });

  it("files plans under the day they happen", async () => {
    await call("remember", "mara-vell", {
      about: "me",
      note: "[HARD_BLOCK] 09:00 Meet Ilse.",
      on: "2026-03-12",
    });
    expect(
      readFileSync(path.join(root, "agents/mara-vell/MEMORY.md"), "utf8"),
    ).toContain(
      "## Plans recorded for 2026-03-12\n\n- [HARD_BLOCK] 09:00 Meet Ilse.",
    );
  });

  it("refuses a made-up source or teller", async () => {
    await expect(
      call("remember", "mara-vell", {
        about: "Tobin",
        note: "x",
        source: "the stars",
      }),
    ).rejects.toThrow(/source must be/);
    await expect(
      call("remember", "mara-vell", {
        about: "Tobin",
        note: "x",
        source: "told by Nobody Real",
      }),
    ).rejects.toThrow(/don't know anyone/);
  });

  it("what it writes comes back in the next recall", async () => {
    await call("remember", "mara-vell", {
      about: "Tobin",
      note: "Keeps a hidden flask.",
    });
    expect(
      await call("recall", "mara-vell", { query: "hidden flask" }),
    ).toContain("Keeps a hidden flask.");
  });
});

describe("the manifest", () => {
  it("declares every tool, or the host refuses it", () => {
    const manifest = JSON.parse(
      readFileSync(
        new URL("../../openclaw.plugin.json", import.meta.url),
        "utf8",
      ),
    ) as { contracts: { tools: string[] } };
    expect(manifest.contracts.tools).toEqual(
      expect.arrayContaining([...factories.keys()]),
    );
  });
});

describe("admin tools", () => {
  it("lint and explain are available", async () => {
    expect(JSON.parse(await call("wiki_lint", "arona", {}))).toEqual(
      expect.any(Array),
    );
    expect(
      JSON.parse(
        await call("knowledge_explain", "arona", {
          agent: "mara-vell",
          page: "lamp_hall",
        }),
      ),
    ).toMatchObject({ depth: "intimate" });
  });
});
