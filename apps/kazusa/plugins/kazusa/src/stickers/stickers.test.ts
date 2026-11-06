import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { createRouteRegistrar } from "../http/helpers.ts";
import { registerStickerHttp } from "./http.ts";
import { readStickers, stickerText, stickerUrl } from "./stickers.ts";

async function workspaceWith(
  files: readonly string[],
  manifest?: unknown,
): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "kazusa-stickers-"));
  const dir = path.join(workspace, "stickers");
  await mkdir(dir);
  for (const file of files) await writeFile(path.join(dir, file), file);
  if (manifest !== undefined)
    await writeFile(
      path.join(dir, "stickers.json"),
      typeof manifest === "string" ? manifest : JSON.stringify(manifest),
    );
  return workspace;
}

describe("sticker sets", () => {
  it("reads names, moods, outfits and looks", async () => {
    const workspace = await workspaceWith(
      [
        "laughing.webp",
        "eyes-closed.png",
        "maid-shy.webp",
        "Bad Name.webp",
        "drawing.svg",
      ],
      {
        outfits: { maid: "a maid dress", swimsuit: "a swimsuit" },
        stickers: { laughing: { look: "laughing with eyes shut" } },
      },
    );
    const { stickers, outfits } = readStickers(workspace);
    expect([...stickers.keys()]).toEqual([
      "eyes-closed",
      "laughing",
      "maid-shy",
    ]);
    expect(stickers.get("laughing")).toMatchObject({
      look: "laughing with eyes shut",
      contentType: "image/webp",
    });
    // Only a declared outfit word is an outfit.
    expect(stickers.get("eyes-closed")).toMatchObject({ look: "eyes closed" });
    expect(stickers.get("eyes-closed")).not.toHaveProperty("outfit");
    expect(stickers.get("maid-shy")).toMatchObject({
      look: "shy",
      outfit: "a maid dress",
    });
    // An outfit no sticker shows isn't offered.
    expect([...outfits]).toEqual([["maid", "a maid dress"]]);
    expect(stickerText("Aris", stickers.get("maid-shy")!)).toBe(
      "Aris, shy, in a maid dress",
    );
    expect(stickerText("Aris", stickers.get("laughing")!)).toBe(
      "Aris, laughing with eyes shut",
    );
  });

  it("keeps the pictures when the manifest is broken, and has none without a folder", async () => {
    const broken = await workspaceWith(["happy.webp"], "{ not json");
    expect(readStickers(broken).stickers.get("happy")).toMatchObject({
      look: "happy",
    });
    const none = await mkdtemp(path.join(tmpdir(), "kazusa-stickers-"));
    expect(readStickers(none).stickers.size).toBe(0);
  });

  it("rereads a set when its manifest changes", async () => {
    const workspace = await workspaceWith(["happy.webp"], { stickers: {} });
    expect(readStickers(workspace).stickers.get("happy")?.look).toBe("happy");
    const manifest = path.join(workspace, "stickers", "stickers.json");
    await writeFile(
      manifest,
      JSON.stringify({ stickers: { happy: { look: "happy, waving" } } }),
    );
    // A later mtime, even on a coarse clock.
    const { utimes } = await import("node:fs/promises");
    await utimes(manifest, new Date(), new Date(Date.now() + 5_000));
    expect(readStickers(workspace).stickers.get("happy")?.look).toBe(
      "happy, waving",
    );
  });

  it("sees pictures added, removed or replaced in place", async () => {
    const workspace = await workspaceWith(["happy.webp", "sad.webp"]);
    const dir = path.join(workspace, "stickers");
    const before = readStickers(workspace).stickers.get("happy")?.version;
    const { rm, utimes } = await import("node:fs/promises");
    // Same name, new picture: the folder itself doesn't change.
    await writeFile(path.join(dir, "happy.webp"), "new picture");
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(dir, "happy.webp"), later, later);
    await writeFile(path.join(dir, "smug.webp"), "smug");
    await rm(path.join(dir, "sad.webp"));
    const after = readStickers(workspace).stickers;
    expect(after.get("happy")?.version).not.toBe(before);
    expect([...after.keys()]).toEqual(["happy", "smug"]);
  });

  it("serves a roster character's sticker and nothing else", async () => {
    const workspace = await workspaceWith(["happy.webp"]);
    const routes: Record<
      string,
      (req: unknown, res: unknown) => Promise<void>
    > = {};
    const api = {
      config: {
        gateway: { auth: { token: "test-service-token" } },
        agents: { list: [{ id: "aris", workspace }] },
      },
      runtime: {
        agent: { resolveAgentWorkspaceDir: vi.fn(() => workspace) },
      },
      registerHttpRoute: vi.fn((opts) => {
        routes[opts.path] = opts.handler;
      }),
    } as unknown as OpenClawPluginApi;
    Object.assign(api, {
      runtime: { ...api.runtime, config: { current: () => api.config } },
    });
    registerStickerHttp(api, createRouteRegistrar(api));
    const get = async (url: string) => {
      const res = Object.assign(new PassThrough(), {
        status: 0,
        headers: {},
        headersSent: false,
        setHeader: vi.fn(),
        writeHead(status: number, headers: Record<string, unknown>) {
          res.status = status;
          res.headers = headers;
          res.headersSent = true;
        },
      });
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      await routes["/kazusa/sticker"]?.(
        {
          method: "GET",
          url,
          headers: { authorization: "Bearer test-service-token" },
        },
        res,
      );
      return { ...res, body: Buffer.concat(chunks).toString() };
    };

    const url = stickerUrl("aris", { name: "happy", v: "abc" });
    expect(url).toBe("/kazusa/sticker?id=aris&name=happy&v=abc");
    const ok = await get(url);
    expect(ok.status).toBe(200);
    expect(ok.headers).toMatchObject({
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    expect(ok.body).toBe("happy.webp");
    expect((await get("/kazusa/sticker?id=aris&name=sad")).status).toBe(404);
    expect((await get("/kazusa/sticker?id=mallory&name=happy")).status).toBe(
      404,
    );
    expect((await get("/kazusa/sticker?id=aris&name=../IDENTITY")).status).toBe(
      404,
    );
  });
});
