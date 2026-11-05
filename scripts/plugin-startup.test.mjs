import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowChatStarters,
  loadNewPlugins,
  startProviderPlugins,
} from "./plugin-startup.mjs";

const policy = { allowPromptInjection: true };

function repo(world) {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-plugin-startup-"));
  const app = path.join(root, "apps/kazusa");
  mkdirSync(path.join(app, "worlds"), { recursive: true });
  writeFileSync(
    path.join(app, "worlds/base.json"),
    JSON.stringify({
      config: {
        plugins: {
          entries: {
            kazusa: { enabled: true, hooks: { allowConversationAccess: true } },
            zai: { enabled: true, hooks: policy },
            venice: { enabled: true, hooks: policy },
            groq: { enabled: true, hooks: policy },
          },
        },
      },
    }),
  );
  if (world) {
    mkdirSync(path.join(app, "world"));
    writeFileSync(path.join(app, "world/openclaw.json"), JSON.stringify(world));
  }
  const read = () =>
    JSON.parse(readFileSync(path.join(app, "world/openclaw.json"), "utf8"));
  return { root, read };
}

describe("startProviderPlugins", () => {
  it("adds the policy where a world has none, keeping everything else", () => {
    const { root, read } = repo({
      plugins: {
        allow: ["kazusa", "zai", "venice"],
        entries: {
          kazusa: { enabled: true, config: { user: { id: "sensei" } } },
          zai: { enabled: true },
        },
      },
      gateway: { port: 18789 },
    });
    expect(startProviderPlugins(root)).toEqual([
      "2 model provider plugins now start with the Gateway, so characters share one Kazusa.",
    ]);
    expect(read()).toEqual({
      plugins: {
        allow: ["kazusa", "zai", "venice"],
        entries: {
          // Only base.json's provider policy is copied, never other hooks.
          kazusa: { enabled: true, config: { user: { id: "sensei" } } },
          zai: { enabled: true, hooks: policy },
          venice: { hooks: policy },
        },
      },
      gateway: { port: 18789 },
    });
  });

  it("leaves a policy the user chose, and does nothing a second time", () => {
    const world = {
      plugins: {
        entries: {
          zai: { hooks: { allowPromptInjection: false } },
          venice: { hooks: policy },
          groq: { hooks: { allowConversationAccess: true } },
        },
      },
    };
    const { root, read } = repo(world);
    expect(startProviderPlugins(root)).toHaveLength(1);
    expect(read().plugins.entries).toEqual({
      zai: { hooks: { allowPromptInjection: false } },
      venice: { hooks: policy },
      groq: { hooks: { allowConversationAccess: true, ...policy } },
    });
    expect(startProviderPlugins(root)).toEqual([]);
  });

  it("does nothing before a world exists", () => {
    const { root } = repo(undefined);
    expect(startProviderPlugins(root)).toEqual([]);
  });
});

describe("loadNewPlugins", () => {
  const OPENRP = "../../../node_modules/@openrp-ai/openclaw-provider";
  const MISSING = "../../../node_modules/@openclaw/not-installed-provider";
  /** Base lists Kazusa, OpenRP's package (installed) and one not installed. */
  const withLoadPaths = (root) => {
    const file = path.join(root, "apps/kazusa/worlds/base.json");
    const base = JSON.parse(readFileSync(file, "utf8"));
    base.config.plugins.load = {
      paths: ["../plugins/kazusa", OPENRP, MISSING],
    };
    writeFileSync(file, JSON.stringify(base));
    const plugin = path.join(root, "node_modules/@openrp-ai/openclaw-provider");
    mkdirSync(plugin, { recursive: true });
    writeFileSync(
      path.join(plugin, "openclaw.plugin.json"),
      JSON.stringify({ id: "openrp" }),
    );
    return root;
  };

  it("loads and allows, by its manifest id, a plugin added after the world was made", () => {
    const { root, read } = repo({
      plugins: {
        allow: ["kazusa", "zai"],
        load: { paths: ["../plugins/kazusa"] },
      },
    });
    expect(loadNewPlugins(withLoadPaths(root))).toEqual([
      "This world now loads new plugins: openrp.",
    ]);
    // One not installed yet waits for the next start.
    expect(read().plugins).toEqual({
      allow: ["kazusa", "zai", "openrp"],
      load: { paths: ["../plugins/kazusa", OPENRP] },
    });
    expect(loadNewPlugins(root)).toEqual([]);
  });

  it("leaves a world without an allowlist allowing everything", () => {
    const { root, read } = repo({
      plugins: { load: { paths: ["../plugins/kazusa"] } },
    });
    loadNewPlugins(withLoadPaths(root));
    expect(read().plugins).toEqual({
      load: { paths: ["../plugins/kazusa", OPENRP] },
    });
  });
});

describe("allowChatStarters", () => {
  it("lets every list that may send start chats, once", () => {
    const { root, read } = repo({
      tools: { alsoAllow: ["start_task", "send_message", "list_chats"] },
      // Characters are keyed by id, as worlds keep them.
      agents: {
        entries: {
          a: { tools: { alsoAllow: ["send_message", "talk"] } },
          b: { tools: { alsoAllow: ["recall"] } },
          c: { workspace: "./workspaces/c" },
        },
      },
    });
    expect(allowChatStarters(root)).toHaveLength(1);
    const world = read();
    expect(world.tools.alsoAllow).toEqual([
      "start_task",
      "send_message",
      "create_group",
      "talk",
      "list_chats",
    ]);
    expect(world.agents.entries.a.tools.alsoAllow).toEqual([
      "send_message",
      "create_group",
      "talk",
    ]);
    expect(world.agents.entries.b.tools.alsoAllow).toEqual(["recall"]);
    expect(world.agents.entries.c).toEqual({ workspace: "./workspaces/c" });
    expect(allowChatStarters(root)).toEqual([]);
  });

  it("does nothing without a world", () => {
    expect(allowChatStarters(repo().root)).toEqual([]);
  });
});
