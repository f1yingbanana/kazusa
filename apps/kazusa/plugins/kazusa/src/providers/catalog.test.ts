import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "./catalog.ts";

const base = JSON.parse(
  readFileSync(
    new URL("../../../../worlds/base.json", import.meta.url),
    "utf8",
  ),
) as {
  config: {
    agents: { defaults: { decisionModel?: string } };
    models?: unknown;
    plugins: {
      allow: string[];
      entries: { kazusa: { config: Record<string, unknown> } };
    };
  };
};

/**
 * Keys are auth profiles, outside `openclaw.json`. A store reference in a new
 * world would hide a profile from model discovery.
 */
describe("worlds/base.json", () => {
  it("allows every provider in the catalog and references no keys", () => {
    for (const entry of PROVIDERS)
      expect(base.config.plugins.allow).toContain(entry.plugin);
    expect(base.config.models).toBeUndefined();
    expect(base.config.plugins.entries.kazusa.config.decisions).toBeUndefined();
  });

  it("decides with Kazusa", () => {
    expect(base.config.agents.defaults.decisionModel).toBe("kazusa/jev");
  });
});
