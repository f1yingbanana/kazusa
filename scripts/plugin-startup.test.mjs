import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startProviderPlugins } from "./plugin-startup.mjs";

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
