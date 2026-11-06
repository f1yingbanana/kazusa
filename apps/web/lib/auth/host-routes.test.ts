import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as setupPost } from "../../app/setup/route";
import { POST as worldPost } from "../../app/setup/world/route";
import { POST as revealPost } from "../../app/reveal/route";
import { GET as updateGet, POST as updatePost } from "../../app/update/route";

const effects = vi.hoisted(() => ({
  apply: vi.fn(),
  prepare: vi.fn(),
  update: vi.fn(),
  reveal: vi.fn(),
}));

vi.mock("../setup/setup", async () => {
  const { z } = await import("zod");
  return {
    SetupRequestSchema: z.object({
      key: z.object({ provider: z.string(), value: z.string() }).optional(),
    }),
    setup: { apply: effects.apply, prepare: effects.prepare, files: {} },
  };
});
vi.mock("../setup/reveal", () => ({ revealCommand: effects.reveal }));
vi.mock("../update/run", () => ({ runUpdater: effects.update }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("KAZUSA_AUTH_MODE", "public");
});
afterEach(() => vi.unstubAllEnvs());

const ROUTES = [
  { path: "setup", method: "POST", handler: setupPost },
  { path: "setup/world", method: "POST", handler: worldPost },
  { path: "reveal", method: "POST", handler: revealPost },
  { path: "update", method: "POST", handler: updatePost },
  { path: "update?fresh=1", method: "GET", handler: updateGet },
  { path: "update?boot=1", method: "GET", handler: updateGet },
];

describe("desktop-only routes", () => {
  it("denies public requests before body parsing, downloads, subprocesses or writes", async () => {
    for (const { path, method, handler } of ROUTES) {
      const response = await handler(
        new Request(`https://demo.example/${path}`, {
          method,
          headers: { Origin: "https://demo.example", "x-kazusa-role": "owner" },
          ...(method === "POST" ? { body: "not json" } : {}),
        }),
      );
      expect(response.status).toBe(403);
    }
    for (const effect of Object.values(effects))
      expect(effect).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown deployment mode on every host route", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "typo");
    for (const { path, method, handler } of ROUTES) {
      expect(
        (await handler(new Request(`http://localhost/${path}`, { method })))
          .status,
      ).toBe(503);
    }
    for (const effect of Object.values(effects))
      expect(effect).not.toHaveBeenCalled();
  });

  it("keeps local setup and updater boot checks usable", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    expect(
      (
        await setupPost(
          new Request("http://localhost/setup", {
            method: "POST",
            body: "{}",
            headers: { Origin: "http://localhost" },
          }),
        )
      ).status,
    ).toBe(200);
    expect(effects.apply).toHaveBeenCalledWith({});
    const response = await updateGet(
      new Request("http://localhost/update?boot=1"),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("boot");
    expect(effects.update).not.toHaveBeenCalled();
  });

  it("refuses a rebound DNS name on the local listener", async () => {
    vi.stubEnv("KAZUSA_AUTH_MODE", "local");
    for (const { path, method, handler } of ROUTES) {
      const response = await handler(
        new Request(`http://rebind.example:3000/${path}`, {
          method,
          headers: { Origin: "http://rebind.example:3000" },
          ...(method === "POST" ? { body: "{}" } : {}),
        }),
      );
      expect(response.status).toBe(403);
    }
    for (const effect of Object.values(effects))
      expect(effect).not.toHaveBeenCalled();
  });
});
