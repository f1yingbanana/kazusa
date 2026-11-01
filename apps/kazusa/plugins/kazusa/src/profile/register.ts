import path from "node:path";
import { ProfileSavePayloadSchema, type ProfileResponse } from "@kazusa/client";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import {
  createRouteRegistrar,
  readJsonBody,
  sendJson,
} from "../http/helpers.ts";
import { USER } from "../location/config.ts";
import { playerWikiDir, readPlayerPage, writePlayerAbout } from "./page.ts";

/**
 * The player's id and name come from the world's config; only their description
 * is theirs to edit here, and it lives on their World Wiki page.
 */
export function registerProfile(api: OpenClawPluginApi): void {
  const route = createRouteRegistrar(api);
  const wikiDir = playerWikiDir(api);
  const player = USER.parse(api.pluginConfig?.user ?? {});

  const respond = async (): Promise<ProfileResponse> => {
    const page = await readPlayerPage(wikiDir, player.id);
    return {
      id: player.id,
      name: player.name,
      about: page?.about ?? "",
      wikiPage: path.relative(
        path.dirname(wikiDir),
        page?.file ??
          path.join(
            wikiDir,
            "entities",
            "characters",
            `${player.id.replace(/^user:/, "")}.md`,
          ),
      ),
    };
  };

  route("profile", "GET", async (_req, res) => {
    sendJson(res, 200, await respond());
  });

  route("profile/save", "POST", async (req, res) => {
    const { about } = ProfileSavePayloadSchema.parse(await readJsonBody(req));
    await writePlayerAbout(wikiDir, player, about);
    sendJson(res, 200, await respond());
  });
}
