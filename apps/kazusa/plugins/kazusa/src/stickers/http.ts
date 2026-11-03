import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { currentConfig } from "../current-config.ts";
import { sendJson, type RouteRegistrar } from "../http/helpers.ts";
import { readStickers } from "./stickers.ts";

/**
 * `GET /kazusa/sticker?id=&name=&v=`: one sticker from a character's set. The
 * version is only for caching; a name serves whatever its file holds now.
 */
export function registerStickerHttp(
  api: OpenClawPluginApi,
  route: RouteRegistrar,
): void {
  route("sticker", "GET", async (req, res) => {
    const params = new URL(req.url ?? "/", "http://localhost").searchParams;
    const id = params.get("id");
    const name = params.get("name");
    const config = currentConfig(api);
    // Only roster ids reach the filesystem, and only names the set lists.
    const sticker =
      id && name && listAgentIds(config).includes(id)
        ? readStickers(
            api.runtime.agent.resolveAgentWorkspaceDir(config, id),
          ).stickers.get(name)
        : undefined;
    const size = sticker && (await stat(sticker.file).catch(() => undefined));
    if (!sticker || !size?.isFile()) {
      sendJson(res, 404, {
        error: `Sticker not found: ${id ?? ""}/${name ?? ""}`,
      });
      return;
    }
    res.writeHead(200, {
      "Content-Type": sticker.contentType,
      "Content-Length": size.size,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    await new Promise<void>((resolve, reject) => {
      createReadStream(sticker.file)
        .on("error", reject)
        .on("end", resolve)
        .pipe(res);
    });
  });
}
