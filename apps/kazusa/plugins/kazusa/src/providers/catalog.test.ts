import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TYPESAFE_KEY_PATH } from "../decisions/jev.ts";
import { PROVIDERS } from "./catalog.ts";

const base = JSON.parse(
  readFileSync(
    new URL("../../../../worlds/base.json", import.meta.url),
    "utf8",
  ),
) as {
  config: {
    agents: { defaults: { decisionModel?: string } };
    models: { providers: Record<string, { apiKey?: unknown }> };
    plugins: {
      allow: string[];
      entries: { kazusa: { config: Record<string, Record<string, unknown>> } };
    };
  };
};

const ref = (id: string) => ({ source: "store", provider: "default", id });

/**
 * Writing a key reference reloads every plugin, so a new world has them all
 * from the start and saving a key only touches the secret store.
 */
describe("worlds/base.json", () => {
  it("references the store for every provider in the catalog", () => {
    for (const entry of PROVIDERS)
      expect(base.config.plugins.allow).toContain(entry.plugin);
    const providers = PROVIDERS.filter((entry) => entry.keyIn === "provider");
    expect(
      Object.fromEntries(
        providers.map((entry) => [
          entry.id,
          base.config.models.providers[entry.id]?.apiKey,
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        providers.map((entry) => [entry.id, ref(entry.keyName)]),
      ),
    );
  });

  it("references TypeSafe's key in Kazusa's config and decides with Kazusa", () => {
    const [group, field] = TYPESAFE_KEY_PATH.split(".") as [string, string];
    expect(base.config.plugins.entries.kazusa.config[group]?.[field]).toEqual(
      ref("TYPESAFE_API_KEY"),
    );
    expect(base.config.agents.defaults.decisionModel).toBe("kazusa/jev");
  });
});
