import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROVIDERS } from "@kazusa/client";

const base = JSON.parse(
  readFileSync(new URL("../../../../base.json", import.meta.url), "utf8"),
) as {
  config: {
    agents: { defaults: { decisionModel?: string } };
    models?: unknown;
    plugins: {
      allow: string[];
      entries: Record<
        string,
        {
          config?: Record<string, unknown> & {
            models?: { providers?: string[] };
          };
          hooks?: Record<string, unknown>;
        }
      >;
    };
  };
};

/**
 * Keys are auth profiles, outside `openclaw.json`. A store reference in a new
 * world would hide a profile from model discovery.
 */
describe("apps/kazusa/base.json", () => {
  it("allows every provider in the catalog and references no keys", () => {
    for (const entry of PROVIDERS)
      expect(base.config.plugins.allow).toContain(entry.plugin);
    expect(base.config.models).toBeUndefined();
    expect(
      base.config.plugins.entries.kazusa?.config?.decisions,
    ).toBeUndefined();
  });

  /*
   * A character's turn needs its model's provider plugin. OpenClaw starts one
   * with the Gateway only for an explicit hook policy here (or a model named in
   * config, which Kazusa's own model pick never is); otherwise each character's
   * first turn loads every plugin again, a whole Kazusa included.
   */
  it("starts every provider plugin with the Gateway", () => {
    const plugins = new Set(
      PROVIDERS.map((entry) => entry.plugin).filter((id) => id !== "kazusa"),
    );
    for (const id of plugins)
      expect(base.config.plugins.entries[id]?.hooks).toEqual({
        allowPromptInjection: true,
      });
  });

  it("offers only providers it can run at setup", () => {
    const offered = base.config.plugins.entries.kazusa?.config?.models;
    expect(offered?.providers?.length).toBeGreaterThan(0);
    for (const id of offered?.providers ?? []) {
      const entry = PROVIDERS.find((candidate) => candidate.id === id);
      expect(entry?.id).toBe(id);
      expect(base.config.plugins.allow).toContain(entry?.plugin);
    }
  });

  it("decides with Kazusa", () => {
    expect(base.config.agents.defaults.decisionModel).toBe("kazusa/jev");
  });
});
