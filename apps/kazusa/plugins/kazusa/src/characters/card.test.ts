import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { describe, expect, it, vi } from "vitest";
import { registerCharacterCard } from "./card.ts";

type Handler = (event: { context: Record<string, unknown> }) => void;

function setup() {
  const wiki = mkdtempSync(path.join(tmpdir(), "card-"));
  mkdirSync(path.join(wiki, "entities", "characters"), { recursive: true });
  writeFileSync(
    path.join(wiki, "entities", "characters", "yuuka.md"),
    "---\nname: Yuuka\n---\n\n# Yuuka\n\nThe treasurer.\n",
  );
  let handler: Handler | undefined;
  const config = {
    agents: { defaults: { systemAgent: { agentId: "arona" } } },
  };
  const api = {
    pluginConfig: { memory: { wikiDir: wiki } },
    config,
    runtime: { config: { current: () => config } },
    registerHook: vi.fn((_event: string, next: Handler) => {
      handler = next;
    }),
  } as unknown as OpenClawPluginApi;
  registerCharacterCard(api);
  const files = (cards = false) => [
    { name: "AGENTS.md", path: "/w/AGENTS.md", content: "a", missing: false },
    {
      name: "SOUL.md",
      path: "/w/SOUL.md",
      content: "old soul",
      missing: !cards,
    },
    {
      name: "IDENTITY.md",
      path: "/w/IDENTITY.md",
      content: "old",
      missing: !cards,
    },
    {
      name: "MEMORY.md",
      path: "/w/MEMORY.md",
      content: "plans",
      missing: false,
    },
  ];
  const run = (agentId: string, cards = false) => {
    const context: Record<string, unknown> = {
      agentId,
      workspaceDir: "/w",
      bootstrapFiles: files(cards),
    };
    handler?.({ context });
    return context.bootstrapFiles as ReturnType<typeof files>;
  };
  return { api, run };
}

describe("a world character's card", () => {
  it("is their World Wiki page in place of IDENTITY.md and SOUL.md, once gone", () => {
    const { run } = setup();
    const files = run("yuuka");
    expect(files.map(({ name }) => name)).toEqual([
      "IDENTITY.md",
      "AGENTS.md",
      "MEMORY.md",
    ]);
    expect(files[0].content).toContain("The treasurer.");
  });

  it("leaves a character without a page with neither old file", () => {
    const { run } = setup();
    expect(run("nobody").map(({ name }) => name)).toEqual([
      "AGENTS.md",
      "MEMORY.md",
    ]);
  });

  it("keeps a world's cards as they are until it updates", () => {
    const { run } = setup();
    expect(run("yuuka", true).map(({ name }) => name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "MEMORY.md",
    ]);
  });

  it("leaves the system agent's own files alone", () => {
    const { run } = setup();
    expect(run("arona", true).map(({ name }) => name)).toEqual([
      "AGENTS.md",
      "SOUL.md",
      "IDENTITY.md",
      "MEMORY.md",
    ]);
  });

  it("dresses a linked console as its character, keeping its own instructions", () => {
    const wiki = mkdtempSync(path.join(tmpdir(), "card-"));
    mkdirSync(path.join(wiki, "entities", "characters"), { recursive: true });
    writeFileSync(
      path.join(wiki, "entities", "characters", "arona.md"),
      "---\nname: Arona\n---\n\n# Arona\n\nShe lives in the Shittim Chest.\n",
    );
    const home = mkdtempSync(path.join(tmpdir(), "home-"));
    mkdirSync(path.join(home, "arona"));
    writeFileSync(path.join(home, "arona", "MEMORY.md"), "Sensei likes tea.");
    let handler: Handler | undefined;
    const config = {
      agents: {
        defaults: { systemAgent: { agentId: "shittim" } },
        entries: { shittim: {}, arona: {} },
      },
    };
    const api = {
      pluginConfig: { memory: { wikiDir: wiki }, systemAgent: { is: "arona" } },
      config,
      runtime: {
        config: { current: () => config },
        agent: {
          resolveAgentWorkspaceDir: (_: unknown, id: string) =>
            path.join(home, id),
        },
      },
      registerHook: vi.fn((_event: string, next: Handler) => {
        handler = next;
      }),
    } as unknown as OpenClawPluginApi;
    registerCharacterCard(api);
    const context: Record<string, unknown> = {
      agentId: "shittim",
      workspaceDir: "/console",
      bootstrapFiles: [
        {
          name: "AGENTS.md",
          path: "/console/AGENTS.md",
          content: "admin",
          missing: false,
        },
        {
          name: "IDENTITY.md",
          path: "/console/IDENTITY.md",
          content: "console",
          missing: false,
        },
        {
          name: "MEMORY.md",
          path: "/console/MEMORY.md",
          content: "scratch",
          missing: false,
        },
      ],
    };
    handler?.({ context });
    const files = context.bootstrapFiles as {
      name: string;
      path: string;
      content: string;
    }[];
    expect(files.map(({ name }) => name)).toEqual([
      "IDENTITY.md",
      "AGENTS.md",
      "MEMORY.md",
    ]);
    expect(files[0].content).toContain("Shittim Chest");
    expect(files[1].content).toBe("admin");
    // Her memory, read only: the console's own path, so its writes stay its.
    expect(files[2]).toMatchObject({
      content: "Sensei likes tea.",
      path: "/console/MEMORY.md",
    });
  });
});
