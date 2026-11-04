import { describe, expect, it, vi } from "vitest";
import { copyStoreKeysToProfiles, type MigrateDeps } from "./migrate.ts";

const ref = (id: string) => ({ source: "store", provider: "default", id });

/** A world from before keys moved: references to the store everywhere. */
const OLD_WORLD: Record<string, unknown> = {
  models: {
    providers: {
      openrouter: { apiKey: ref("OPENROUTER_API_KEY") },
      venice: { apiKey: ref("VENICE_API_KEY") },
      zai: { apiKey: ref("ZAI_API_KEY") },
      groq: { apiKey: ref("GROQ_API_KEY") },
    },
  },
  plugins: {
    entries: {
      kazusa: {
        config: { decisions: { typesafeApiKey: ref("TYPESAFE_API_KEY") } },
      },
    },
  },
};

function setup(saved: readonly string[], stored: readonly string[]) {
  const profiles = new Map<string, string>(saved.map((id) => [id, "old"]));
  const call = vi.fn(async (method: string, params: unknown) => {
    if (method === "secrets.store.list")
      return { entries: stored.map((name) => ({ name })) };
    if (method === "secrets.resolve") {
      const { allowedPaths } = params as { allowedPaths: string[] };
      return {
        assignments: allowedPaths.map((path) => ({
          pathSegments: path.split("."),
          value: ` ${path.split(".")[2]}-key `,
        })),
      };
    }
    return { refreshed: true };
  });
  const deps = {
    readConfig: () => OLD_WORLD,
    keys: {
      has: (provider: string) => profiles.has(provider),
      save: vi.fn(async (provider: string, key: string) => {
        profiles.set(provider, key);
      }),
      remove: vi.fn(async () => {}),
    },
    call,
    typesafeKey: () => "ts-key",
  } satisfies MigrateDeps;
  return { deps, profiles, call };
}

describe("copyStoreKeysToProfiles", () => {
  it("copies each stored key without a profile, then refreshes once", async () => {
    const { deps, profiles, call } = setup(
      ["zai"],
      [
        "OPENROUTER_API_KEY",
        "VENICE_API_KEY",
        "ZAI_API_KEY",
        "TYPESAFE_API_KEY",
      ],
    );
    expect(await copyStoreKeysToProfiles(deps)).toEqual([
      "openrouter",
      "venice",
      "typesafe",
    ]);
    expect(call).toHaveBeenCalledWith(
      "secrets.resolve",
      expect.objectContaining({
        allowedPaths: [
          "models.providers.openrouter.apiKey",
          "models.providers.venice.apiKey",
        ],
      }),
    );
    expect(profiles.get("openrouter")).toBe("openrouter-key");
    expect(profiles.get("zai")).toBe("old");
    expect(profiles.get("typesafe")).toBe("ts-key");
    expect(profiles.has("groq")).toBe(false);
    expect(call).toHaveBeenLastCalledWith("models.authRefresh", {
      operation: "login",
    });
  });

  it("never deletes from the store, and does nothing when all are copied", async () => {
    const { deps, call } = setup(
      ["openrouter", "venice", "zai", "typesafe"],
      ["OPENROUTER_API_KEY", "VENICE_API_KEY", "ZAI_API_KEY"],
    );
    expect(await copyStoreKeysToProfiles(deps)).toEqual([]);
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      "secrets.store.list",
    ]);
  });
});
