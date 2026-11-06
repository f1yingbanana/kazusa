import { describe, expect, it } from "vitest";
import {
  AccessSchema,
  accessForRole,
  deploymentRole,
  hasPermission,
  KAZUSA_ROUTES,
  parseAuthMode,
} from "./access.ts";

describe("viewer access", () => {
  it("keeps observation, player actions, and administration distinct", () => {
    expect(AccessSchema.parse(accessForRole("visitor")).permissions).toEqual([
      "observe",
    ]);
    expect(hasPermission("collaborator", "play")).toBe(true);
    expect(hasPermission("collaborator", "manage")).toBe(false);
    expect(hasPermission("owner", "manage")).toBe(true);
    expect(hasPermission("visitor", "play")).toBe(false);
  });

  it("defaults only an absent deployment mode to local", () => {
    expect(deploymentRole(parseAuthMode(undefined))).toBe("owner");
    expect(deploymentRole(parseAuthMode("public"))).toBe("visitor");
    for (const value of ["", "PUBLIC", "publci", "trusted-proxy"]) {
      expect(() => parseAuthMode(value)).toThrow();
    }
  });

  it("does not expose operator-only routes or treat all GETs as public", () => {
    expect(KAZUSA_ROUTES.get("memory/consolidate")?.proxy).toBe(false);
    expect(KAZUSA_ROUTES.get("context")?.proxy).toBe(false);
    for (const path of ["providers", "models", "context/settings", "usage"]) {
      expect(KAZUSA_ROUTES.get(path)?.permission).toBe("manage");
    }
    const mutations = [...KAZUSA_ROUTES.values()].filter(
      (policy) => policy.method === "POST",
    );
    expect(mutations.every((policy) => policy.permission !== "observe")).toBe(
      true,
    );
  });
});
