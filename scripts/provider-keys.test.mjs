import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dropStoreKeyRefs } from "./provider-keys.mjs";

const ref = (id) => ({ source: "store", provider: "default", id });

function world(config) {
  const root = mkdtempSync(path.join(tmpdir(), "kazusa-provider-keys-"));
  const dir = path.join(root, "apps/kazusa/world");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "openclaw.json"), JSON.stringify(config));
  const read = () =>
    JSON.parse(readFileSync(path.join(dir, "openclaw.json"), "utf8"));
  return { root, read };
}

const deps = (profiles, stored) => ({
  profiles: () => new Set(profiles),
  stored: () => new Set(stored),
  remove: vi.fn(),
});

describe("dropStoreKeyRefs", () => {
  it("drops references a profile replaced or nothing backs, then their entries", () => {
    const { root, read } = world({
      models: {
        providers: {
          openrouter: { apiKey: ref("OPENROUTER_API_KEY") },
          venice: { apiKey: ref("VENICE_API_KEY") },
          groq: { apiKey: ref("GROQ_API_KEY") },
          zai: { apiKey: { source: "env", provider: "default", id: "Z" } },
          ollama: { apiKey: ref("OLLAMA_KEY"), baseUrl: "http://x" },
        },
      },
      plugins: {
        entries: {
          kazusa: {
            config: {
              decisions: { typesafeApiKey: ref("TYPESAFE_API_KEY") },
              user: { id: "sensei" },
            },
          },
        },
      },
    });
    const openclaw = deps(
      ["openrouter"],
      ["OPENROUTER_API_KEY", "VENICE_API_KEY", "OLLAMA_KEY"],
    );
    expect(dropStoreKeyRefs(root, openclaw)).toEqual([
      "Provider keys for openrouter now live in auth profiles.",
    ]);
    // Venice and Ollama still wait for their keys to be copied.
    expect(read()).toEqual({
      models: {
        providers: {
          venice: { apiKey: ref("VENICE_API_KEY") },
          zai: { apiKey: { source: "env", provider: "default", id: "Z" } },
          ollama: { apiKey: ref("OLLAMA_KEY"), baseUrl: "http://x" },
        },
      },
      plugins: { entries: { kazusa: { config: { user: { id: "sensei" } } } } },
    });
    expect(openclaw.remove).toHaveBeenCalledWith(["OPENROUTER_API_KEY"]);
  });

  it("removes emptied parents once every reference is gone", () => {
    const { root, read } = world({
      models: { providers: { venice: { apiKey: ref("VENICE_API_KEY") } } },
      gateway: { port: 18789 },
    });
    dropStoreKeyRefs(root, deps(["venice"], ["VENICE_API_KEY"]));
    expect(read()).toEqual({ gateway: { port: 18789 } });
  });

  it("leaves a world without references untouched, asking OpenClaw nothing", () => {
    const { root } = world({ gateway: { port: 18789 } });
    const openclaw = {
      profiles: vi.fn(),
      stored: vi.fn(),
      remove: vi.fn(),
    };
    expect(dropStoreKeyRefs(root, openclaw)).toEqual([]);
    expect(openclaw.profiles).not.toHaveBeenCalled();
  });
});
