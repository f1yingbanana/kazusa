import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { listAgentIds } from "openclaw/plugin-sdk/agent-scope-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  BackdropQuerySchema,
  PortraitQuerySchema,
  PortraitsQuerySchema,
  type PortraitsResponse,
  type TimeOfDay,
} from "@kazusa/client";
import { currentConfig } from "../current-config.ts";
import { sendJson, type RouteRegistrar } from "../http/helpers.ts";
import { LOCATION_CONFIG } from "../location/config.ts";
import { backdropsBeside, readBackdropSet } from "./backdrops.ts";
import { SCENE_CONFIG } from "./config.ts";
import { portraitUrl, readPortraits } from "./portraits.ts";

const queryOf = (url: string | undefined): Record<string, string> =>
  Object.fromEntries(new URL(url ?? "/", "http://localhost").searchParams);

/**
 * Streams a picture as stickers are served: cacheable forever (its URL carries
 * a version) and never sniffed into anything but its raster type. `false` when
 * the file is gone.
 */
async function sendPicture(
  res: ServerResponse,
  picture: { readonly file: string; readonly contentType: string },
): Promise<boolean> {
  const size = await stat(picture.file).catch(() => undefined);
  if (!size?.isFile()) return false;
  res.writeHead(200, {
    "Content-Type": picture.contentType,
    "Content-Length": size.size,
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
  await new Promise<void>((resolve, reject) => {
    createReadStream(picture.file)
      .on("error", reject)
      .on("end", resolve)
      .pipe(res);
  });
  return true;
}

/**
 * The Scene view's art: characters' portraits and the world's backdrops. The
 * server picks no picture for the time of day and pushes nothing as time
 * passes; the client picks from `GET /kazusa/places` (`backdrops`, `times`).
 */
export function registerScene(
  api: OpenClawPluginApi,
  route: RouteRegistrar,
): { readonly times: readonly TimeOfDay[] } {
  const { times } = SCENE_CONFIG.parse(api.pluginConfig?.scene ?? {});
  const backdropsDir = backdropsBeside(
    LOCATION_CONFIG.parse(api.pluginConfig?.location ?? {}).wikiDir,
  );
  /** Only roster ids reach the filesystem, so an id can't escape a workspace. */
  const workspaceOf = (id: string): string | undefined => {
    const config = currentConfig(api);
    return listAgentIds(config).includes(id)
      ? api.runtime.agent.resolveAgentWorkspaceDir(config, id)
      : undefined;
  };

  // `GET /kazusa/portraits?id=`: a character's set, per scene member.
  route("portraits", "GET", async (req, res) => {
    const query = PortraitsQuerySchema.safeParse(queryOf(req.url));
    if (!query.success) {
      sendJson(res, 400, { error: "Missing required id query parameter." });
      return;
    }
    const { id } = query.data;
    const workspace = workspaceOf(id);
    if (workspace === undefined) {
      sendJson(res, 404, { error: `Character not found: ${id}` });
      return;
    }
    const set = readPortraits(workspace);
    sendJson(res, 200, {
      portraits: [...set.portraits.values()].map((portrait) => ({
        name: portrait.name,
        url: portraitUrl(id, portrait),
        ...(portrait.outfit === undefined ? {} : { outfit: portrait.outfit }),
        mood: portrait.mood,
      })),
      ...(set.default === undefined ? {} : { default: set.default }),
      ...(set.size === undefined ? {} : { size: [set.size[0], set.size[1]] }),
      ...(set.eyeline === undefined ? {} : { eyeline: set.eyeline }),
    } satisfies PortraitsResponse);
  });

  // `GET /kazusa/portrait?id=&name=&v=`: one picture. The version is only for
  // caching; a name serves whatever its file holds now.
  route("portrait", "GET", async (req, res) => {
    const query = PortraitQuerySchema.safeParse(queryOf(req.url));
    const workspace = query.success ? workspaceOf(query.data.id) : undefined;
    // Only names the set lists reach the filesystem.
    const portrait =
      query.success && workspace !== undefined
        ? readPortraits(workspace).portraits.get(query.data.name)
        : undefined;
    if (!portrait || !(await sendPicture(res, portrait))) {
      sendJson(res, 404, {
        error: `Portrait not found: ${query.data?.id ?? ""}/${query.data?.name ?? ""}`,
      });
    }
  });

  // `GET /kazusa/backdrop?set=&name=&v=`: one picture of the world's library.
  route("backdrop", "GET", async (req, res) => {
    const query = BackdropQuerySchema.safeParse(queryOf(req.url));
    // Only set names (no path) and names the set lists reach the filesystem.
    const backdrop = query.success
      ? readBackdropSet(backdropsDir, query.data.set)?.files.get(
          query.data.name,
        )
      : undefined;
    if (!backdrop || !(await sendPicture(res, backdrop))) {
      sendJson(res, 404, {
        error: `Backdrop not found: ${query.data?.set ?? ""}/${query.data?.name ?? ""}`,
      });
    }
  });

  return { times };
}
