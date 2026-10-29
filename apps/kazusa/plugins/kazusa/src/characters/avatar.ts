import { currentConfig } from "../current-config.ts";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type {
  OpenClawConfig,
  OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { sendJson, type RouteRegistrar } from "../http/helpers.ts";

/** Raster formats only: an SVG opened directly could run script on our origin. */
const AVATAR_TYPES: ReadonlyArray<readonly [string, string]> = [
  ["webp", "image/webp"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["avif", "image/avif"],
];

interface AvatarFile {
  readonly file: string;
  readonly contentType: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** The first `avatar.<ext>` in an agent's workspace, if any. */
export async function findAvatarFile(
  api: OpenClawPluginApi,
  agentId: string,
  config: OpenClawConfig = api.config,
): Promise<AvatarFile | undefined> {
  const workspace = api.runtime.agent.resolveAgentWorkspaceDir(config, agentId);
  for (const [ext, contentType] of AVATAR_TYPES) {
    const file = path.join(workspace, `avatar.${ext}`);
    try {
      const info = await stat(file);
      if (info.isFile())
        return { file, contentType, size: info.size, mtimeMs: info.mtimeMs };
    } catch {
      // Try the next extension
    }
  }
  return undefined;
}

/**
 * Browser URL for a workspace avatar. The version tracks the file's mtime, so
 * replacing the image yields a new URL and the old one can be cached forever.
 */
export async function localAvatarUrl(
  api: OpenClawPluginApi,
  agentId: string,
  config: OpenClawConfig = api.config,
): Promise<string | undefined> {
  const avatar = await findAvatarFile(api, agentId, config);
  if (!avatar) return undefined;
  const query = new URLSearchParams({
    id: agentId,
    v: Math.trunc(avatar.mtimeMs).toString(36),
  });
  return `/kazusa/avatar?${query}`;
}

export function registerAvatarHttp(
  api: OpenClawPluginApi,
  route: RouteRegistrar,
): void {
  const getConfig = () => currentConfig(api);
  route("avatar", "GET", async (req, res) => {
    const id = new URL(req.url ?? "/", "http://localhost").searchParams.get(
      "id",
    );
    // Only roster ids reach the filesystem, so the id cannot escape a workspace.
    if (!id || !listAgentIds(getConfig()).includes(id)) {
      sendJson(res, 404, { error: `Avatar not found: ${id ?? ""}` });
      return;
    }
    const avatar = await findAvatarFile(api, id, getConfig());
    if (!avatar) {
      sendJson(res, 404, { error: `Avatar not found: ${id}` });
      return;
    }
    res.writeHead(200, {
      "Content-Type": avatar.contentType,
      "Content-Length": avatar.size,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    await new Promise<void>((resolve, reject) => {
      createReadStream(avatar.file)
        .on("error", reject)
        .on("end", resolve)
        .pipe(res);
    });
  });
}
