import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { describe, expect, it } from "vitest";
import { systemAgent, worldCast } from "./system-agent.ts";

const config = {
  agents: {
    defaults: { systemAgent: { agentId: "shittim" } },
    entries: { shittim: {}, arona: {}, yuuka: {} },
  },
};
const apiWith = (pluginConfig: unknown) =>
  ({
    pluginConfig,
    runtime: { config: { current: () => config } },
  }) as unknown as OpenClawPluginApi;

describe("the system agent", () => {
  it("is never part of the world's cast", () => {
    expect(worldCast(config)).toEqual(["arona", "yuuka"]);
  });

  it("reads as the character it is linked to, and only she does", () => {
    const system = systemAgent(apiWith({ systemAgent: { is: "arona" } }));
    expect(system.linked()).toBe("arona");
    expect(system.identityOf("shittim")).toBe("arona");
    expect(system.identityOf("yuuka")).toBe("yuuka");
    expect(system.identityOf("arona")).toBe("arona");
  });

  it("stays her own persona when the link names nobody in the cast", () => {
    for (const is of ["nobody", "shittim"]) {
      const system = systemAgent(apiWith({ systemAgent: { is } }));
      expect(system.linked()).toBeUndefined();
      expect(system.identityOf("shittim")).toBe("shittim");
    }
  });

  it("answers while paused unless the world says otherwise", () => {
    expect(systemAgent(apiWith({})).actsWhilePaused("shittim")).toBe(true);
    expect(systemAgent(apiWith({})).actsWhilePaused("yuuka")).toBe(false);
    expect(
      systemAgent(
        apiWith({ clock: { systemAgentWhilePaused: false } }),
      ).actsWhilePaused("shittim"),
    ).toBe(false);
  });
});
